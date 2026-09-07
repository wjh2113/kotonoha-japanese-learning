import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT || 8787)
const dirname = path.dirname(fileURLToPath(import.meta.url))
const gatewayUrl = (process.env.LLM_GATEWAY_URL || 'https://aiapimgrapi.aidigitcloud.cn').replace(/\/$/, '')
const gatewayKey = process.env.LLM_GATEWAY_API_KEY
const tenantId = process.env.LLM_GATEWAY_TENANT || 'Japan'

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llmConfigured: Boolean(gatewayKey), provider: 'AIapiMgr', tenant: tenantId })
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

app.post('/api/enrich', async (req, res) => {
  const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 40) : []
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
      '只返回一个 JSON 对象，不要 Markdown。格式严格为：',
      '{"words":[{"term":"","reading":"","meaning":"","partOfSpeech":"","example":"","exampleReading":"","translation":""}]}',
      '所有字段必须是非空字符串。'
    ].join('')
    const { data, headers } = await callGateway('/api/ai/chat', {
      tenantId,
      capability: process.env.LLM_GATEWAY_CHAT_CAPABILITY || 'quality-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `请解析以下词汇：${JSON.stringify(words)}` },
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

app.post('/api/transcribe', async (req, res) => {
  const { audioBase64, mimeType = 'audio/webm', filename = 'pronunciation.webm' } = req.body || {}
  if (typeof audioBase64 !== 'string' || !audioBase64) return res.status(400).json({ error: '缺少录音数据。' })
  if (audioBase64.length > 35_000_000) return res.status(413).json({ error: '录音文件过大。' })
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

app.listen(port, () => console.log(`KOTONOHA API listening on http://localhost:${port}`))
