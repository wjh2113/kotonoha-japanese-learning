import crypto from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './database.mjs'
import { extractUploadedLexeme, isChineseGloss, looksLikeVocabularyTerm, normalizeImportDrafts } from './lexeme.mjs'

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

function looksLikeErrorDocument(text) {
  const value = String(text || '')
  return /<\s*html\b/i.test(value)
    || /<\s*head\b/i.test(value)
    || /502\s*Bad\s*Gateway/i.test(value)
    || /nginx\/\d/i.test(value)
}

function gatewayError(status, payload) {
  const known = {
    401: '网关 API Key 无效或租户已停用。',
    402: '租户积分不足或超出预算。',
    403: '当前数据级别超出租户能力权限。',
    404: '租户未开通所需能力。',
    409: '请求幂等键冲突。',
    502: 'AI 网关暂时不可用，请稍后重试。',
    503: '网关当前没有健康的模型路由。',
    504: 'AI 网关超时，请稍后重试。',
  }
  const detail = payload?.detail || payload?.message || payload?.error
  if (typeof detail === 'string' && looksLikeErrorDocument(detail)) {
    return known[status] || 'AI 网关请求失败，请稍后重试。'
  }
  return known[status] || (typeof detail === 'string' ? detail : `网关请求失败（HTTP ${status}）。`)
}

function publicStatus(error) {
  const status = Number(error?.status) || 500
  if (status === 502 || status === 504) return 503
  return status
}

function clientGatewayMessage(error, abortMessage, fallback) {
  if (error?.message === 'LLM_NOT_CONFIGURED') return fallback
  if (error?.name === 'AbortError') return abortMessage
  const message = String(error?.message || '')
  if (!message || looksLikeErrorDocument(message)) return fallback
  return message
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

function isPlaceholderMeaning(meaning) {
  return !isChineseGloss(meaning)
}

async function enrichWordsWithModel(words, unitName) {
  const system = [
    '你是严谨的日语教师。为中文母语的日语初学者解析词汇。',
    '释义必须用简短中文（2到12个汉字），禁止罗马音、英文、假名当释义。',
    '释义简明准确；读音仅用平假名；词性使用中文；例句控制在 JLPT N5-N4 难度。',
    '例句必须自然、短小，且包含目标词；提供准确中文翻译。',
    '保持输入顺序，每个输入只返回一个结果。',
    '若输入像笔记或批注，先抽出其中最核心的一个日语单词再解析，term 用抽出的单词。',
    '根据整组词汇归纳一个简短准确的中文主题说明，控制在4到12个汉字，不要重复单元名称。',
    '只返回一个 JSON 对象，不要 Markdown。格式严格为：',
    '{"unitDescription":"","words":[{"term":"","reading":"","meaning":"","partOfSpeech":"","example":"","exampleReading":"","translation":""}]}',
    'words 中所有字段必须是非空字符串。unitDescription 尽量给出。',
  ].join('')
  const { data, headers } = await callGateway('/api/ai/chat', {
    tenantId,
    capability: process.env.LLM_GATEWAY_ENRICH_CAPABILITY || 'fast-chat',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `单元名称：${unitName || '未命名'}。请解析并归纳以下词汇：${JSON.stringify(words)}` },
    ],
    dataClass: 'internal',
    fallback: true,
    stream: false,
    temperature: 0.2,
    max_tokens: Math.min(4096, Math.max(1536, words.length * 160)),
  })
  const parsed = parseJsonContent(data?.choices?.[0]?.message?.content)
  if (!Array.isArray(parsed.words) || parsed.words.length !== words.length) throw new Error('模型返回的词汇数量不匹配。')
  const unitDescription = typeof parsed.unitDescription === 'string' ? parsed.unitDescription.trim().slice(0, 16) : ''
  return { parsed: { ...parsed, unitDescription }, headers, gateway: data.gateway }
}

const skippedIncompleteIds = new Set()
let backfillRunning = false
let batchChain = Promise.resolve()

function enqueueIncompleteBatch() {
  const run = batchChain.then(() => enrichIncompleteBatch(), () => enrichIncompleteBatch())
  batchChain = run.then(() => undefined, () => undefined)
  return run
}

