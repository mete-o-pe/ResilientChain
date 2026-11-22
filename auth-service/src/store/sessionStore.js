'use strict'
const crypto = require('crypto')

/**
 * Store de sessoes temporárias para o fluxo de login multietapas.
 * Sessoes expiram automaticamente (TTL configurável via .env).
 *
 * Etapas:
 *   'mfa_setup'   → usuario ainda nao configurou MFA
 *   'mfa'         → aguardando validacao do TOTP
 *   'wallet'      → MFA ok, aguardando assinatura da carteira
 */
const _sessions = new Map()
const TTL_MS = (parseInt(process.env.NONCE_TTL_SECONDS, 10) || 300) * 1000

// Limpeza periodica de sessoes expiradas (a cada 60s)
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of _sessions) {
    if (now > s.expiresAt) _sessions.delete(id)
  }
}, 60_000)

function create(userId, step, extra = {}) {
  const id = crypto.randomBytes(32).toString('hex')
  _sessions.set(id, {
    userId,
    step,
    ...extra,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  })
  return id
}

function get(sessionId) {
  const s = _sessions.get(sessionId)
  if (!s) return null
  if (Date.now() > s.expiresAt) {
    _sessions.delete(sessionId)
    return null
  }
  return s
}

function advance(sessionId, newStep, extra = {}) {
  const s = get(sessionId)
  if (!s) return null
  Object.assign(s, { step: newStep, ...extra, expiresAt: Date.now() + TTL_MS })
  return s
}

function destroy(sessionId) {
  _sessions.delete(sessionId)
}

module.exports = { create, get, advance, destroy }
