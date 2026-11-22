'use strict'

const crypto = require('crypto')
const { Readable } = require('stream')
const {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const bucket = process.env.S3_INGRESS_BUCKET || ''
const region = process.env.S3_INGRESS_REGION || process.env.AWS_REGION || 'us-east-1'
const enabled = process.env.S3_INGRESS_ENABLED === 'true' && Boolean(bucket)
const configuredPartSize = Number(process.env.S3_INGRESS_PART_SIZE_MB || 16) * 1024 * 1024
const partSize = Math.max(5 * 1024 * 1024, configuredPartSize)
const urlTtlSeconds = Math.min(Math.max(Number(process.env.S3_INGRESS_URL_TTL_SECONDS || 7200), 60), 7 * 24 * 60 * 60)
const maxFileSize = Number(process.env.MAX_FILE_SIZE_MB || 2050) * 1024 * 1024
const sessions = new Map()
const client = new S3Client({ region })

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function safeFilename(filename) {
  const clean = String(filename || 'file').replace(/[\\/]/g, '_').replace(/\0/g, '')
  return clean.slice(0, 180) || 'file'
}

function assertEnabled() {
  if (!enabled) throw httpError(503, 'Entrada S3 nao esta habilitada neste ambiente')
}

function getSession(sessionId, userId) {
  const session = sessions.get(sessionId)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId)
    throw httpError(404, 'Sessao de upload inexistente ou expirada')
  }
  if (session.userId !== userId) throw httpError(403, 'Sessao de upload nao pertence ao usuario autenticado')
  return session
}

async function start({ processId, filename, mimeType, fileSize, userId }) {
  assertEnabled()
  if (!/^\d+$/.test(String(processId)) || Number(processId) <= 0) throw httpError(400, 'processId invalido')
  const size = Number(fileSize)
  if (!Number.isSafeInteger(size) || size <= 0) throw httpError(400, 'Tamanho de arquivo invalido')
  if (size > maxFileSize) throw httpError(413, `Arquivo excede o limite de ${process.env.MAX_FILE_SIZE_MB || 2050} MB`)

  const cleanName = safeFilename(filename)
  const sessionId = crypto.randomUUID()
  const key = `ingress/${new Date().toISOString().slice(0, 10)}/${sessionId}-${cleanName}`
  const created = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: 'application/octet-stream',
    ServerSideEncryption: 'AES256',
    Metadata: {
      'bia-process-id': String(processId),
      'bia-user-id': String(userId),
      'original-filename': cleanName,
      'original-mime-type': String(mimeType || 'application/octet-stream').slice(0, 128),
    },
  }))

  const partCount = Math.ceil(size / partSize)
  if (partCount > 10000) {
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId }))
    throw httpError(413, 'Arquivo excede o numero maximo de partes S3')
  }

  const expiresAt = Date.now() + urlTtlSeconds * 1000
  const session = {
    sessionId,
    userId,
    processId: String(processId),
    filename: cleanName,
    mimeType: String(mimeType || 'application/octet-stream'),
    fileSize: size,
    key,
    uploadId: created.UploadId,
    partCount,
    expiresAt,
    state: 'uploading',
  }
  sessions.set(sessionId, session)

  const parts = await Promise.all(Array.from({ length: partCount }, async (_value, index) => {
    const partNumber = index + 1
    const url = await getSignedUrl(client, new (require('@aws-sdk/client-s3').UploadPartCommand)({
      Bucket: bucket,
      Key: key,
      UploadId: created.UploadId,
      PartNumber: partNumber,
    }), { expiresIn: urlTtlSeconds })
    return { partNumber, url }
  }))

  return { sessionId, partSize, partCount, expiresAt: new Date(expiresAt).toISOString(), parts }
}

async function complete({ sessionId, userId, parts }) {
  assertEnabled()
  const session = getSession(sessionId, userId)
  if (!Array.isArray(parts) || parts.length !== session.partCount) throw httpError(400, 'Lista de partes incompleta')
  if (session.state === 'completed') return session.result
  if (session.state === 'importing') throw httpError(409, 'Importacao para IPFS em andamento')

  const normalizedParts = parts.map((part, index) => {
    const partNumber = Number(part.partNumber)
    const eTag = String(part.eTag || '')
    if (partNumber !== index + 1 || !eTag) throw httpError(400, 'Partes S3 invalidas')
    return { PartNumber: partNumber, ETag: eTag }
  })

  if (!session.s3Completed) {
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: session.key,
      UploadId: session.uploadId,
      MultipartUpload: { Parts: normalizedParts },
    }))
    session.s3Completed = true
  }
  session.state = 'importing'

  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: session.key }))
    if (Number(object.ContentLength) !== session.fileSize) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: session.key }))
      throw httpError(400, 'Tamanho do objeto S3 diverge da sessao de upload')
    }
    if (!(object.Body instanceof Readable)) throw httpError(502, 'S3 nao retornou um fluxo de dados valido')
    const ipfsSvc = require('./ipfsService')
    const cid = await ipfsSvc.add(object.Body, session.filename)
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: session.key }))
    session.state = 'completed'
    session.result = {
      cid,
      processId: session.processId,
      filename: session.filename,
      mimeType: session.mimeType,
      fileSize: session.fileSize,
    }
    return session.result
  } catch (err) {
    session.state = session.s3Completed ? 'ready-to-retry' : 'uploading'
    throw err
  }
}

async function abort({ sessionId, userId }) {
  assertEnabled()
  const session = getSession(sessionId, userId)
  if (session.state === 'completed') return
  if (!session.s3Completed) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: session.key,
      UploadId: session.uploadId,
    })).catch(() => {})
  } else {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: session.key })).catch(() => {})
  }
  sessions.delete(sessionId)
}

module.exports = { abort, complete, enabled, start }
