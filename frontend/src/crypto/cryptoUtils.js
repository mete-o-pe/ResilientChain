/**
 * Utilitários de criptografia — Web Crypto API (browser nativo).
 *
 * MODELO DE SEGURANÇA (envelope encryption ponta a ponta):
 *
 *  1. Derivação do par de chaves X25519 (determinística por carteira):
 *       MetaMask.signMessage(FIXED_SIGN_MESSAGE)
 *         → PBKDF2-SHA256 (100.000 iter, salt fixo)
 *         → semente 32 bytes
 *         → par de chaves ECDH X25519 via importação PKCS#8
 *
 *  2. Cifração da PMK — envelope ECIES, blob de 92 bytes:
 *       Gera par efêmero X25519
 *       ECDH(efêmero_privado, destinatário_público) → segredo 32 bytes
 *         → HKDF-SHA256 (info="bia-pmk-kek-v1") → KEK
 *         → AES-256-GCM(KEK, IV=random, PMK=32 bytes)
 *       Blob: [ephPub:32][IV:12][ciphertext(32+tag16):48] = 92 bytes
 *
 *  3. Cifração de arquivos (browser, antes do upload):
 *       PMK (32 bytes) → AES-256-GCM com IV aleatório
 *       Blob: [IV:12][tag:16][ciphertext:N]
 *
 * O auth-service é proxy transparente para o IPFS — nunca vê o conteúdo em claro.
 * Toda a criptografia ocorre no browser.
 */

const ALG = { name: 'AES-GCM', length: 256 }
const FILE_STREAM_MAGIC = new TextEncoder().encode('BIAFSTRM')
const FILE_STREAM_VERSION = 1
const FILE_STREAM_HEADER_SIZE = 32
const FILE_STREAM_TAG_SIZE = 16
export const FILE_STREAM_CHUNK_SIZE = 4 * 1024 * 1024
export const MAX_OBSERVATIONS_BYTES = 4_000
export const MAX_ENCRYPTED_PROCESS_DATA_BYTES = 8_192
export const MAX_ENCRYPTED_FILE_METADATA_BYTES = 2_048

const PROCESS_PAYLOAD_AAD = new TextEncoder().encode('bia-process-payload-v1')
const FILE_METADATA_AAD  = new TextEncoder().encode('bia-file-metadata-v1')

/** Mensagem fixa assinada pelo MetaMask para derivação determinística de chaves. */
export const FIXED_SIGN_MESSAGE = 'BIA DApp Key Derivation v1'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** base64url → Uint8Array */
function base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
             + '='.repeat((4 - str.length % 4) % 4)
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/** Uint8Array → hex string sem prefixo 0x */
export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** hex string (com ou sem 0x) → Uint8Array */
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!h) return new Uint8Array(0)
  return new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16)))
}

// Prefixo PKCS#8 / OneAsymmetricKey DER para X25519 (RFC 8410)
// SEQUENCE { INTEGER 0; SEQUENCE { OID 1.3.101.110 }; OCTET STRING { OCTET STRING { [32 bytes] } } }
const X25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e,                          // SEQUENCE, 46 bytes
  0x02, 0x01, 0x00,                    // INTEGER 0 (version)
  0x30, 0x05,                          // SEQUENCE, 5 bytes (AlgorithmIdentifier)
    0x06, 0x03, 0x2b, 0x65, 0x6e,      // OID 1.3.101.110 (id-X25519)
  0x04, 0x22,                          // OCTET STRING, 34 bytes
    0x04, 0x20,                        // OCTET STRING, 32 bytes (raw private key)
])

// PBKDF2 salt fixo — a aleatoriedade vem da assinatura da carteira
const PBKDF2_SALT = new TextEncoder().encode('bia-x25519-v1')
const PBKDF2_ITER = 100_000

// ── Derivação do par de chaves X25519 ─────────────────────────────────────────

