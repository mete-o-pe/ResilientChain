'use strict'
const router    = require('express').Router()
const { authenticate, requireRole } = require('../middleware/authenticate')
const userStore = require('../store/userStore')

// GET /api/users/me — perfil do próprio usuário (qualquer usuário autenticado)
router.get('/me', authenticate, (req, res) => {
  const user = userStore.findById(req.user.sub)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })
  res.json({ user: userStore.sanitize(user) })
})

// ── Rotas exclusivas de ADMIN ──────────────────────────────────────────────

// GET /api/users — lista todos
router.get('/', authenticate, requireRole('ADMIN'), (_req, res) => {
  res.json({ users: userStore.listAll() })
})

// POST /api/users — cria usuário
router.post('/', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { walletAddress, role = 'VIEWER', email } = req.body
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
    return res.status(400).json({ error: 'walletAddress obrigatório e deve ser um endereço Ethereum válido' })
  const validRoles = ['ADMIN', 'ANALYST', 'VIEWER']
  if (!validRoles.includes((role || '').toUpperCase()))
    return res.status(400).json({ error: 'Role inválido. Use: ADMIN, ANALYST ou VIEWER' })
  try {
    const user = await userStore.create({ walletAddress, role, email })
    res.status(201).json({ user })
  } catch (e) {
    res.status(409).json({ error: e.message })
  }
})

// PUT /api/users/:id — atualiza role e/ou walletAddress
router.put('/:id', authenticate, requireRole('ADMIN'), (req, res) => {
  const { role, walletAddress } = req.body
  const allowed = {}
  if (role) {
    if (!['ADMIN', 'ANALYST', 'VIEWER'].includes(role.toUpperCase()))
      return res.status(400).json({ error: 'Role inválido' })
    allowed.role = role.toUpperCase()
  }
  if (walletAddress !== undefined) {
    if (walletAddress && !/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
      return res.status(400).json({ error: 'walletAddress inválido: deve ser um endereço Ethereum válido (0x...)' })
    allowed.walletAddress = walletAddress
  }
  try {
    const user = userStore.update(req.params.id, allowed)
    res.json({ user })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// DELETE /api/users/:id — remove usuário
router.delete('/:id', authenticate, requireRole('ADMIN'), (req, res) => {
  if (req.params.id === req.user.sub)
    return res.status(400).json({ error: 'Não é possível remover o próprio usuário' })
  const ok = userStore.remove(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Usuário não encontrado' })
  res.json({ message: 'Usuário removido com sucesso' })
})

module.exports = router