async function rewriteIncompleteRow(row) {
  const lex = extractUploadedLexeme(row.term, row.reading)
  if (!looksLikeVocabularyTerm(lex.term)) {
    await database.deleteWord(row.id)
    return null
  }
  if (await database.unitHasTerm(row.unitId, lex.term, row.id)) {
    await database.deleteWord(row.id)
    return null
  }
  const meaning = String(lex.meaning || row.meaning || '').trim()
  await database.updateWordLexicon(row.id, {
    term: lex.term,
    reading: lex.reading || row.reading,
    meaning: isPlaceholderMeaning(meaning) ? '待补充释义' : meaning,
    partOfSpeech: '词性待确认',
    example: `${lex.term}を勉強します。`,
    exampleReading: '',
    translation: `学习“${lex.term}”这个词。`,
  })
  return { ...row, term: lex.term, reading: lex.reading || row.reading, meaning: isPlaceholderMeaning(meaning) ? '' : meaning }
}

async function persistEnrichedRow(row, extra, fallback) {
  const term = String(extra.term || fallback.term || row.term).trim()
  if (!looksLikeVocabularyTerm(term)) {
    await database.deleteWord(row.id)
    return true
  }
  if (await database.unitHasTerm(row.unitId, term, row.id)) {
    await database.deleteWord(row.id)
    return true
  }
  const meaning = String(extra.meaning || fallback.meaning || '').trim()
  if (isPlaceholderMeaning(meaning)) return false
  await database.updateWordLexicon(row.id, {
    term,
    reading: extra.reading || fallback.reading || row.reading,
    meaning,
    partOfSpeech: extra.partOfSpeech || '名词',
    example: extra.example || `${term}を勉強します。`,
    exampleReading: extra.exampleReading,
    translation: extra.translation || `学习“${term}”这个词。`,
  })
  return true
}

async function enrichRowsWithModel(rows, unitName) {
  const payload = rows.map((row) => ({ term: row.term, reading: row.reading || undefined }))
  const { parsed } = await enrichWordsWithModel(payload, unitName)
  let filled = 0
  for (const [index, row] of rows.entries()) {
    const extra = parsed.words[index] || {}
    if (await persistEnrichedRow(row, extra, extractUploadedLexeme(row.term, row.reading))) filled += 1
  }
  return filled
}

async function enrichIncompleteBatch() {
  backfillRunning = true
  try {
    const rows = (await database.listIncompleteWords(40)).filter((row) => !skippedIncompleteIds.has(row.id))
    if (!rows.length) return { filled: 0, remaining: await database.countIncompleteWords() }
    const chunk = rows.filter((row) => row.unitId === rows[0].unitId).slice(0, 8)
    let filled = 0
    const pending = []
    for (const row of chunk) {
      const rewritten = await rewriteIncompleteRow(row)
      if (!rewritten) {
        filled += 1
        continue
      }
      if (rewritten.meaning && !isPlaceholderMeaning(rewritten.meaning)) {
        filled += 1
        continue
      }
      pending.push(rewritten)
    }
    if (pending.length) {
      try {
        filled += await enrichRowsWithModel(pending, chunk[0].unitName)
      } catch (error) {
        // One failed batch must not explode into N single-word calls (token storm).
        console.error('Incomplete-word backfill batch failed; deferring chunk:', error.message || error)
        for (const row of pending) skippedIncompleteIds.add(row.id)
      }
    }
    return { filled, remaining: await database.countIncompleteWords() }
  } finally {
    backfillRunning = false
  }
}

