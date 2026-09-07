import crypto from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './database.mjs'

const app = express()
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const gatewayUrl = (process.env.LLM_GATEWAY_URL || 'https://aiapimgrapi.aidigitcloud.cn').replace(/\/$/, '')
const gatewayKey = process.env.LLM_GATEWAY_API_KEY
const tenantId = process.env.LLM_GATEWAY_TENANT || 'Japan'
const accessPassword = process.env.ACCESS_PASSWORD || ''
const database = createDatabase(process.env.DATABASE_URL)

app.set('trust proxy', 1)
app.use(express.json({ limit: '8mb' }))

function sha256buf(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest()
}

function safeEqualStr(left, right) {
  return crypto.timingSafeEqual(sha256buf(left), sha256buf(right))
}

function accessToken() {
  return crypto.createHmac('sha256', accessPassword).update('kotonoha-access-v1').digest('hex')
}

function readBearer(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  const fallback = req.headers['x-access-token']
  return fallback ? String(fallback).trim() : ''
}

function rateLimit(windowMs, max) {
  const hits = new Map()
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const key = `${req.path}:${ip}`
    const now = Date.now()
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs)
    if (recent.length >= max) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试。' })
    }
    recent.push(now)
    hits.set(key, recent)
    next()
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    const db = await database.health()
    res.json({
      ok: true,
      database: { connected: true, name: db.database },
      llmConfigured: Boolean(gatewayKey),
      authRequired: Boolean(accessPassword),
      provider: 'AIapiMgr',
      tenant: tenantId,
    })
  } catch (error) {
    res.status(503).json({ ok: false, database: { connected: false }, error: error.message })
  }
})

app.get('/api/auth/check', (req, res) => {
  if (!accessPassword) return res.json({ ok: true, required: false })
  const token = readBearer(req)
  res.json({ ok: Boolean(token && safeEqualStr(token, accessToken())), required: true })
})

app.post('/api/auth/login', rateLimit(60_000, 8), (req, res) => {
  if (!accessPassword) return res.json({ ok: true, token: '', required: false })
  const password = req.body?.password != null ? String(req.body.password) : ''
  if (!password || !safeEqualStr(password, accessPassword)) {
    return res.status(401).json({ error: 'invalid_password', message: '密码错误' })
  }
  res.json({ ok: true, token: accessToken(), required: true })
})

app.use('/api', (req, res, next) => {
  if (!accessPassword) return next()
  if (req.path === '/health' || req.path === '/auth/check' || req.path === '/auth/login') return next()
  const token = readBearer(req)
  if (!token || !safeEqualStr(token, accessToken())) {
    return res.status(401).json({ error: 'unauthorized', message: '请先输入访问密码' })
  }
  next()
})

app.get('/api/state', async (_req, res) => {
  try {
    res.json(await database.getState())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: '读取 PostgreSQL 数据失败。' })
  }
})

app.put('/api/state', async (req, res) => {
  try {
    res.json(await database.replaceState(req.body))
  } catch (error) {
    console.error(error)
    const clientError = ['INVALID_STATE', 'TOO_MANY_UNITS', 'TOO_MANY_WORDS', 'INVALID_UNIT', 'INVALID_WORD'].includes(error.message)
    res.status(clientError ? 400 : 500).json({ error: clientError ? '提交的数据格式无效。' : '写入 PostgreSQL 数据失败。' })
  }
})

function gatewayError(status, payload) {
  const known = {
    401: '网关 API Key 无效或租户已停用。',
    402: '租户积分不足或超出预算。',
    403: '当前数据级别超出租户能力权限。',
    404: '租户未开通所需能力。',
    409: '请求幂等键冲突。',
    503: '网关当前没有健康的模型路由。',
  }
  const detail = payload?.detail || payload?.message || payload?.error
  return known[status] || (typeof detail === 'string' ? detail : `网关请求失败（HTTP ${status}）。`)
}

function parseJsonContent(content) {
  const cleaned = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('模型没有返回有效 JSON。')
  return JSON.parse(cleaned.slice(first, last + 1))
}

