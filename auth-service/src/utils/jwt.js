'use strict'
const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET
if (!SECRET) throw new Error('[FATAL] JWT_SECRET não definido. Defina-o no .env antes de iniciar o serviço.')

const EXPIRES = process.env.JWT_EXPIRES_IN || '8h'

/**
 * Gera um JWT para o usuario autenticado (apos todos os fatores validados).
 */
function sign(user) {
  return jwt.sign(
    {
      sub:           user.id,
      email:         user.email,
      role:          user.role,
      walletAddress: user.walletAddress,
    },
    SECRET,
    { expiresIn: EXPIRES }
  )
}

/**
 * Verifica e decodifica o JWT. Lanca excecao se invalido/expirado.
 */
function verify(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] })
}

module.exports = { sign, verify }
