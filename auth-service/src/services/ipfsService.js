'use strict'

const axios = require('axios')
const FormData = require('form-data')

const DEFAULT_API = 'http://ipfs:5001'
const MFS_BASE = '/bia'
const IPFS_API_TIMEOUT_MS = Number(process.env.IPFS_API_TIMEOUT_MS ?? 0)
const IPFS_HEALTH_TIMEOUT_MS = Number(process.env.IPFS_HEALTH_TIMEOUT_MS ?? 2500)

function parseApiUrls() {
  const configured = process.env.IPFS_API_URLS || process.env.IPFS_API_URL || DEFAULT_API
  return [...new Set(configured.split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean))]
}

const API_URLS = parseApiUrls()
const requestedReplicationMin = Number(process.env.IPFS_REPLICATION_MIN || API_URLS.length)
const REPLICATION_MIN = Math.max(1, Math.min(API_URLS.length, Number.isFinite(requestedReplicationMin) ? requestedReplicationMin : API_URLS.length))
const nodes = API_URLS.map((url, index) => ({
  index,
  name: `ipfs-${index + 1}`,
  url,
  client: axios.create({ baseURL: url, timeout: IPFS_API_TIMEOUT_MS }),
}))

let preferredNodeIndex = 0

function kuboArgs(...args) {
  const params = new URLSearchParams()
  args.forEach(value => params.append('arg', value))
  return params.toString()
}

function errorMessage(err) {
  return err?.response?.data?.Message || err?.response?.data?.message || err?.message || String(err)
}

function orderedNodes() {
  return nodes.map((_node, offset) => nodes[(preferredNodeIndex + offset) % nodes.length])
}

