
'use strict'
const crypto = require('crypto')
const path   = require('path')
const fs     = require('fs')

// ══════════════════════════════════════════════════════════════════════════
// JSON File Store — sem dependências nativas
// Persiste users.json no DATA_DIR (volume nomeado bia-auth-data).
// Dados sobrevivem a restarts de container sem necessidade de reconstruir
// a imagem ou compilar binários nativos.
// ══════════════════════════════════════════════════════════════════════════
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../../data')
const STORE_PATH = path.join(DATA_DIR, 'users.json')

fs.mkdirSync(DATA_DIR, { recursive: true })

// Maps em memória para lookups O(1)
const _byId     = new Map()
const _byEmail  = new Map()
const _byWallet = new Map()

// ── Persistência ──────────────────────────────────────────────────────────
function _persist() {
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(Array.from(_byId.values()), null, 2), 'utf8')
  fs.renameSync(tmp, STORE_PATH)   // atomic swap — evita arquivo corrompido
}

function _load() {
  if (!fs.existsSync(STORE_PATH)) {
    console.log('[UserStore] Nenhum arquivo de dados encontrado — iniciando vazio.')
    return
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    if (!Array.isArray(raw)) return
    for (const user of raw) {
      _byId.set(user.id, user)
      if (user.email)         _byEmail.set(user.email.toLowerCase(), user.id)
      if (user.walletAddress) _byWallet.set(user.walletAddress.toLowerCase(), user.id)
    }
    console.log(`[UserStore] ✅ JSON store: ${_byId.size} usuário(s) — ${STORE_PATH}`)
  } catch (err) {
    console.error('[UserStore] ❌ Erro ao carregar users.json:', err.message)
  }
}

_load()

// ── Helpers ───────────────────────────────────────────────────────────────
function sanitize(user) {
  if (!user) return null
  const { passwordHash, webAuthnPublicKey, webAuthnCredentialId, ...safe } = user
  return safe
}

// ── CRUD ──────────────────────────────────────────────────────────────────
function findById(id) {
  return _byId.get(id) || null
}

function findByEmail(email) {
  if (!email) return null
  const id = _byEmail.get(email.toLowerCase())
  return id ? (_byId.get(id) || null) : null
}

function findByWallet(address) {
  if (!address) return null
  const id = _byWallet.get(address.toLowerCase())
  return id ? (_byId.get(id) || null) : null
}

function listAll() {
  return Array.from(_byId.values())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(u => sanitize(u))
}

async function create({ email = null, walletAddress = '', role = 'VIEWER' }) {
  const normalEmail  = email ? email.toLowerCase() : null
  const normalWallet = (walletAddress || '').toLowerCase()

  if (normalEmail  && _byEmail.has(normalEmail))   throw new Error('E-mail já cadastrado')
  if (normalWallet && _byWallet.has(normalWallet)) throw new Error('Carteira já cadastrada')

  const id  = crypto.randomUUID()
  const now = new Date().toISOString()

  const user = {
    id,
    email:                normalEmail,
    passwordHash:         null,
    walletAddress:        normalWallet,
    role:                 (role || 'VIEWER').toUpperCase(),
    webAuthnRegistered:   false,
    webAuthnCredentialId: null,
    webAuthnPublicKey:    null,
    webAuthnCounter:      0,
    createdAt:            now,
    updatedAt:            now,
  }

  _byId.set(id, user)
  if (normalEmail)  _byEmail.set(normalEmail, id)
  if (normalWallet) _byWallet.set(normalWallet, id)
  _persist()

  return sanitize(user)
}

function update(id, fields) {
  const user = _byId.get(id)
  if (!user) throw new Error('Usuário não encontrado')

  const ALLOWED = new Set([
    'walletAddress', 'role', 'passwordHash',
    'webAuthnRegistered', 'webAuthnCredentialId', 'webAuthnPublicKey', 'webAuthnCounter',
  ])

  for (const [key, val] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue
    if (key === 'walletAddress') {
      if (user.walletAddress) _byWallet.delete(user.walletAddress)
      user.walletAddress = (val || '').toLowerCase()
      if (user.walletAddress) _byWallet.set(user.walletAddress, id)
    } else {
      user[key] = val
    }
  }

  user.updatedAt = new Date().toISOString()
  _persist()
  return sanitize(user)
}

function remove(id) {
  const user = _byId.get(id)
  if (!user) return false
  _byId.delete(id)
  if (user.email)         _byEmail.delete(user.email)
  if (user.walletAddress) _byWallet.delete(user.walletAddress)
  _persist()
  return true
}

// ══════════════════════════════════════════════════════════════════════════
// Seed do admin
// ══════════════════════════════════════════════════════════════════════════
async function seedAdmin() {
  const wallet = (process.env.ADMIN_WALLET || '').toLowerCase()
  const email  = process.env.ADMIN_EMAIL   || null

  if (!wallet) {
    console.warn('[UserStore] ADMIN_WALLET nao definido — admin nao sera criado automaticamente.')
    console.warn('[UserStore] Defina ADMIN_WALLET no .env com o endereco Ethereum do administrador.')
    return
  }

  if (findByWallet(wallet)) {
    console.log('[UserStore] Admin ja existe:', wallet)
    return
  }

  await create({ walletAddress: wallet, role: 'ADMIN', email })
  console.log('[UserStore] Admin inicial criado:', wallet)
  console.log('[UserStore] Para acessar, conecte a carteira:', wallet)
}

module.exports = { findById, findByEmail, findByWallet, listAll, create, update, remove, sanitize, seedAdmin }
