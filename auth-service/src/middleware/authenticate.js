'use strict'
const { verify } = require('../utils/jwt')

/**
 * Middleware que exige Bearer JWT valido.
 * Popula req.user com o payload decodificado.
 */
function authenticate(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticacao obrigatorio' })
  }
  try {
    req.user = verify(token)
    next()
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expirado' : 'Token invalido'
    return res.status(401).json({ error: msg })
  }
}

/**
 * Factory que exige o role especifico alem do JWT valido.
 * Uso: router.get('/rota', authenticate, requireRole('ADMIN'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nao autenticado' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Acesso negado. Perfil necessario: ${roles.join(' ou ')}` })
    }
    next()
  }
}

module.exports = { authenticate, requireRole }
