'use strict'
const express      = require('express')
const crypto       = require('crypto')
const { ethers }   = require('ethers')
const rateLimit    = require('express-rate-limit')

const userStore    = require('../store/userStore')
const sessionStore = require('../store/sessionStore')
const jwtUtil      = require('../utils/jwt')
const { authenticate } = require('../middleware/authenticate')

const router = express.Router()

const walletLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
})

// ── Etapa 1: Solicita desafio (nonce) para a carteira ────────────────────
router.post('/wallet-challenge', walletLimit, (req, res, next) => {
  try {
    const { walletAddress } = req.body
    if (!walletAddress || typeof walletAddress !== 'string')
      return res.status(400).json({ error: 'walletAddress obrigatorio' })
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
      return res.status(400).json({ error: 'walletAddress invalido' })

    const user = userStore.findByWallet(walletAddress.toLowerCase())
    if (!user) return res.status(404).json({ error: 'Carteira nao autorizada' })

    const nonce     = _generateNonce()
    const sessionId = sessionStore.create(user.id, 'wallet', { nonce })
    res.json({ sessionId, nonce })
  } catch (err) { next(err) }
})

// ── Etapa 2: Verifica assinatura e emite JWT ───────────────────────── ────────────────────────
router.post('/wallet-verify', walletLimit, async (req, res, next) => {
  try {
    const { sessionId, signature } = req.body
    if (!sessionId || !signature)
      return res.status(400).json({ error: 'sessionId e signature obrigatorios' })

    const session = sessionStore.get(sessionId)
    if (!session || session.step !== 'wallet')
      return res.status(400).json({ error: 'Sessao invalida ou expirada' })

    const user = userStore.findById(session.userId)
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' })

    let recoveredAddress
    try {
      recoveredAddress = ethers.verifyMessage(session.nonce, signature)
    } catch {
      return res.status(401).json({ error: 'Assinatura invalida' })
    }

    if (recoveredAddress.toLowerCase() !== user.walletAddress.toLowerCase())
      return res.status(401).json({ error: 'Carteira nao autorizada para este usuario' })

    sessionStore.destroy(sessionId)

    const freshUser = userStore.findById(user.id)
    const token     = jwtUtil.sign(freshUser)
    res.json({ token, user: userStore.sanitize(freshUser) })
  } catch (err) { next(err) }
})

// ── /me e /logout ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = userStore.findById(req.user.sub)
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' })
  res.json({ user: userStore.sanitize(user) })
})

router.post('/logout', (req, res) => {
  if (req.body?.sessionId) sessionStore.destroy(req.body.sessionId)
  res.json({ status: 'ok' })
})

function _generateNonce() {
  return 'BIA_DAPP_LOGIN_' + crypto.randomBytes(32).toString('hex')
}

module.exports = router
