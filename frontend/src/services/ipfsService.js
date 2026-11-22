// ─────────────────────────────────────────────────────────────────────────────
// frontend/src/services/ipfsService.js
// ─────────────────────────────────────────────────────────────────────────────
// Todas as operações IPFS passam pelo auth-service (porta 3001).
// A cifração/decifração ocorre EXCLUSIVAMENTE no browser (ponta a ponta).
// O auth-service é proxy transparente: encaminha os bytes ao IPFS sem alterá-los.
//
// Opcional em dev:
//   VITE_AUTH_API_URL=http://localhost:3001
//   VITE_IPFS_GATEWAY=http://localhost:8080
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_API = (
  import.meta.env.VITE_AUTH_API_URL ??
  import.meta.env.VITE_AUTH_URL ??
  ''
).replace(/\/api\/?$/, '').replace(/\/$/, '')

const IPFS_GW = (
  import.meta.env.VITE_IPFS_GATEWAY ??
  import.meta.env.VITE_IPFS_GATEWAY_URL ??
  ''
).replace(/\/ipfs\/?$/, '').replace(/\/$/, '')

const TOKEN_KEY = 'bia_token'
const S3_PART_MAX_ATTEMPTS = 3
const S3_PART_TIMEOUT_MS = 60000

function getAuthHeaders() {
  const token = sessionStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function throwIfError(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); msg = j.error || j.message || msg } catch { /* noop */ }
    throw new Error(msg)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Envia um ArrayBuffer já cifrado ao IPFS via auth-service.
 * A cifração deve ter sido realizada no browser antes desta chamada.
 *
 * @param {number|string} processId
 * @param {ArrayBuffer}   encryptedBuffer  - conteúdo já cifrado com AES-256-GCM
 * @param {string}        filename
 * @param {string}        [mimeType]
 * @returns {Promise<{ cid: string, size: number }>}
 */
export async function uploadToIPFS(processId, encryptedBuffer, filename, mimeType = 'application/octet-stream') {
  const s3Config = await fetch(`${AUTH_API}/api/ipfs/s3/config`, { headers: getAuthHeaders() })
  if (s3Config.ok && (await s3Config.json()).enabled) {
    return uploadToIPFSViaS3(processId, encryptedBuffer, filename, mimeType)
  }

  const form = new FormData()
  form.append('processId', String(processId))
  form.append('file', new Blob([encryptedBuffer], { type: 'application/octet-stream' }), filename)

  const res = await fetch(`${AUTH_API}/api/ipfs/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: form,
  })
  await throwIfError(res)
  const data = await res.json()
  return { cid: data.cid, size: Number(data.fileSize ?? data.size ?? encryptedBuffer.byteLength) }
}

/**
 * Envia um fluxo cifrado ao S3 multipart sem materializar o arquivo completo
 * no browser. Requer o ingresso S3 habilitado no auth-service.
 */
export async function uploadStreamToIPFS(processId, encryptedStream, encryptedSize, filename, mimeType = 'application/octet-stream') {
  const s3Config = await fetch(`${AUTH_API}/api/ipfs/s3/config`, { headers: getAuthHeaders() })
  await throwIfError(s3Config)
  if (!(await s3Config.json()).enabled) throw new Error('Entrada S3 obrigatoria para upload segmentado nao esta habilitada')
  return uploadStreamToIPFSViaS3(processId, encryptedStream, encryptedSize, filename, mimeType)
}

async function uploadToIPFSViaS3(processId, encryptedBuffer, filename, mimeType) {
  return uploadStreamToIPFSViaS3(processId, new Blob([encryptedBuffer]).stream(), encryptedBuffer.byteLength, filename, mimeType)
}

async function uploadStreamToIPFSViaS3(processId, encryptedStream, encryptedSize, filename, mimeType) {
  const startRes = await fetch(`${AUTH_API}/api/ipfs/s3/start`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ processId: String(processId), filename, mimeType, fileSize: encryptedSize }),
  })
  await throwIfError(startRes)
  const session = await startRes.json()
  const parts = new Array(session.partCount)
  const reader = encryptedStream.getReader()
  const inFlight = new Set()
  let partIndex = 0
  let partBuffer = new Uint8Array(session.partSize)
  let partLength = 0

  async function uploadPart(bytes) {
    const index = partIndex++
    let lastError
    for (let attempt = 1; attempt <= S3_PART_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), S3_PART_TIMEOUT_MS)
      try {
        const putRes = await fetch(session.parts[index].url, { method: 'PUT', body: bytes, signal: controller.signal })
        if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`)
        const eTag = putRes.headers.get('ETag')
        if (!eTag) throw new Error('S3 nao retornou ETag')
        parts[index] = { partNumber: index + 1, eTag }
        return
      } catch (err) {
        lastError = err
        if (attempt < S3_PART_MAX_ATTEMPTS) await sleep(1000 * attempt)
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error(`Falha ao enviar parte ${index + 1} apos ${S3_PART_MAX_ATTEMPTS} tentativas: ${lastError.message}`)
  }

  async function enqueuePart(bytes) {
    const pending = uploadPart(bytes)
    inFlight.add(pending)
    pending.then(() => inFlight.delete(pending), () => inFlight.delete(pending))
    if (inFlight.size >= 3) await Promise.race(inFlight)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const source = new Uint8Array(value)
      let offset = 0
      while (offset < source.length) {
        const copied = Math.min(session.partSize - partLength, source.length - offset)
        partBuffer.set(source.subarray(offset, offset + copied), partLength)
        partLength += copied
        offset += copied
        if (partLength === session.partSize) {
          await enqueuePart(partBuffer)
          partBuffer = new Uint8Array(session.partSize)
          partLength = 0
        }
      }
    }
    if (partLength > 0) await enqueuePart(partBuffer.subarray(0, partLength))
    await Promise.all(inFlight)
  } catch (err) {
    fetch(`${AUTH_API}/api/ipfs/s3/abort`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId }),
    }).catch(() => {})
    throw err
  } finally {
    reader.releaseLock()
  }
  if (partIndex !== session.partCount) throw new Error('Numero de partes cifradas diverge da sessao S3')

  const completeRes = await fetch(`${AUTH_API}/api/ipfs/s3/complete`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId, parts }),
  })
  await throwIfError(completeRes)
  const data = await completeRes.json()
  return { cid: data.cid, size: Number(data.fileSize ?? encryptedSize) }
}