/**
 * Deriva um par de chaves X25519 determinístico a partir da assinatura MetaMask
 * sobre a mensagem fixa FIXED_SIGN_MESSAGE.
 *
 * Fluxo: assinatura(65 bytes) → PBKDF2-SHA256(100k iter) → semente(32 bytes)
 *        → PKCS#8 DER → importKey X25519 → extrai pubKey via JWK
 *
 * @param {string} walletSignature  Hex string (0x...) — 65 bytes
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey, pubKeyBytes: Uint8Array }>}
 */
export async function deriveX25519KeyPair(walletSignature) {
  const sigBytes = hexToBytes(walletSignature)

  // PBKDF2: assinatura → semente de 32 bytes
  const sigKey = await crypto.subtle.importKey(
    'raw', sigBytes, 'PBKDF2', false, ['deriveBits']
  )
  const seedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: PBKDF2_SALT, iterations: PBKDF2_ITER },
    sigKey, 256
  )
  const seed = new Uint8Array(seedBits)

  // Montar PKCS#8: prefix(16 bytes) + semente(32 bytes) = 48 bytes
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + 32)
  pkcs8.set(X25519_PKCS8_PREFIX)
  pkcs8.set(seed, X25519_PKCS8_PREFIX.length)

  // Importar chave privada X25519
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer,
    { name: 'X25519' },
    true,
    ['deriveBits']
  )

  // Extrair chave pública via JWK (campo 'x' = base64url dos 32 bytes públicos)
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const pubKeyBytes = base64urlToBytes(jwk.x)

  // Importar chave pública (usada para verificação e por terceiros para cifrar PMK)
  const publicKey = await crypto.subtle.importKey(
    'raw', pubKeyBytes,
    { name: 'X25519' },
    true, []
  )

  return { privateKey, publicKey, pubKeyBytes }
}

// ── PMK — geração e importação ────────────────────────────────────────────────

/**
 * Gera uma PMK aleatória de 32 bytes (AES-256 key material).
 * @returns {Uint8Array}
 */
export function generatePMK() {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Importa 32 bytes brutos como CryptoKey AES-256-GCM.
 * @param {Uint8Array|ArrayBuffer} rawBytes
 * @returns {Promise<CryptoKey>}
 */
export async function importPMKKey(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, ALG, false, ['encrypt', 'decrypt'])
}

// ── Envelope encryption da PMK (ECIES sobre X25519) ──────────────────────────

/**
 * Cifra uma PMK (32 bytes) para um destinatário usando ECIES sobre X25519.
 *
 * Algoritmo:
 *   1. Gera par de chaves X25519 efêmero
 *   2. ECDH(efêmero_privado, destinatário_público) → segredo 32 bytes
 *   3. HKDF-SHA256(segredo, salt=zeros32, info="bia-pmk-kek-v1") → KEK
 *   4. AES-256-GCM(KEK, IV=random, PMK) → ciphertext (32 PMK + 16 tag = 48 bytes)
 *
 * @param {Uint8Array} pmkBytes            - 32 bytes da PMK
 * @param {Uint8Array} recipientPubKeyBytes - 32 bytes da chave pública X25519 do destinatário
 * @returns {Promise<Uint8Array>}          - 92 bytes: [ephPub:32][IV:12][cipher:48]
 */
export async function encryptPMK(pmkBytes, recipientPubKeyBytes) {
  // 1. Par efêmero X25519
  const ephKeyPair = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits']
  )

  // 2. X25519: efêmero × destinatário → segredo
  const recipientPub = await crypto.subtle.importKey(
    'raw', recipientPubKeyBytes,
    { name: 'X25519' }, false, []
  )
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: recipientPub },
    ephKeyPair.privateKey, 256
  )

  // 3. HKDF → KEK
  const hkdfBase = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  const kek = await crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('bia-pmk-kek-v1'),
    },
    hkdfBase, ALG, false, ['encrypt']
  )

  // 4. AES-256-GCM: cifrar PMK
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, pmkBytes)
  // cipher = ciphertext(32) + tag(16) = 48 bytes

  // Exportar chave pública efêmera (32 bytes via JWK)
  const ephJwk = await crypto.subtle.exportKey('jwk', ephKeyPair.publicKey)
  const ephPubBytes = base64urlToBytes(ephJwk.x)

  // Montar blob: [ephPub:32][IV:12][cipher:48] = 92 bytes
  const blob = new Uint8Array(92)
  blob.set(ephPubBytes,        0)
  blob.set(iv,                32)
  blob.set(new Uint8Array(cipher), 44)
  return blob
}