app.post('/api/enrich', rateLimit(60_000, 40), async (req, res) => {
  // Cap one request so the model can finish valid JSON. The client sends the whole unit in batches.
  const words = normalizeImportDrafts(Array.isArray(req.body?.words) ? req.body.words : []).slice(0, 20)
  const unitName = String(req.body?.unitName || '').trim().slice(0, 80)
  if (!words.length) return res.status(400).json({ error: '请至少提供一个单词。' })
  if (!gatewayKey) {
    return res.status(503).json({ error: 'LLM_NOT_CONFIGURED' })
  }

  try {
    const { parsed, headers, gateway } = await enrichWordsWithModel(words, unitName)
    res.json({
      ...parsed,
      source: 'AIapiMgr',
      gateway,
      requestId: headers.get('x-request-id') || gateway?.requestId,
    })
  } catch (error) {
    console.error(error)
    res.status(publicStatus(error)).json({ error: error.name === 'AbortError' ? '网关请求超时。' : clientGatewayMessage(error, '网关请求超时。', 'AI 解析失败，请稍后再试。') })
  }
})

app.get('/api/enrich-status', async (_req, res) => {
  try {
    res.json({ remaining: await database.countIncompleteWords(), running: backfillRunning })
  } catch (error) {
    res.status(500).json({ error: error.message || '无法读取补全进度。' })
  }
})

app.post('/api/enrich-missing', rateLimit(60_000, 8), async (_req, res) => {
  if (!gatewayKey) return res.status(503).json({ error: '尚未配置 AI 网关，无法补全单词。' })
  try {
    const remainingBefore = await database.countIncompleteWords()
    if (!remainingBefore) {
      const state = await database.getState()
      return res.json({ filled: 0, remaining: 0, running: false, units: state.units, settings: state.settings })
    }
    const result = await enqueueIncompleteBatch()
    const state = await database.getState()
    res.json({ ...result, running: backfillRunning, units: state.units, settings: state.settings })
  } catch (error) {
    console.error(error)
    res.status(publicStatus(error)).json({ error: clientGatewayMessage(error, '补全已上传单词失败。', '补全已上传单词失败。') })
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
  // Local theme only — fast-chat was not enabled for tenant Japan and burned empty calls.
  const fromMeanings = meanings
    .map((item) => String(item || '').trim())
    .filter((item) => item && !/待补全|自动查询|AI|待补充/.test(item))
    .slice(0, 3)
  let unitDescription = ''
  if (fromMeanings.length >= 2) unitDescription = fromMeanings.slice(0, 2).join('与').replace(/\s+/g, '').slice(0, 12)
  else if (fromMeanings[0]) unitDescription = fromMeanings[0].replace(/\s+/g, '').slice(0, 12)
  else unitDescription = unitName.replace(/^第\s*\d+\s*单元/, '').trim().slice(0, 12) || '词汇学习'
  if (unitDescription.length < 2) return res.status(422).json({ error: '无法归纳单元主题。' })
  res.json({ unitDescription, source: 'local' })
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
    res.status(publicStatus(error)).json({ error: error.name === 'AbortError' ? '语音转写超时。' : clientGatewayMessage(error, '语音转写超时。', '语音转写失败。') })
  }
})

app.get('/api/passages', async (_req, res) => {
  try {
    res.json(await database.listPassages())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: '读取课文失败。' })
  }
})

