'use strict'
const express = require('express')
const Busboy  = require('busboy')
const { Transform } = require('stream')
const ipfsSvc = require('../services/ipfsService')
const s3Ingress = require('../services/s3IngressService')
const { authenticate, requireRole } = require('../middleware/authenticate')

const router = express.Router()

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n)
}

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...fields,
  }))
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function safeFilename(filename) {
  const clean = String(filename || 'file').replace(/[\\/]/g, '_').replace(/\0/g, '')
  return clean || 'file'
}

function parseStreamingUpload(req, started) {
  return new Promise((resolve, reject) => {
    let settled = false
    let requestBytes = 0
    let processId = ''
    let fileSeen = false
    let fileSize = 0
    let filename = ''
    let mimeType = 'application/octet-stream'
    let receiveMs = 0
    let ipfsMs = 0
    let ipfsPromise = null

    function done(err, value) {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value)
    }

    let busboy
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1 },
      })
    } catch (err) {
      done(httpError(400, `Multipart inválido: ${err.message}`))
      return
    }

    req.on('data', chunk => { requestBytes += chunk.length })
    req.on('aborted', () => {
      logMetric('bia_ipfs_upload_aborted', {
        requestBytes,
        elapsedMs: nowMs() - started,
        contentLength: req.headers['content-length'] || '',
        remoteIp: req.ip,
      })
      busboy.destroy(httpError(400, 'Request aborted'))
    })

    busboy.on('field', (name, value) => {
      if (name === 'processId') processId = value
    })

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file') {
        file.resume()
        busboy.destroy(httpError(400, 'Campo de arquivo inválido'))
        return
      }
      if (fileSeen) {
        file.resume()
        busboy.destroy(httpError(400, 'Apenas um arquivo é permitido'))
        return
      }
      if (!processId) {
        file.resume()
        busboy.destroy(httpError(400, 'Campo "processId" deve ser enviado antes do arquivo'))
        return
      }

      fileSeen = true
      filename = safeFilename(info.filename)
      mimeType = info.mimeType || 'application/octet-stream'

      const ipfsStarted = nowMs()
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          fileSize += chunk.length
          callback(null, chunk)
        },
      })

      file.on('limit', () => busboy.destroy(httpError(413, 'Arquivo excede o limite permitido')))
      file.on('error', err => busboy.destroy(err))
      counter.on('error', err => busboy.destroy(err))

      ipfsPromise = ipfsSvc.add(file.pipe(counter), filename)
        .then(cid => {
          ipfsMs = nowMs() - ipfsStarted
          return cid
        })
        .catch(err => {
          busboy.destroy(err)
          throw err
        })
    })

    busboy.on('filesLimit', () => busboy.destroy(httpError(400, 'Apenas um arquivo é permitido')))
    busboy.on('error', err => done(err))
    busboy.on('close', async () => {
      receiveMs = nowMs() - started
      try {
        if (!fileSeen) throw httpError(400, 'Campo "file" obrigatório (multipart/form-data)')
        if (!processId) throw httpError(400, 'Campo "processId" obrigatório')
        const cid = await ipfsPromise
        done(null, {
          cid,
          processId,
          filename,
          mimeType,
          fileSize,
          requestBytes,
          receiveMs,
          ipfsMs,
        })
      } catch (err) {
        done(err)
      }
    })

    req.pipe(busboy)
  })
}

// ── Status do nó IPFS ──────────────────────────────────────────────────────────
/**
 * GET /api/ipfs/status
 * Requer: JWT válido
 */
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const info = await ipfsSvc.nodeInfo()
    res.json({ status: 'ok', cluster: info })
  } catch (err) {
    res.status(503).json({
      status: 'unavailable',
      error: 'Nó IPFS indisponível',
      details: err.message,
    })
  }
})