/**
 * Decifra uma PMK cifrada por encryptPMK.
 *
 * @param {Uint8Array|ArrayBuffer} encryptedBlob - 92 bytes
 * @param {CryptoKey} recipientPrivateKey        - chave privada X25519 do destinatário
 * @returns {Promise<Uint8Array>}                - 32 bytes da PMK
 */
export async function decryptPMK(encryptedBlob, recipientPrivateKey) {
  const blob = new Uint8Array(encryptedBlob)
  if (blob.length !== 92) throw new Error(`encryptedBlob deve ter 92 bytes, recebeu ${blob.length}`)

  const ephPubBytes = blob.slice(0, 32)
  const iv          = blob.slice(32, 44)
  const ciphertext  = blob.slice(44)       // 48 bytes (32 PMK + 16 tag)

  // Importar chave pública efêmera
  const ephPub = await crypto.subtle.importKey(
    'raw', ephPubBytes,
    { name: 'X25519' }, false, []
  )

  // X25519: destinatário × efêmero → segredo
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: ephPub },
    recipientPrivateKey, 256
  )

  // HKDF → KEK
  const hkdfBase = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  const kek = await crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('bia-pmk-kek-v1'),
    },
    hkdfBase, ALG, false, ['decrypt']
  )

  // Decifrar PMK
  const pmk = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ciphertext)
  return new Uint8Array(pmk)
}

// ── Cifração de arquivos ──────────────────────────────────────────────────────

/**
 * Criptografa um ArrayBuffer com AES-256-GCM usando a PMK.
 * Formato de saída: [IV:12][tag:16][ciphertext:N]
 *
 * @param {ArrayBuffer} plainBuffer
 * @param {CryptoKey}   key  - AES-256-GCM CryptoKey
 * @returns {Promise<ArrayBuffer>}
 */
export async function encrypt(plainBuffer, key, additionalData = null) {
  const iv         = crypto.getRandomValues(new Uint8Array(12))
  const algorithm = { name: 'AES-GCM', iv }
  if (additionalData) algorithm.additionalData = additionalData
  const cipherData = await crypto.subtle.encrypt(algorithm, key, plainBuffer)
  // Web Crypto retorna [ciphertext + tag] — reordenamos para [IV + tag + ciphertext]
  const ct     = new Uint8Array(cipherData)
  const tag    = ct.slice(ct.length - 16)
  const ctOnly = ct.slice(0, ct.length - 16)
  const out    = new Uint8Array(12 + 16 + ctOnly.length)
  out.set(iv,     0)
  out.set(tag,    12)
  out.set(ctOnly, 28)
  return out.buffer
}

/**
 * Descriptografa um ArrayBuffer no formato [IV:12][tag:16][ciphertext:N].
 *
 * @param {ArrayBuffer} encBuffer
 * @param {CryptoKey}   key  - AES-256-GCM CryptoKey
 * @returns {Promise<ArrayBuffer>}
 */
export async function decrypt(encBuffer, key, additionalData = null) {
  const buf    = new Uint8Array(encBuffer)
  if (buf.length <= 28) throw new Error('Payload cifrado vazio ou inválido')
  const iv     = buf.slice(0, 12)
  const tag    = buf.slice(12, 28)
  const ctOnly = buf.slice(28)
  // Web Crypto espera [ciphertext + tag]
  const combined = new Uint8Array(ctOnly.length + 16)
  combined.set(ctOnly, 0)
  combined.set(tag, ctOnly.length)
  const algorithm = { name: 'AES-GCM', iv }
  if (additionalData) algorithm.additionalData = additionalData
  return crypto.subtle.decrypt(algorithm, key, combined)
}