app.put('/api/passages', async (req, res) => {
  try {
    res.json(await database.replacePassages(req.body))
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
          { type: 'text', text: '你是日语教师。请识别这张课文/教材照片中的全部日语正文。只输出识别到的原文，保留换行，不要翻译，不要解释，不要Markdown。若几乎没有日语，只输出 EMPTY。' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      }],
      dataClass: 'internal',
      fallback: true,
      stream: false,
      temperature: 0,
      max_tokens: 2048,
    }, 120000)
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
      .replace(/^```(?:\w+)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    const empty = !text
      || looksLikeErrorDocument(text)
      || /^(EMPTY|empty|none|null|n\/a|（空字符串）|空字符串|无日语|没有日语)$/i.test(text)
    if (empty) return res.status(422).json({ error: '没有识别到日语课文，请换更清晰的照片或直接粘贴文本。' })
    res.json({ text })
  } catch (error) {
    console.error(error)
    res.status(publicStatus(error)).json({ error: clientGatewayMessage(error, '图片识别超时。', '图片识别失败，请稍后重试。') })
  }
})

async function analyzePassageWithModel(sourceText, exactSentences) {
  const lines = Array.isArray(exactSentences)
    ? exactSentences.map((item) => String(item || '').trim()).filter((text) => text && !looksLikeErrorDocument(text) && text !== '（正在识别课文…）').slice(0, 6)
    : []
  const system = [
    '你是严谨的日语教师，服务中文母语的日语初学者。',
    '把课文拆成句子。每句给出：原文、平假名读音、中文整句翻译、逐词注释、语法点。',
    'tokens 按出现顺序覆盖整句；surface 用原文字形；reading 用平假名；meaning 用简明中文。',
    'grammar 只标对理解有帮助的语法（助词、活用、句型），name 用日语或通用语法名，explanation 用中文。',
    'translation 必须是完整中文句子，禁止留空，禁止只用日语或罗马音。对话行保留 A/B 角色。',
    '只返回一个 JSON 对象，不要 Markdown。格式：',
    '{"title":"","sentences":[{"text":"","reading":"","translation":"","tokens":[{"surface":"","reading":"","meaning":""}],"grammar":[{"name":"","pattern":"","explanation":""}]}]}',
  ]
  if (lines.length) {
    system.push('必须按给定句子逐条解析，不要合并、拆分、改写或省略。sentences 数量必须等于输入句数，text 必须与输入完全一致。')
  }
  const payload = {
    tenantId,
    capability: process.env.LLM_GATEWAY_PASSAGE_CAPABILITY || process.env.LLM_GATEWAY_ENRICH_CAPABILITY || 'fast-chat',
    messages: [
      { role: 'system', content: system.join('') },
      { role: 'user', content: lines.length
        ? `请解析这些已经拆好的日语句子：\n${lines.map((text, index) => `${index + 1}. ${text}`).join('\n')}`
        : `请解析下面的日语课文：\n${sourceText}` },
    ],
    dataClass: 'internal',
    fallback: true,
    stream: false,
    temperature: 0.15,
    max_tokens: lines.length ? Math.min(3072, Math.max(1024, lines.length * 700)) : 4096,
  }
  const timeoutMs = lines.length ? 90_000 : 120_000
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data } = await callGateway('/api/ai/chat', payload, timeoutMs)
      const parsed = parseJsonContent(data?.choices?.[0]?.message?.content)
      if (!Array.isArray(parsed.sentences) || !parsed.sentences.length) throw new Error('模型没有返回句子。')
      if (looksLikeErrorDocument(String(parsed.title || ''))) parsed.title = ''
      if (lines.length) {
        parsed.sentences = lines.map((text, index) => {
          const match = parsed.sentences.find((item) => String(item?.text || '').trim() === text) || parsed.sentences[index] || {}
          return { ...match, text }
        })
      }
      return parsed
    } catch (error) {
      lastError = error
      const retryableStatus = [502, 503, 504].includes(error.status)
      const retryableFormat = /JSON|没有返回句子|没有返回有效/i.test(String(error.message || ''))
      if ((!retryableStatus && !retryableFormat) || attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  throw lastError
}

app.post('/api/passage/analyze', rateLimit(60_000, 30), async (req, res) => {
  const sourceText = String(req.body?.text || '').trim().slice(0, 8000)
  const requested = Array.isArray(req.body?.sentences)
    ? req.body.sentences.map((item) => String(item?.text || item || '').trim()).filter((text) => text && !looksLikeErrorDocument(text) && text !== '（正在识别课文…）').slice(0, 6)
    : []
  if (looksLikeErrorDocument(sourceText) || sourceText === '（正在识别课文…）') {
    return res.status(400).json({ error: '课文原文无效，请重新上传或粘贴正文。' })
  }
  if (!sourceText && !requested.length) return res.status(400).json({ error: '请提供课文内容。' })
  try {
    res.json(await analyzePassageWithModel(sourceText, requested))
  } catch (error) {
    console.error(error)
    res.status(publicStatus(error)).json({ error: clientGatewayMessage(error, '课文解析超时。', '课文解析失败，请稍后重试。') })
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
  // Do not auto-backfill on every deploy/restart — that was the main token burn.
  // Incomplete words are filled only via POST /api/enrich-missing (login / import).
}

start().catch((error) => {
  console.error('KOTONOHA startup failed:', error.message)
  process.exitCode = 1
})