async function callGateway(pathname, payload) {
  if (!gatewayKey) {
    const error = new Error('LLM_NOT_CONFIGURED')
    error.status = 503
    throw error
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(`${gatewayUrl}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gatewayKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = { message: text } }
    if (!response.ok) {
      const error = new Error(gatewayError(response.status, data))
      error.status = response.status
      throw error
    }
    return { data, headers: response.headers }
  } finally {
    clearTimeout(timeout)
  }
}

app.post('/api/enrich', rateLimit(60_000, 20), async (req, res) => {
  const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 40) : []
  const unitName = String(req.body?.unitName || '').trim().slice(0, 80)
  if (!words.length) return res.status(400).json({ error: '请至少提供一个单词。' })
  if (!gatewayKey) {
    return res.status(503).json({ error: 'LLM_NOT_CONFIGURED' })
  }

  try {
    const system = [
      '你是严谨的日语教师。为中文母语的日语初学者解析词汇。',
      '释义简明准确；读音仅用平假名；词性使用中文；例句控制在 JLPT N5-N4 难度。',
      '例句必须自然、短小，且包含目标词；提供准确中文翻译。',
      '保持输入顺序，每个输入只返回一个结果。',
      '根据整组词汇归纳一个简短准确的中文主题说明，控制在4到12个汉字，不要重复单元名称。',
      '只返回一个 JSON 对象，不要 Markdown。格式严格为：',
      '{"unitDescription":"","words":[{"term":"","reading":"","meaning":"","partOfSpeech":"","example":"","exampleReading":"","translation":""}]}',
      '所有字段必须是非空字符串。'
    ].join('')
    const { data, headers } = await callGateway('/api/ai/chat', {
      tenantId,
      capability: process.env.LLM_GATEWAY_CHAT_CAPABILITY || 'quality-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `单元名称：${unitName || '未命名'}。请解析并归纳以下词汇：${JSON.stringify(words)}` },
      ],
      dataClass: 'internal',
      fallback: true,
      stream: false,
      temperature: 0.2,
      max_tokens: 4096,
    })
    const content = data?.choices?.[0]?.message?.content
    const parsed = parseJsonContent(content)
    if (!Array.isArray(parsed.words) || parsed.words.length !== words.length) throw new Error('模型返回的词汇数量不匹配。')
    if (typeof parsed.unitDescription !== 'string' || !parsed.unitDescription.trim()) throw new Error('模型没有返回单元主题。')
    res.json({
      ...parsed,
      source: 'AIapiMgr',
      gateway: data.gateway,
      requestId: headers.get('x-request-id') || data.gateway?.requestId,
    })
  } catch (error) {
    console.error(error)
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '网关请求超时。' : error.message || 'AI 解析失败，请稍后再试。' })
  }
})

app.post('/api/transcribe', rateLimit(60_000, 12), async (req, res) => {
  const { audioBase64, mimeType = 'audio/webm', filename = 'pronunciation.webm' } = req.body || {}
  if (typeof audioBase64 !== 'string' || !audioBase64) return res.status(400).json({ error: '缺少录音数据。' })
  if (audioBase64.length > 6_000_000) return res.status(413).json({ error: '录音文件过大。' })
  try {
    const { data, headers } = await callGateway('/api/ai/transcribe/json', {
      tenantId,
      capability: process.env.LLM_GATEWAY_SPEECH_CAPABILITY || 'speech',
      filename,
      mimeType,
      audioBase64,
      language: 'ja',
      dataClass: 'internal',
      fallback: true,
    })
    res.json({ text: data.text, language: data.language, gateway: data.gateway, requestId: headers.get('x-request-id') || data.gateway?.requestId })
  } catch (error) {
    console.error(error)
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '语音转写超时。' : error.message || '语音转写失败。' })
  }
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(dirname, 'dist')))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(dirname, 'dist', 'index.html'))
  })
}

async function start() {
  await database.initialize()
  app.listen(port, host, () => console.log(`KOTONOHA API listening on http://${host}:${port} with PostgreSQL`))
}

start().catch((error) => {
  console.error('KOTONOHA startup failed:', error.message)
  process.exitCode = 1
})