// ── Payloads cifrados de processo e metadados de arquivo ─────────────────────

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function assertIntegerInRange(value, name, min, max) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} inválido`)
  }
  return parsed
}

function assertOpaqueProcessRef(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Referência opaca de anexos inválida')
  }
  return value.toLowerCase()
}

/** Gera a referência aleatória que vincula anexos sem expor o ID do processo. */
export function generateOpaqueProcessRef() {
  return '0x' + bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
}

function normalizeProcessPayload(params, opaqueProcessRef) {
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  const businessUnit = typeof params.businessUnit === 'string' ? params.businessUnit.trim() : ''
  const observations = typeof params.observations === 'string' ? params.observations : ''
  if (!name) throw new Error('Nome do processo é obrigatório.')
  if (utf8ByteLength(observations) > MAX_OBSERVATIONS_BYTES) {
    throw new Error(`Observações excedem o limite de ${MAX_OBSERVATIONS_BYTES} bytes.`)
  }

  return {
    version: 1,
    name,
    businessUnit,
    criticality: assertIntegerInRange(params.criticality, 'Criticidade', 0, 3),
    rto: assertIntegerInRange(params.rto, 'RTO', 1, 0xffffffff),
    rpo: assertIntegerInRange(params.rpo, 'RPO', 1, 0xffffffff),
    mao: assertIntegerInRange(params.mao, 'MAO', 1, 0xffffffff),
    financialImpact: assertIntegerInRange(params.financialImpact, 'Impacto financeiro', 1, 5),
    operationalImpact: assertIntegerInRange(params.operationalImpact, 'Impacto operacional', 1, 5),
    reputationalImpact: assertIntegerInRange(params.reputationalImpact, 'Impacto reputacional', 1, 5),
    regulatoryImpact: assertIntegerInRange(params.regulatoryImpact, 'Impacto regulatório', 1, 5),
    observations,
    opaqueProcessRef: assertOpaqueProcessRef(opaqueProcessRef),
  }
}

/** Cifra os dados de negócio de um processo com a PMK. */
export async function encryptProcessPayload(params, opaqueProcessRef, key) {
  const payload = normalizeProcessPayload(params, opaqueProcessRef)
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await encrypt(plain, key, PROCESS_PAYLOAD_AAD)
  if (encrypted.byteLength > MAX_ENCRYPTED_PROCESS_DATA_BYTES) {
    throw new Error('Dados do processo excedem o limite de armazenamento cifrado.')
  }
  return encrypted
}

/** Decifra e valida um payload de processo antes de entregá-lo à interface. */
export async function decryptProcessPayload(encryptedBuffer, key) {
  let payload
  try {
    const plain = await decrypt(encryptedBuffer, key, PROCESS_PAYLOAD_AAD)
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    throw new Error('Não foi possível decifrar os dados deste processo.')
  }
  if (!payload || payload.version !== 1) throw new Error('Formato de processo cifrado não suportado.')
  return normalizeProcessPayload(payload, payload.opaqueProcessRef)
}

/** Cifra CID e metadados do arquivo; nenhum deles é registrado em claro. */
export async function encryptFileMetadata({ cid, filename, mimeType, fileSize }, key) {
  if (typeof cid !== 'string' || !cid) throw new Error('CID inválido')
  if (typeof filename !== 'string' || !filename) throw new Error('Nome do arquivo inválido')
  const safeSize = assertIntegerInRange(fileSize, 'Tamanho do arquivo', 0, Number.MAX_SAFE_INTEGER)
  const plain = new TextEncoder().encode(JSON.stringify({ version: 1, cid, filename, mimeType: mimeType || 'application/octet-stream', fileSize: safeSize }))
  const encrypted = await encrypt(plain, key, FILE_METADATA_AAD)
  if (encrypted.byteLength > MAX_ENCRYPTED_FILE_METADATA_BYTES) {
    throw new Error('Metadados do arquivo excedem o limite permitido.')
  }
  return encrypted
}

export async function decryptFileMetadata(encryptedBuffer, key) {
  let metadata
  try {
    const plain = await decrypt(encryptedBuffer, key, FILE_METADATA_AAD)
    metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    throw new Error('Não foi possível decifrar os metadados deste arquivo.')
  }
  if (!metadata || metadata.version !== 1 || typeof metadata.cid !== 'string' || !metadata.cid || typeof metadata.filename !== 'string' || !metadata.filename) {
    throw new Error('Formato de metadados cifrados não suportado.')
  }
  return {
    cid: metadata.cid,
    filename: metadata.filename,
    mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream',
    fileSize: assertIntegerInRange(metadata.fileSize, 'Tamanho do arquivo', 0, Number.MAX_SAFE_INTEGER),
  }
}

// ── Cifragem segmentada de arquivos ──────────────────────────────────────────
// Formato v1 (todos os inteiros em big-endian):
//   header[32] = magic[8] | version[1] | reserved[3] | chunkSize[4] |
//                plainSize[8] | noncePrefix[8]
//   payload    = AES-GCM(chunk_0) | AES-GCM(chunk_1) | ...
// Cada bloco usa IV = noncePrefix[8] || chunkIndex[4] e AAD = header || index.
// O formato e autoidentificavel e arquivos legados seguem no caminho encrypt().

function buildFileStreamHeader(plainSize, chunkSize, noncePrefix) {
  const header = new Uint8Array(FILE_STREAM_HEADER_SIZE)
  header.set(FILE_STREAM_MAGIC, 0)
  header[8] = FILE_STREAM_VERSION
  const view = new DataView(header.buffer)
  view.setUint32(12, chunkSize, false)
  view.setBigUint64(16, BigInt(plainSize), false)
  header.set(noncePrefix, 24)
  return header
}

function parseFileStreamHeader(header) {
  if (header.length !== FILE_STREAM_HEADER_SIZE) throw new Error('Cabecalho de arquivo cifrado incompleto')
  if (!FILE_STREAM_MAGIC.every((byte, index) => header[index] === byte)) return null
  if (header[8] !== FILE_STREAM_VERSION) throw new Error(`Versao de arquivo cifrado nao suportada: ${header[8]}`)

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const chunkSize = view.getUint32(12, false)
  const plainSize = view.getBigUint64(16, false)
  if (chunkSize < 64 * 1024 || chunkSize > 64 * 1024 * 1024) throw new Error('Tamanho de bloco cifrado invalido')
  if (plainSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Arquivo excede o limite seguro do browser')
  return { chunkSize, plainSize: Number(plainSize), noncePrefix: header.slice(24, 32), header: header.slice() }
}

function chunkIv(noncePrefix, index) {
  const iv = new Uint8Array(12)
  iv.set(noncePrefix, 0)
  new DataView(iv.buffer).setUint32(8, index, false)
  return iv
}

function chunkAad(header, index) {
  const aad = new Uint8Array(FILE_STREAM_HEADER_SIZE + 4)
  aad.set(header, 0)
  new DataView(aad.buffer).setUint32(FILE_STREAM_HEADER_SIZE, index, false)
  return aad
}

async function* encryptFileChunks(file, key, chunkSize) {
  const noncePrefix = crypto.getRandomValues(new Uint8Array(8))
  const header = buildFileStreamHeader(file.size, chunkSize, noncePrefix)
  yield header

  const reader = file.stream().getReader()
  let pending = new Uint8Array(chunkSize)
  let pendingLength = 0
  let chunkIndex = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let source = new Uint8Array(value)
      let offset = 0

      while (offset < source.length) {
        const copied = Math.min(chunkSize - pendingLength, source.length - offset)
        pending.set(source.subarray(offset, offset + copied), pendingLength)
        pendingLength += copied
        offset += copied

        if (pendingLength === chunkSize) {
          const cipher = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: chunkIv(noncePrefix, chunkIndex), additionalData: chunkAad(header, chunkIndex) },
            key,
            pending,
          )
          yield new Uint8Array(cipher)
          pending = new Uint8Array(chunkSize)
          pendingLength = 0
          chunkIndex += 1
        }
      }
    }

    if (pendingLength > 0) {
      const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: chunkIv(noncePrefix, chunkIndex), additionalData: chunkAad(header, chunkIndex) },
        key,
        pending.subarray(0, pendingLength),
      )
      yield new Uint8Array(cipher)
    }
  } finally {
    reader.releaseLock()
  }
}

function iterableToReadableStream(iterable) {
  const iterator = iterable[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

/**
 * Cria um fluxo cifrado sem carregar o File inteiro na memoria.
 * @returns {{ stream: ReadableStream<Uint8Array>, encryptedSize: number, chunkSize: number }}
 */
export function createSegmentedEncryptedFileStream(file, key, chunkSize = FILE_STREAM_CHUNK_SIZE) {
  if (!(file instanceof Blob)) throw new Error('Arquivo invalido para cifragem segmentada')
  if (!Number.isSafeInteger(file.size)) throw new Error('Tamanho de arquivo invalido')
  const chunkCount = Math.ceil(file.size / chunkSize)
  const encryptedSize = FILE_STREAM_HEADER_SIZE + file.size + chunkCount * FILE_STREAM_TAG_SIZE
  return {
    stream: iterableToReadableStream(encryptFileChunks(file, key, chunkSize)),
    encryptedSize,
    chunkSize,
  }
}

class StreamByteReader {
  constructor(stream) {
    this.reader = stream.getReader()
    this.pending = new Uint8Array(0)
  }

  async readExactly(length) {
    const out = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      if (this.pending.length === 0) {
        const { done, value } = await this.reader.read()
        if (done) throw new Error('Arquivo cifrado truncado')
        this.pending = new Uint8Array(value)
      }
      const copied = Math.min(length - offset, this.pending.length)
      out.set(this.pending.subarray(0, copied), offset)
      this.pending = this.pending.subarray(copied)
      offset += copied
    }
    return out
  }

  async close() {
    await this.reader.cancel()
    this.reader.releaseLock()
  }
}

/** Retorna true quando os bytes iniciais representam o formato segmentado v1. */
export function isSegmentedEncryptedHeader(bytes) {
  const value = new Uint8Array(bytes)
  return value.length >= FILE_STREAM_MAGIC.length
    && FILE_STREAM_MAGIC.every((byte, index) => value[index] === byte)
}

/**
 * Decifra um ReadableStream no formato segmentado v1, mantendo no maximo um
 * bloco em memoria. O chamador consome o stream de texto claro resultante.
 */
export function decryptSegmentedFileStream(stream, key) {
  const source = new StreamByteReader(stream)
  let initialized = false
  let metadata
  let chunkIndex = 0
  let bytesRemaining = 0

  return new ReadableStream({
    async pull(controller) {
      try {
        if (!initialized) {
          const header = await source.readExactly(FILE_STREAM_HEADER_SIZE)
          metadata = parseFileStreamHeader(header)
          if (!metadata) throw new Error('Formato de arquivo cifrado legado')
          bytesRemaining = metadata.plainSize
          initialized = true
        }
        if (bytesRemaining === 0) {
          await source.close()
          controller.close()
          return
        }

        const plainLength = Math.min(metadata.chunkSize, bytesRemaining)
        const cipher = await source.readExactly(plainLength + FILE_STREAM_TAG_SIZE)
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: chunkIv(metadata.noncePrefix, chunkIndex), additionalData: chunkAad(metadata.header, chunkIndex) },
          key,
          cipher,
        )
        bytesRemaining -= plainLength
        chunkIndex += 1
        controller.enqueue(new Uint8Array(plain))
      } catch (err) {
        await source.close().catch(() => {})
        controller.error(err)
      }
    },
    async cancel() {
      await source.close()
    },
  })
}

// ── Compat: derivação de PMK por assinatura (legado) ─────────────────────────

/**
 * @deprecated Use o fluxo de envelope encryption (encryptPMK/decryptPMK).
 * Mantido apenas para compatibilidade com testes de integração do servidor.
 */
export async function deriveProcessKey(walletSignature, processId) {
  const hex  = walletSignature.startsWith('0x') ? walletSignature.slice(2) : walletSignature
  const seed = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)))
  const baseKey = await crypto.subtle.importKey(
    'raw', seed, { name: 'HKDF' }, false, ['deriveKey']
  )
  const info = new TextEncoder().encode(`bia-pmk-v1-${processId}`)
  const salt = new Uint8Array(32)
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey, ALG, true, ['encrypt', 'decrypt']
  )
}
