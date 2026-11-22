// ─────────────────────────────────────────────────────────────────────────────
// frontend/src/hooks/useBIA.js
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import { getContract, getWalletAddress } from '@/services/contractService'
import { uploadStreamToIPFS, downloadRawFromIPFS, downloadRawStreamFromIPFS, unpinFromIPFS } from '@/services/ipfsService'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'
import { sendContractTransaction } from '@/utils/contractTransaction'
import { useAuth } from '@/contexts/AuthContext'
import {
  generatePMK,
  encryptPMK,
  decryptPMK,
  importPMKKey,
  encrypt,
  decrypt,
  createSegmentedEncryptedFileStream,
  decryptSegmentedFileStream,
  isSegmentedEncryptedHeader,
  hexToBytes,
  bytesToHex,
  generateOpaqueProcessRef,
  encryptProcessPayload,
  decryptProcessPayload,
  encryptFileMetadata,
  decryptFileMetadata,
} from '@/crypto/cryptoUtils'

// ── Constantes exportadas ─────────────────────────────────────────────────────

export const CRITICALITY = ['Baixo', 'Médio', 'Alto', 'Crítico']
export const STATUS      = ['Rascunho', 'Ativo', 'Arquivado']

async function peekReadableStream(stream, byteCount) {
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  while (total < byteCount) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = new Uint8Array(value)
    chunks.push(chunk)
    total += chunk.length
  }

  const prefix = new Uint8Array(Math.min(total, byteCount))
  let prefixOffset = 0
  for (const chunk of chunks) {
    const copied = Math.min(chunk.length, prefix.length - prefixOffset)
    if (copied <= 0) break
    prefix.set(chunk.subarray(0, copied), prefixOffset)
    prefixOffset += copied
  }

  let replayIndex = 0
  return {
    prefix,
    cancel: async () => {
      await reader.cancel()
      reader.releaseLock()
    },
    stream: new ReadableStream({
      async pull(controller) {
        if (replayIndex < chunks.length) {
          controller.enqueue(chunks[replayIndex++])
          return
        }
        const { done, value } = await reader.read()
        if (done) {
          reader.releaseLock()
          controller.close()
        } else {
          controller.enqueue(value)
        }
      },
      async cancel() {
        await reader.cancel()
        reader.releaseLock()
      },
    }),
  }
}

export function minutesToHuman(mins) {
  const m = Number(mins)
  if (!m)       return '—'
  if (m < 60)   return `${m}min`
  if (m < 1440) return `${(m / 60).toFixed(0)}h`
  return `${(m / 1440).toFixed(1)}d`
}

// ── Parsers de struct ─────────────────────────────────────────────────────────

function parseProcess(p, payload) {
  return {
    id:                 Number(p.id),
    name:               payload.name,
    businessUnit:       payload.businessUnit,
    criticality:        payload.criticality,
    status:             Number(p.status),
    rto:                payload.rto,
    rpo:                payload.rpo,
    mao:                payload.mao,
    financialImpact:    payload.financialImpact,
    operationalImpact:  payload.operationalImpact,
    reputationalImpact: payload.reputationalImpact,
    regulatoryImpact:   payload.regulatoryImpact,
    observations:       payload.observations,
    opaqueProcessRef:   payload.opaqueProcessRef,
    createdAt:          Number(p.createdAt),
    updatedAt:          Number(p.updatedAt),
    owner:              p.owner,
  }
}