/**
 * Baixa os bytes cifrados de um CID do IPFS via auth-service e retorna
 * como ArrayBuffer. A decifração deve ser feita pelo chamador no browser.
 *
 * @param {string} cid
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadRawFromIPFS(cid) {
  const res = await fetch(
    `${AUTH_API}/api/ipfs/download/${encodeURIComponent(cid)}`,
    { method: 'GET', headers: getAuthHeaders() }
  )
  await throwIfError(res)
  return res.arrayBuffer()
}

/** Baixa bytes cifrados como fluxo para decifragem segmentada. */
export async function downloadRawStreamFromIPFS(cid) {
  const res = await fetch(
    `${AUTH_API}/api/ipfs/download/${encodeURIComponent(cid)}`,
    { method: 'GET', headers: getAuthHeaders() }
  )
  await throwIfError(res)
  if (!res.body) throw new Error('Browser nao disponibilizou fluxo de download')
  return res.body
}

/**
 * Baixa um arquivo do IPFS via auth-service e dispara o download no browser.
 * Os bytes são servidos sem decifração — use apenas para arquivos não cifrados (legado).
 *
 * @param {string} cid
 * @param {string} filename
 */
export async function downloadFromIPFS(cid, filename) {
  const res = await fetch(
    `${AUTH_API}/api/ipfs/download/${encodeURIComponent(cid)}`,
    { method: 'GET', headers: getAuthHeaders() }
  )
  await throwIfError(res)

  const blob = new Blob([await res.arrayBuffer()])
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Remove o pin de um CID no nó IPFS via auth-service.
 * Libera o armazenamento local — o CID permanece registrado na blockchain.
 *
 * Não lança erro se o CID não estiver pinado (idempotente).
 *
 * @param {string} cid
 * @returns {Promise<{ success: boolean, cid: string, message: string }>}
 */
export async function unpinFromIPFS(cid) {
  const res = await fetch(`${AUTH_API}/api/ipfs/unpin/${encodeURIComponent(cid)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  await throwIfError(res)
  return res.json()
}

/**
 * Verifica se o nó IPFS está acessível.
 * @returns {Promise<boolean>}
 */
export async function checkIPFSNode() {
  try {
    const res = await fetch(`${AUTH_API}/api/ipfs/status`, {
      headers: getAuthHeaders(),
    })
    return res.ok
  } catch {
    return false
  }
}

/** URL pública de um CID no gateway local (leitura direta, sem auth). */
export const gatewayUrl = (cid) => `${IPFS_GW}/ipfs/${cid}`
