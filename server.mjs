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
app.use(express.json({ limit: '12mb' }))

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

async function callGateway(pathname, payload, timeoutMs = 90000) {
  if (!gatewayKey) {
    const error = new Error('LLM_NOT_CONFIGURED')
    error.status = 503
    throw error
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
      'words 中所有字段必须是非空字符串。unitDescription 尽量给出。'
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
    const unitDescription = typeof parsed.unitDescription === 'string' ? parsed.unitDescription.trim().slice(0, 16) : ''
    res.json({
      ...parsed,
      unitDescription,
      source: 'AIapiMgr',
      gateway: data.gateway,
      requestId: headers.get('x-request-id') || data.gateway?.requestId,
    })
  } catch (error) {
    console.error(error)
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '网关请求超时。' : error.message || 'AI 解析失败，请稍后再试。' })
  }
})

app.post('/api/unit-theme', rateLimit(60_000, 20), async (req, res) => {
  const unitName = String(req.body?.unitName || '').trim().slice(0, 80)
  const terms = Array.isArray(req.body?.terms)
    ? [...new Set(req.body.terms.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 80)
    : []
  const meanings = Array.isArray(req.body?.meanings)
    ? req.body.meanings.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40)
    : []
  if (!terms.length) return res.status(400).json({ error: '请提供单词以便归纳主题。' })
  if (!gatewayKey) return res.status(503).json({ error: '尚未配置 AI 网关，无法归纳主题。' })
  try {
    const { data } = await callGateway('/api/ai/chat', {
      tenantId,
      capability: process.env.LLM_GATEWAY_CHAT_CAPABILITY || 'quality-chat',
      messages: [
        { role: 'system', content: '你是日语教材编辑。根据单词列表归纳这个单元的学习主题。只返回一个 JSON 对象：{"unitDescription":""}。unitDescription 必须是 4 到 12 个汉字的中文短语，概括词汇所属生活场景、话题或语法主题，不要重复单元名称，不要标点，不要解释。' },
        { role: 'user', content: `单元名称：${unitName || '未命名'}\n单词：${terms.join('、')}${meanings.length ? `\n部分释义：${meanings.slice(0, 20).join('、')}` : ''}` },
      ],
      dataClass: 'internal',
      fallback: true,
      stream: false,
      temperature: 0.2,
      max_tokens: 200,
    }, 30000)
    const parsed = parseJsonContent(data?.choices?.[0]?.message?.content)
    const unitDescription = String(parsed.unitDescription || '').replace(/[。．，、.!！？?\s]/g, '').slice(0, 16)
    if (unitDescription.length < 2) throw new Error('模型没有返回单元主题。')
    res.json({ unitDescription })
  } catch (error) {
    console.error(error)
    const message = error.message === 'LLM_NOT_CONFIGURED' ? '尚未配置 AI 网关，无法归纳主题。' : error.message || '归纳主题失败。'
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '归纳主题超时。' : message })
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

app.get('/api/passages', async (_req, res) => {
  try {
    res.json({ passages: await database.listPassages() })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: '读取课文失败。' })
  }
})

app.put('/api/passages', async (req, res) => {
  try {
    res.json({ passages: await database.replacePassages(req.body) })
  } catch (error) {
    console.error(error)
    const clientError = ['INVALID_PASSAGES', 'TOO_MANY_PASSAGES', 'INVALID_PASSAGE'].includes(error.message)
    res.status(clientError ? 400 : 500).json({ error: clientError ? '提交的课文数据无效。' : '写入课文失败。' })
  }
})

app.post('/api/passage/ocr', rateLimit(60_000, 8), async (req, res) => {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body || {}
  if (typeof imageBase64 !== 'string' || !imageBase64) return res.status(400).json({ error: '请上传课文图片。' })
  if (imageBase64.length > 8_000_000) return res.status(413).json({ error: '图片过大，请压缩后重试。' })
  try {
    const { data } = await callGateway('/api/ai/chat', {
      tenantId,
      capability: process.env.LLM_GATEWAY_VISION_CAPABILITY || 'vision',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '你是日语教师。请识别这张课文/教材照片中的全部日语正文。只输出识别到的原文，保留换行，不要翻译，不要解释，不要Markdown。若几乎没有日语，请输出空字符串。' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      }],
      dataClass: 'internal',
      fallback: true,
      stream: false,
      temperature: 0,
      max_tokens: 4096,
    }, 120000)
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
    if (!text) return res.status(422).json({ error: '没有识别到日语课文，请换更清晰的照片或直接粘贴文本。' })
    res.json({ text })
  } catch (error) {
    console.error(error)
    const message = error.message === 'LLM_NOT_CONFIGURED' ? '尚未配置 AI 网关，无法识别图片。' : error.message || '图片识别失败。'
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '图片识别超时。' : message })
  }
})

app.post('/api/passage/analyze', rateLimit(60_000, 10), async (req, res) => {
  const sourceText = String(req.body?.text || '').trim().slice(0, 8000)
  if (!sourceText) return res.status(400).json({ error: '请提供课文内容。' })
  try {
    const system = [
      '你是严谨的日语教师，服务中文母语的日语初学者。',
      '把课文拆成句子。每句给出：原文、平假名读音、中文整句翻译、逐词注释、语法点。',
      'tokens 按出现顺序覆盖整句；surface 用原文字形；reading 用平假名；meaning 用简明中文。',
      'grammar 只标对理解有帮助的语法（助词、活用、句型），name 用日语或通用语法名，explanation 用中文。',
      '只返回一个 JSON 对象，不要 Markdown。格式：',
      '{"title":"","sentences":[{"text":"","reading":"","translation":"","tokens":[{"surface":"","reading":"","meaning":""}],"grammar":[{"name":"","pattern":"","explanation":""}]}]}',
    ].join('')
    const { data } = await callGateway('/api/ai/chat', {
      tenantId,
      capability: process.env.LLM_GATEWAY_CHAT_CAPABILITY || 'quality-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `请解析下面的日语课文：\n${sourceText}` },
      ],
      dataClass: 'internal',
      fallback: true,
      stream: false,
      temperature: 0.15,
      max_tokens: 8192,
    }, 120000)
    const parsed = parseJsonContent(data?.choices?.[0]?.message?.content)
    if (!Array.isArray(parsed.sentences) || !parsed.sentences.length) throw new Error('模型没有返回句子。')
    res.json(parsed)
  } catch (error) {
    console.error(error)
    const message = error.message === 'LLM_NOT_CONFIGURED' ? '尚未配置 AI 网关，无法解析课文。' : error.message || '课文解析失败。'
    res.status(error.status || 500).json({ error: error.name === 'AbortError' ? '课文解析超时。' : message })
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
