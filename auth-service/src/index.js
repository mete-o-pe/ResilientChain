'use strict'
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const morgan    = require('morgan')
const rateLimit = require('express-rate-limit')
const { version: serviceVersion } = require('../package.json')

const { seedAdmin } = require('./store/userStore')

const app  = express()
const PORT = process.env.PORT || 3001
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 200)
const SERVER_REQUEST_TIMEOUT_MS = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 2 * 60 * 60 * 1000)
const SERVER_HEADERS_TIMEOUT_MS = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 2 * 60 * 60 * 1000 + 60 * 1000)
const SERVER_IDLE_TIMEOUT_MS = Number(process.env.SERVER_IDLE_TIMEOUT_MS || 2 * 60 * 60 * 1000)
const SERVER_KEEP_ALIVE_TIMEOUT_MS = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 65 * 1000)

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas requisicoes. Tente novamente em alguns minutos.' },
}))

// ── Rotas ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({
  status: 'ok', service: 'bia-auth', version: serviceVersion,
  timestamp: new Date().toISOString(),
}))

app.use('/api/auth',  require('./routes/auth'))
app.use('/api/ipfs',  require('./routes/ipfs'))
app.use('/api/users', require('./routes/users'))   // Fase 8

// ── Error handlers ─────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Rota nao encontrada' }))
app.use((err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV === 'development'
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Arquivo excede o limite de ${process.env.MAX_FILE_SIZE_MB || 2048} MB`,
    })
  }
  console.error('[ERROR]', err.message)
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Erro interno do servidor',
  })
})

async function start() {
  await seedAdmin()
  const server = app.listen(PORT, () => {
    console.log([
      '',
      '==========================================',
      `   BIA DApp - Auth Service v${serviceVersion}`,
      '==========================================',
      '  Porta    : ' + PORT,
      '  Ambiente : ' + (process.env.NODE_ENV || 'development'),
      '  Request timeout : ' + SERVER_REQUEST_TIMEOUT_MS + ' ms',
      '  Rotas    : /api/auth  /api/ipfs  /api/users',
      '==========================================',
      '',
    ].join('\n'))
  })
  server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS
  server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS
  server.timeout = SERVER_IDLE_TIMEOUT_MS
  server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS
}

start().catch(err => { console.error(err); process.exit(1) })