async function isHealthy(node) {
  try {
    await node.client.post('/api/v0/id', null, { timeout: IPFS_HEALTH_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

async function selectHealthyNode() {
  for (const node of orderedNodes()) {
    if (await isHealthy(node)) {
      preferredNodeIndex = node.index
      return node
    }
  }
  const err = new Error(`Nenhum nó IPFS disponível entre ${API_URLS.length} endpoint(s)`)
  err.status = 503
  throw err
}

async function ensureMfsDir(node) {
  try {
    await node.client.post(`/api/v0/files/mkdir?${kuboArgs(MFS_BASE)}&parents=true`)
  } catch (err) {
    const message = errorMessage(err)
    if (!message.includes('already has entry') && !message.includes('file already exists')) throw err
  }
}

async function copyToMfs(node, cid, filename) {
  try {
    await ensureMfsDir(node)
    const mfsPath = `${MFS_BASE}/${filename}`
    const safePath = `${MFS_BASE}/${Date.now()}_${filename}`
    try {
      await node.client.post(`/api/v0/files/cp?${kuboArgs(`/ipfs/${cid}`, mfsPath)}`)
    } catch (err) {
      const message = errorMessage(err)
      if (message.includes('already has entry') || message.includes('file already exists')) {
        await node.client.post(`/api/v0/files/cp?${kuboArgs(`/ipfs/${cid}`, safePath)}`)
      } else {
        throw err
      }
    }
  } catch (err) {
    console.warn(`[ipfsService] MFS indisponível em ${node.name}: ${errorMessage(err)}`)
  }
}

async function checkPinnedOnNode(node, cid) {
  try {
    const { data } = await node.client.post('/api/v0/pin/ls', null, {
      params: { arg: cid, type: 'recursive' },
      timeout: IPFS_HEALTH_TIMEOUT_MS,
    })
    return Boolean(data?.Keys?.[cid])
  } catch {
    return false
  }
}

async function pinOnNode(node, cid) {
  await node.client.post('/api/v0/pin/add', null, {
    params: { arg: cid, recursive: true, progress: false },
    timeout: 0,
  })
  if (!(await checkPinnedOnNode(node, cid))) throw new Error(`CID ${cid} não foi confirmado após pin/add`)
  return true
}

/**
 * Replica um CID em todos os endpoints configurados e exige o quorum definido
 * por IPFS_REPLICATION_MIN. O pin remoto faz o Kubo buscar os blocos pelo swarm.
 */
async function replicate(cid, sourceNodeIndex = -1) {
  const results = await Promise.all(nodes.map(async node => {
    try {
      const pinned = node.index === sourceNodeIndex
        ? await checkPinnedOnNode(node, cid)
        : await pinOnNode(node, cid)
      if (!pinned) throw new Error('pin recursivo não confirmado')
      return { node: node.name, url: node.url, pinned: true }
    } catch (err) {
      return { node: node.name, url: node.url, pinned: false, error: errorMessage(err) }
    }
  }))

  const replicas = results.filter(result => result.pinned).length
  if (replicas < REPLICATION_MIN) {
    const err = new Error(`Replicação IPFS insuficiente para ${cid}: ${replicas}/${REPLICATION_MIN} réplicas confirmadas`)
    err.status = 503
    err.cid = cid
    err.replication = { replicas, required: REPLICATION_MIN, nodes: results }
    throw err
  }
  return { replicas, required: REPLICATION_MIN, nodes: results }
}

/**
 * Adiciona bytes já cifrados ao primeiro nó saudável e confirma replicação.
 * Streams não são repetidos após falha parcial; a seleção do nó ocorre antes
 * de o corpo começar a ser consumido.
 */
async function add(input, filename = 'file') {
  const sourceNode = await selectHealthyNode()
  const form = new FormData()
  form.append('file', input, { filename, contentType: 'application/octet-stream' })

  const { data } = await sourceNode.client.post('/api/v0/add', form, {
    headers: form.getHeaders(),
    params: { pin: true, 'cid-version': 1, hash: 'sha2-256' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 0,
  })

  const cid = data?.Hash
  if (!cid) throw new Error(`Kubo em ${sourceNode.name} não retornou CID`)

  await replicate(cid, sourceNode.index)
  await copyToMfs(sourceNode, cid, filename)
  return cid
}

async function requestContent(cid, responseType) {
  const failures = []
  for (const node of orderedNodes()) {
    try {
      const { data } = await node.client.post('/api/v0/cat', null, {
        params: { arg: cid },
        responseType,
        timeout: 0,
      })
      preferredNodeIndex = node.index
      if (data && typeof data === 'object') data.biaIpfsNode = node.name
      return { data, node: node.name, url: node.url }
    } catch (err) {
      failures.push({ node: node.name, error: errorMessage(err) })
    }
  }
  const err = new Error(`CID ${cid} indisponível em todos os nós IPFS`)
  err.status = 404
  err.failures = failures
  throw err
}

async function cat(cid) {
  const { data } = await requestContent(cid, 'arraybuffer')
  return Buffer.from(data)
}

async function catStream(cid) {
  const result = await requestContent(cid, 'stream')
  result.data.biaIpfsNode = result.node
  return result.data
}

async function pinStatus(cid) {
  const status = await Promise.all(nodes.map(async node => ({
    node: node.name,
    url: node.url,
    pinned: await checkPinnedOnNode(node, cid),
  })))
  const replicas = status.filter(result => result.pinned).length
  return { cid, pinned: replicas >= REPLICATION_MIN, replicas, required: REPLICATION_MIN, nodes: status }
}

async function isPinned(cid) {
  return (await pinStatus(cid)).pinned
}

async function removeMfsEntries(node, cid) {
  try {
    const { data } = await node.client.post('/api/v0/files/ls', null, {
      params: { arg: MFS_BASE, long: true },
    })
    for (const entry of data?.Entries || []) {
      if (entry.Hash === cid) {
        await node.client.post(`/api/v0/files/rm?${kuboArgs(`${MFS_BASE}/${entry.Name}`)}&recursive=true`)
      }
    }
  } catch (err) {
    console.warn(`[ipfsService] Falha ao limpar MFS em ${node.name}: ${errorMessage(err)}`)
  }
}

async function unpin(cid) {
  const results = await Promise.all(nodes.map(async node => {
    try {
      await node.client.post('/api/v0/pin/rm', null, {
        params: { arg: cid, recursive: true },
      })
      await removeMfsEntries(node, cid)
      return { node: node.name, removed: true }
    } catch (err) {
      const message = errorMessage(err)
      if (message.toLowerCase().includes('not pinned') || message.toLowerCase().includes('not found')) {
        return { node: node.name, removed: true, alreadyAbsent: true }
      }
      return { node: node.name, removed: false, error: message }
    }
  }))
  const failed = results.filter(result => !result.removed)
  if (failed.length) {
    const err = new Error(`Falha ao remover CID ${cid} de ${failed.length} nó(s) IPFS`)
    err.status = 503
    err.nodes = results
    throw err
  }
  return results
}

async function nodeInfo() {
  const status = await Promise.all(nodes.map(async node => {
    try {
      const { data } = await node.client.post('/api/v0/id', null, { timeout: IPFS_HEALTH_TIMEOUT_MS })
      return {
        node: node.name,
        url: node.url,
        available: true,
        id: data.ID,
        agentVersion: data.AgentVersion,
        addresses: data.Addresses || [],
      }
    } catch (err) {
      return { node: node.name, url: node.url, available: false, error: errorMessage(err) }
    }
  }))
  const available = status.filter(node => node.available).length
  if (!available) {
    const err = new Error('Todos os nós IPFS estão indisponíveis')
    err.status = 503
    err.nodes = status
    throw err
  }
  return {
    available,
    total: nodes.length,
    replicationMin: REPLICATION_MIN,
    preferred: nodes[preferredNodeIndex].name,
    nodes: status,
  }
}

module.exports = {
  add,
  cat,
  catStream,
  isPinned,
  nodeInfo,
  pinStatus,
  replicate,
  unpin,
}