// ── Upload ─────────────────────────────────────────────────────────────────────
/**
 * POST /api/ipfs/upload
 * Auth: Bearer JWT (ANALYST ou ADMIN)
 * Multipart: campo "file" (já cifrado pelo browser) + campo "processId" (obrigatório)
 *
 * O arquivo chega pré-cifrado pelo browser (AES-256-GCM) e é encaminhado
 * diretamente ao IPFS em streaming, sem nenhuma transformação criptográfica
 * no servidor. A cifragem ocorre integralmente no cliente (ponta a ponta).
 *
 * Resposta: { cid, processId, filename, mimeType, fileSize, uploadedBy, uploadedAt }
 */
router.post(
  '/upload',
  authenticate,
  requireRole('ADMIN', 'ANALYST'),
  async (req, res, next) => {
    const started = nowMs()
    try {
      const uploadResult = await parseStreamingUpload(req, started)
      const totalMs = nowMs() - started

      logMetric('bia_ipfs_upload_complete', {
        cid: uploadResult.cid,
        processId: uploadResult.processId,
        filename: uploadResult.filename,
        fileSize: uploadResult.fileSize,
        requestBytes: uploadResult.requestBytes,
        receiveMs: uploadResult.receiveMs,
        ipfsMs: uploadResult.ipfsMs,
        totalMs,
        streaming: true,
        remoteIp: req.ip,
      })

      res.status(201).json({
        cid:        uploadResult.cid,
        processId:  uploadResult.processId,
        filename:   uploadResult.filename,
        mimeType:   uploadResult.mimeType,
        fileSize:   uploadResult.fileSize,
        uploadedBy: req.user.sub,
        uploadedAt: new Date().toISOString(),
      })
    } catch (err) {
      logMetric('bia_ipfs_upload_error', {
        error: err.message,
        status: err.status || '',
        elapsedMs: nowMs() - started,
        contentLength: req.headers['content-length'] || '',
        remoteIp: req.ip,
      })
      next(err)
    }
  },
)

// ── Entrada multipart S3 ────────────────────────────────────────────────────
// O browser envia somente bytes ja cifrados a um bucket privado, usando URLs
// de curta duracao. O auth-service importa o objeto para IPFS pela rede AWS.
router.get('/s3/config', authenticate, requireRole('ADMIN', 'ANALYST'), (_req, res) => {
  res.json({ enabled: s3Ingress.enabled })
})

router.post('/s3/start', authenticate, requireRole('ADMIN', 'ANALYST'), async (req, res, next) => {
  const started = nowMs()
  try {
    const result = await s3Ingress.start({ ...req.body, userId: req.user.sub })
    logMetric('bia_s3_upload_started', {
      processId: req.body.processId,
      fileSize: req.body.fileSize,
      partCount: result.partCount,
      remoteIp: req.ip,
    })
    res.status(201).json(result)
  } catch (err) {
    logMetric('bia_s3_upload_start_error', { error: err.message, elapsedMs: nowMs() - started, remoteIp: req.ip })
    next(err)
  }
})

router.post('/s3/complete', authenticate, requireRole('ADMIN', 'ANALYST'), async (req, res, next) => {
  const started = nowMs()
  try {
    const result = await s3Ingress.complete({ ...req.body, userId: req.user.sub })
    logMetric('bia_s3_upload_complete', {
      cid: result.cid,
      processId: result.processId,
      fileSize: result.fileSize,
      totalMs: nowMs() - started,
      remoteIp: req.ip,
    })
    res.status(201).json({ ...result, uploadedBy: req.user.sub, uploadedAt: new Date().toISOString() })
  } catch (err) {
    logMetric('bia_s3_upload_complete_error', { error: err.message, elapsedMs: nowMs() - started, remoteIp: req.ip })
    next(err)
  }
})