function parseFile(f, metadata, processId) {
  return {
    id:         Number(f.id),
    processId,
    cid:        metadata.cid,
    filename:   metadata.filename,
    mimeType:   metadata.mimeType,
    fileSize:   metadata.fileSize,
    uploadedBy: f.uploadedBy,
    uploadedAt: Number(f.uploadedAt),
    active:     f.active,
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBIA() {
  const { x25519KeyPair } = useAuth()
  const [processes, setProcesses] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  const getProcessPMK = useCallback(async (processId, accessMgr) => {
    if (!x25519KeyPair) throw new Error('Chaves de criptografia não disponíveis. Faça login novamente.')
    const encPMKHex = await accessMgr.getPMK(processId)
    if (!encPMKHex || encPMKHex === '0x' || encPMKHex.length <= 2) {
      throw new Error(`Sem acesso ao processo ${processId}. PMK não encontrada.`)
    }
    return decryptPMK(hexToBytes(encPMKHex), x25519KeyPair.privateKey)
  }, [x25519KeyPair])

  // ── Processos ───────────────────────────────────────────────────────────────

  const loadProcesses = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (!x25519KeyPair) throw new Error('Chaves de criptografia não disponíveis. Faça login novamente.')
      const c   = await getContract('BIARegistry')
      const ids = await c.getAllProcessIds()
      const raw = await Promise.all(ids.map(id => c.getProcess(id)))
      const accessMgr = await getContract('AccessManager')
      const decrypted = await Promise.all(raw.map(async (process) => {
        try {
          const pmkBytes = await getProcessPMK(Number(process.id), accessMgr)
          const payload = await decryptProcessPayload(hexToBytes(process.encryptedData), await importPMKKey(pmkBytes))
          return parseProcess(process, payload)
        } catch (e) {
          console.warn(`[useBIA] Processo ${process.id} não exibido:`, e.message)
          return null
        }
      }))
      const visible = decrypted.filter(Boolean)
      setProcesses(visible)
      if (visible.length !== raw.length) {
        setError('Alguns processos não foram exibidos porque esta carteira não possui a chave de acesso.')
      }
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally {
      setLoading(false)
    }
  }, [getProcessPMK, x25519KeyPair])

  const createProcess = useCallback(async (params) => {
    if (!x25519KeyPair) throw new Error('Chaves de criptografia não disponíveis. Faça login novamente.')
    // A PMK e a referência opaca precisam existir antes de cifrar o payload.
    const pmkBytes = generatePMK()
    const pmkKey = await importPMKKey(pmkBytes)
    const encryptedData = await encryptProcessPayload(params, generateOpaqueProcessRef(), pmkKey)
    const c = await getContract('BIARegistry')
    const { receipt } = await sendContractTransaction({
      operation: 'BIARegistry.createProcess',
      method: c.createProcess,
      args: ['0x' + bytesToHex(new Uint8Array(encryptedData))],
    })

    // Extrair processId do evento ProcessCreated e armazenar PMK inicial
    let processId = null
    for (const log of receipt.logs) {
      try {
        const parsed = c.interface.parseLog({ topics: log.topics, data: log.data })
        if (parsed?.name === 'ProcessCreated') {
          processId = Number(parsed.args.id)
          break
        }
      } catch { /* log de outro contrato — ignorar */ }
    }

    if (processId !== null) {
      // Armazenar a PMK já usada para cifrar o payload, cifrada para o criador.
      const encPMK         = await encryptPMK(pmkBytes, x25519KeyPair.pubKeyBytes)
      const encPMKHex      = '0x' + bytesToHex(encPMK)
      const creatorAddress = await getWalletAddress()
      const accessMgr      = await getContract('AccessManager')
      await sendContractTransaction({
        operation: 'AccessManager.storePMK.createProcess',
        method: accessMgr.storePMK,
        args: [processId, creatorAddress, encPMKHex],
      })
    }

    await loadProcesses()
  }, [loadProcesses, x25519KeyPair])

  const updateProcess = useCallback(async (id, params) => {
    const c = await getContract('BIARegistry')
    const accessMgr = await getContract('AccessManager')
    const rawProcess = await c.getProcess(id)
    const pmkBytes = await getProcessPMK(id, accessMgr)
    const pmkKey = await importPMKKey(pmkBytes)
    const current = await decryptProcessPayload(hexToBytes(rawProcess.encryptedData), pmkKey)
    const encryptedData = await encryptProcessPayload(params, current.opaqueProcessRef, pmkKey)
    await sendContractTransaction({
      operation: 'BIARegistry.updateProcess',
      method: c.updateProcess,
      args: [id, '0x' + bytesToHex(new Uint8Array(encryptedData))],
    })
    await loadProcesses()
  }, [getProcessPMK, loadProcesses])

  const setStatus = useCallback(async (id, status) => {
    const c  = await getContract('BIARegistry')
    await sendContractTransaction({
      operation: 'BIARegistry.setStatus',
      method: c.setStatus,
      args: [id, status],
    })
    await loadProcesses()
  }, [loadProcesses])

  // ── Arquivos ─────────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (process) => {
    if (!process?.id || !process.opaqueProcessRef) throw new Error('Processo cifrado inválido.')
    const c = await getContract('BIAFileRegistry')
    const accessMgr = await getContract('AccessManager')
    const pmkKey = await importPMKKey(await getProcessPMK(process.id, accessMgr))
    const raw = await c.getActiveFilesByOpaqueProcessRef(process.opaqueProcessRef)
    return Promise.all(raw.map(async (file) => {
      const metadata = await decryptFileMetadata(hexToBytes(file.encryptedMetadata), pmkKey)
      return parseFile(file, metadata, process.id)
    }))
  }, [getProcessPMK])

  const uploadFile = useCallback(async (process, file) => {
    if (!x25519KeyPair) throw new Error('Chaves de criptografia não disponíveis. Faça login novamente.')
    if (!process?.id || !process.opaqueProcessRef) throw new Error('Processo cifrado inválido.')
    const processId = process.id

    // ── 1. Obter a PMK que também protege o payload do processo ───────────
    const accessMgr = await getContract('AccessManager')
    const pmkBytes = await getProcessPMK(processId, accessMgr)

    // ── 2. Cifrar e enviar em fluxo, sem carregar o arquivo inteiro em RAM ──
    const pmkKey = await importPMKKey(pmkBytes)
    const encrypted = createSegmentedEncryptedFileStream(file, pmkKey)
    const { cid, size } = await uploadStreamToIPFS(
      processId,
      encrypted.stream,
      encrypted.encryptedSize,
      file.name,
      file.type,
    )

    // ── 4. Cifrar metadados e registrar com referência opaca ──────────────
    const encryptedMetadata = await encryptFileMetadata({
      cid, filename: file.name, mimeType: file.type, fileSize: size,
    }, pmkKey)
    const fileReg = await getContract('BIAFileRegistry')
    await sendContractTransaction({
      operation: 'BIAFileRegistry.addFile',
      method: fileReg.addFile,
      args: [process.opaqueProcessRef, '0x' + bytesToHex(new Uint8Array(encryptedMetadata))],
    })
    return cid
  }, [getProcessPMK, x25519KeyPair])

  const downloadFile = useCallback(async (file) => {
    if (!x25519KeyPair) throw new Error('Chaves de criptografia não disponíveis. Faça login novamente.')

    // ── 1. Obter PMK cifrada do AccessManager ──────────────────────────────
    const accessMgr  = await getContract('AccessManager')
    const pmkBytes = await getProcessPMK(file.processId, accessMgr)

    // ── 3. Baixar e decifrar por blocos quando o arquivo usa o formato v1 ──
    const pmkKey      = await importPMKKey(pmkBytes)
    const encryptedStream = await downloadRawStreamFromIPFS(file.cid)
    const peeked = await peekReadableStream(encryptedStream, 8)
    let plainBuffer
    if (isSegmentedEncryptedHeader(peeked.prefix)) {
      plainBuffer = await new Response(decryptSegmentedFileStream(peeked.stream, pmkKey)).arrayBuffer()
    } else {
      // Arquivos registrados antes do formato segmentado continuam suportados.
      await peeked.cancel()
      const encBuffer = await downloadRawFromIPFS(file.cid)
      plainBuffer = await decrypt(encBuffer, pmkKey)
    }

    // ── 5. Disparar download no browser ───────────────────────────────────
    const blob = new Blob([plainBuffer], { type: file.mimeType || 'application/octet-stream' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = file.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [getProcessPMK, x25519KeyPair])

  const removeFile = useCallback(async (file) => {
    const c  = await getContract('BIAFileRegistry')
    await sendContractTransaction({
      operation: 'BIAFileRegistry.removeFile',
      method: c.removeFile,
      args: [file.id],
    })
    try {
      await unpinFromIPFS(file.cid)
    } catch (e) {
      console.warn(`[useBIA] Unpin falhou para CID ${file.cid}:`, e.message)
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────────

  return {
    processes, loading, error,
    loadProcesses,
    createProcess,
    updateProcess,
    setStatus,
    loadFiles,
    uploadFile,
    downloadFile,
    removeFile,
  }
}