router.post('/s3/abort', authenticate, requireRole('ADMIN', 'ANALYST'), async (req, res, next) => {
  try {
    await s3Ingress.abort({ sessionId: req.body.sessionId, userId: req.user.sub })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ── Download ───────────────────────────────────────────────────────────────────
/**
 * GET /api/ipfs/download/:cid
 * Auth: Bearer JWT (qualquer role autenticada)
 *
 * Retorna os bytes cifrados do IPFS sem qualquer transformação.
 * A decifração ocorre integralmente no browser do cliente (ponta a ponta).
 */
router.get('/download/:cid', authenticate, async (req, res, next) => {
  const started = nowMs()
  try {
    const { cid } = req.params
    if (!/^[a-zA-Z0-9]{10,100}$/.test(cid))
      return res.status(400).json({ error: 'CID inválido' })

    const ipfsStream = await ipfsSvc.catStream(cid)
    let bytesSent = 0
    let completed = false

    res.set({
      'Content-Type':        'application/octet-stream',
      'X-IPFS-CID':          cid,
      'X-IPFS-Node':         ipfsStream.biaIpfsNode || 'unknown',
      'Content-Disposition': `attachment; filename="${cid}"`,
    })

    ipfsStream.on('data', chunk => { bytesSent += chunk.length })
    ipfsStream.on('error', err => {
      logMetric('bia_ipfs_download_stream_error', {
        cid,
        error: err.message,
        bytesSent,
        elapsedMs: nowMs() - started,
        remoteIp: req.ip,
      })
    })
    res.on('finish', () => {
      completed = true
      logMetric('bia_ipfs_download_complete', {
        cid,
        bytesSent,
        elapsedMs: nowMs() - started,
        remoteIp: req.ip,
      })
    })
    res.on('close', () => {
      if (!completed) {
        logMetric('bia_ipfs_download_aborted', {
          cid,
          bytesSent,
          elapsedMs: nowMs() - started,
          remoteIp: req.ip,
        })
      }
    })

    // Encaminhar bytes cifrados diretamente ao cliente — sem decifração no servidor
    ipfsStream.pipe(res)
  } catch (err) {
    const is404 = err.status === 404 || err.response?.status === 500 || err.response?.status === 404
    if (is404) return res.status(404).json({ error: 'Arquivo não encontrado no IPFS', cid: req.params.cid })
    next(err)
  }
})

// ── Unpin / Remoção ────────────────────────────────────────────────────────────
/**
 * DELETE /api/ipfs/unpin/:cid
 * Auth: Bearer JWT (ANALYST ou ADMIN)
 *
 * Remove o pin recursivo do CID e apaga a entrada correspondente no MFS.
 * Idempotente: se o CID não estiver pinado, retorna sucesso sem erro.
 *
 * Resposta: { success: true, cid, message }
 */
router.delete(
  '/unpin/:cid',
  authenticate,
  requireRole('ADMIN', 'ANALYST'),
  async (req, res, next) => {
    try {
      const { cid } = req.params
      if (!cid) return res.status(400).json({ error: 'CID obrigatório' })
      if (!/^[a-zA-Z0-9]{10,100}$/.test(cid))
        return res.status(400).json({ error: 'CID inválido' })

      await ipfsSvc.unpin(cid)
      res.json({ success: true, cid, message: 'Arquivo desafixado e removido do MFS.' })
    } catch (err) {
      // Idempotente: "not pinned" não é erro para o cliente
      const msg = err?.response?.data?.Message ?? err.message ?? ''
      if (msg.toLowerCase().includes('not pinned')) {
        return res.json({ success: true, cid: req.params.cid, message: 'CID não estava pinado.' })
      }
      next(err)
    }
  },
)

// ── Pin check ──────────────────────────────────────────────────────────────────
/**
 * GET /api/ipfs/pin/:cid
 * Verifica se o CID está disponível e pinado no nó local
 */
router.get('/pin/:cid', authenticate, async (req, res, next) => {
  try {
    res.json(await ipfsSvc.pinStatus(req.params.cid))
  } catch (err) { next(err) }
})

module.exports = router
