import crypto from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './database.mjs'
import {
  extractUploadedLexeme,
  hasUsableReading,
  hasUsableRomaji,
  isChineseGloss,
  isCoreLexiconIncomplete,
  isPlaceholderExample,
  looksLikeVocabularyTerm,
  normalizeImportDrafts,
} from './lexeme.mjs'

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

// Capacitor 安卓壳跨域访问 API（WebView 源：https://localhost / capacitor://localhost）
const NATIVE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost'])
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && NATIVE_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Access-Token')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function sha256buf(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest()
}

function safeEqualStr(left, right) {
  return crypto.timingSafeEqual(sha256buf(left), sha256buf(right))
}

const ACCESS_TOKEN_TTL_SEC = 7 * 24 * 3600

function issueAccessToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SEC
  const hmac = crypto.createHmac('sha256', accessPassword).update(`kotonoha-access-v2:${expiresAt}`).digest('hex')
  return `${expiresAt}.${hmac}`
}

function accessTokenValid(token) {
  if (!token || typeof token !== 'string') return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const expiresAt = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !sig) return false
  const expected = crypto.createHmac('sha256', accessPassword).update(`kotonoha-access-v2:${expiresAt}`).digest('hex')
  return safeEqualStr(sig, expected)
}

function readBearer(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  const fallback = req.headers['x-access-token']
  return fallback ? String(fallback).trim() : ''
}

function rateLimit(windowMs, max) {
  const hits = new Map()
  let requestCount = 0
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const key = `${req.path}:${ip}`
    const now = Date.now()
    requestCount += 1
    let recent = (hits.get(key) || []).filter((time) => now - time < windowMs)
    if (!recent.length) hits.delete(key)
    if (recent.length >= max) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试。' })
    }
    recent.push(now)
    hits.set(key, recent)
    if (requestCount % 100 === 0) {
      for (const [entryKey, times] of hits) {
        const kept = times.filter((time) => now - time < windowMs)
        if (!kept.length) hits.delete(entryKey)
        else hits.set(entryKey, kept)
      }
    }
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
  res.json({ ok: Boolean(token && accessTokenValid(token)), required: true })
})

app.post('/api/auth/login', rateLimit(60_000, 8), (req, res) => {
  if (!accessPassword) return res.json({ ok: true, token: '', required: false })
  const password = req.body?.password != null ? String(req.body.password) : ''
  if (!password || !safeEqualStr(password, accessPassword)) {
    return res.status(401).json({ error: 'invalid_password', message: '密码错误' })
  }
  res.json({ ok: true, token: issueAccessToken(), required: true })
})

app.use('/api', (req, res, next) => {
  if (!accessPassword) return next()
  if (req.path === '/health' || req.path === '/auth/check' || req.path === '/auth/login') return next()
  const token = readBearer(req)
  if (!token || !accessTokenValid(token)) {
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

app.patch('/api/settings', async (req, res) => {
  try {
    res.json({ settings: await database.patchSettings(req.body?.settings || req.body) })
  } catch (error) {
    console.error(error)
    res.status(error.message === 'INVALID_STATE' ? 400 : 500).json({ error: '设置保存失败。' })
  }
})

app.patch('/api/words/:id', async (req, res) => {
  try {
    res.json({ word: await database.patchWord(req.params.id, req.body || {}) })
  } catch (error) {
    console.error(error)
    if (error.message === 'WORD_NOT_FOUND') return res.status(404).json({ error: '单词不存在。' })
    if (error.message === 'INVALID_WORD') return res.status(400).json({ error: '单词数据无效。' })
    res.status(500).json({ error: '单词保存失败。' })
  }
})

app.post('/api/units', async (req, res) => {
  try {
    const body = req.body || {}
    const unit = await database.createUnit({
      id: body.id,
      name: body.name,
      description: body.description,
      color: body.color,
      sortOrder: body.sortOrder,
    })
    res.json({ unit })
  } catch (error) {
    console.error(error)
    res.status(error.message === 'INVALID_UNIT' ? 400 : 500).json({ error: '创建单元失败。' })
  }
})

app.patch('/api/units/:id', async (req, res) => {
  try {
    const unit = await database.patchUnit(req.params.id, req.body || {})
    res.json({ unit })
  } catch (error) {
    console.error(error)
    if (error.message === 'UNIT_NOT_FOUND') return res.status(404).json({ error: '单元不存在。' })
    res.status(error.message === 'INVALID_UNIT' ? 400 : 500).json({ error: '更新单元失败。' })
  }
})

app.delete('/api/units/:id', async (req, res) => {
  try {
    res.json(await database.deleteUnit(req.params.id))
  } catch (error) {
    console.error(error)
    if (error.message === 'LAST_UNIT') return res.status(400).json({ error: '至少需要保留一个单元。' })
    if (error.message === 'UNIT_NOT_FOUND') return res.status(404).json({ error: '单元不存在。' })
    res.status(error.message === 'INVALID_UNIT' ? 400 : 500).json({ error: '删除单元失败。' })
  }
})

app.post('/api/units/:id/words', async (req, res) => {
  try {
    const body = req.body || {}
    const description = typeof body.description === 'string' ? body.description.trim() : undefined
    if (description !== undefined) {
      await database.patchUnit(req.params.id, { description })
    }
    const result = await database.appendWords(req.params.id, Array.isArray(body.words) ? body.words : [])
    res.json({
      words: result.words,
      droppedCount: result.droppedCount,
      dropped: result.dropped,
      ...(description !== undefined ? { description } : {}),
    })
  } catch (error) {
    console.error(error)
    if (error.message === 'UNIT_NOT_FOUND') return res.status(404).json({ error: '单元不存在。' })
    if (error.message === 'INVALID_UNIT') return res.status(400).json({ error: '单元无效。' })
    res.status(500).json({ error: '导入单词失败。' })
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
  const detailMessage = typeof detail === 'string'
    ? detail
    : (detail && typeof detail === 'object' ? String(detail.message || '') : '')
  const blob = `${detailMessage} ${typeof detail === 'object' ? JSON.stringify(detail) : ''}`
  if (/ASR|transcrib|speech|语音识别/i.test(blob)) {
    return '语音识别服务暂时不可用，请稍后重试。'
  }
  if (detailMessage && !looksLikeErrorDocument(detailMessage) && status >= 400 && status < 500) {
    return detailMessage.slice(0, 120)
  }
  return known[status] || (detailMessage && !looksLikeErrorDocument(detailMessage) ? detailMessage.slice(0, 120) : `网关请求失败（HTTP ${status}）。`)
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
  const tryParse = (slice) => {
    try {
      return JSON.parse(slice)
    } catch {
      const repaired = slice
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
      return JSON.parse(repaired)
    }
  }
  const candidates = []
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== '{') continue
    let depth = 0
    for (let j = i; j < cleaned.length; j += 1) {
      const cur = cleaned[j]
      if (cur === '{' || cur === '[') depth += 1
      else if (cur === '}' || cur === ']') {
        depth -= 1
        if (depth === 0) {
          const slice = cleaned.slice(i, j + 1)
          // Only keep schema objects — ignore nested grammar/token arrays.
          if (/\"sentences\"\s*:/.test(slice) || /\"words\"\s*:/.test(slice)) candidates.push(slice)
          break
        }
      }
    }
  }
  for (const slice of candidates.reverse()) {
    try {
      const parsed = tryParse(slice)
      if (Array.isArray(parsed?.sentences) || Array.isArray(parsed?.words)) return parsed
    } catch {
      // keep trying earlier candidates
    }
  }
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('模型没有返回有效 JSON。')
  try {
    const parsed = tryParse(cleaned.slice(first, last + 1))
    if (Array.isArray(parsed?.sentences) || Array.isArray(parsed?.words)) return parsed
    throw new Error('模型没有返回有效 JSON。')
  } catch {
    throw new Error('模型没有返回有效 JSON。')
  }
}

/** Reasoning models often leave content empty and put the answer in reasoning_content. */
function chatMessageText(data) {
  const message = data?.choices?.[0]?.message || {}
  const content = String(message.content || '').trim()
  if (content) return content
  return String(message.reasoning_content || message.reasoning || '').trim()
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
    '只补全核心字段：假名读音、罗马音、中文释义、例句（及例句读音/译文）。',
    '不要生成同义词、近义词、形近词、记忆技巧、发音注意事项。',
    '释义必须用简短中文（2到12个汉字），禁止罗马音、英文、假名当释义。',
    '释义简明准确；读音仅用平假名；罗马音用 Hepburn；词性使用中文；例句控制在 JLPT N5-N4 难度。',
    '例句必须自然、短小，且包含目标词；提供准确中文翻译。',
    '保持输入顺序，每个输入只返回一个结果。',
    '若输入像笔记或批注，先抽出其中最核心的一个日语单词再解析，term 用抽出的单词。',
    '根据整组词汇归纳一个简短准确的中文主题说明，控制在4到12个汉字，不要重复单元名称。',
    '只返回一个 JSON 对象，不要 Markdown。格式严格为：',
    '{"unitDescription":"","words":[{"term":"","reading":"","romaji":"","meaning":"","partOfSpeech":"","example":"","exampleReading":"","translation":""}]}',
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
  const parsed = parseJsonContent(chatMessageText(data))
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
  const term = lex.term
  const reading = hasUsableReading(term, lex.reading || row.reading)
    ? String(lex.reading || row.reading || term).trim()
    : String(lex.reading || row.reading || '').trim()
  const meaning = isChineseGloss(row.meaning)
    ? String(row.meaning).trim()
    : String(lex.meaning || row.meaning || '').trim()
  const example = isPlaceholderExample(row.example) ? '' : String(row.example || '').trim()
  const romaji = String(row.romaji || '').trim()
  const partOfSpeech = String(row.partOfSpeech || '').trim() || '词性待确认'
  const word = await database.updateWordLexicon(row.id, {
    term,
    reading,
    meaning: isPlaceholderMeaning(meaning) ? '待补充释义' : meaning,
    partOfSpeech,
    example,
    exampleReading: String(row.exampleReading || '').trim(),
    translation: String(row.translation || '').trim(),
    romaji,
  })
  const next = {
    ...row,
    term,
    reading,
    meaning: isPlaceholderMeaning(meaning) ? '' : meaning,
    example,
    romaji,
    partOfSpeech,
    word,
  }
  return next
}

async function persistEnrichedRow(row, extra, fallback) {
  const term = String(extra.term || fallback.term || row.term).trim()
  if (!looksLikeVocabularyTerm(term)) {
    await database.deleteWord(row.id)
    return { filled: true, word: null }
  }
  if (await database.unitHasTerm(row.unitId, term, row.id)) {
    await database.deleteWord(row.id)
    return { filled: true, word: null }
  }
  const reading = hasUsableReading(term, row.reading)
    ? String(row.reading).trim()
    : String(extra.reading || fallback.reading || row.reading || '').trim()
  const meaning = isChineseGloss(row.meaning)
    ? String(row.meaning).trim()
    : String(extra.meaning || fallback.meaning || '').trim()
  if (isPlaceholderMeaning(meaning)) return { filled: false, word: null }
  const example = !isPlaceholderExample(row.example)
    ? String(row.example).trim()
    : String(extra.example || '').trim()
  if (isPlaceholderExample(example)) return { filled: false, word: null }
  const romaji = hasUsableRomaji(row.romaji)
    ? String(row.romaji).trim()
    : String(extra.romaji || '').trim()
  if (!hasUsableReading(term, reading) || !hasUsableRomaji(romaji)) return { filled: false, word: null }
  const word = await database.updateWordLexicon(row.id, {
    term,
    reading,
    meaning,
    partOfSpeech: String(row.partOfSpeech || '').trim() || extra.partOfSpeech || '名词',
    example,
    exampleReading: String(row.exampleReading || '').trim() || extra.exampleReading || '',
    translation: String(row.translation || '').trim() || extra.translation || '',
    romaji,
  })
  return { filled: true, word }
}

async function enrichRowsWithModel(rows, unitName) {
  const payload = rows.map((row) => ({ term: row.term, reading: row.reading || undefined }))
  const { parsed } = await enrichWordsWithModel(payload, unitName)
  let filled = 0
  const words = []
  for (const [index, row] of rows.entries()) {
    const extra = parsed.words[index] || {}
    const result = await persistEnrichedRow(row, extra, extractUploadedLexeme(row.term, row.reading))
    if (result.filled) filled += 1
    if (result.word) words.push(result.word)
  }
  return { filled, words }
}

async function enrichIncompleteBatch() {
  backfillRunning = true
  try {
    const rows = (await database.listIncompleteWords(40)).filter((row) => !skippedIncompleteIds.has(row.id))
    if (!rows.length) return { filled: 0, remaining: await database.countIncompleteWords(), words: [] }
    const chunk = rows.filter((row) => row.unitId === rows[0].unitId).slice(0, 8)
    let filled = 0
    const updatedById = new Map()
    const pending = []
    for (const row of chunk) {
      const rewritten = await rewriteIncompleteRow(row)
      if (!rewritten) {
        filled += 1
        continue
      }
      if (rewritten.word) updatedById.set(rewritten.word.id, rewritten.word)
      // Core fields already complete → skip model. Optional columns are never backfilled.
      if (!isCoreLexiconIncomplete(rewritten)) {
        filled += 1
        continue
      }
      pending.push(rewritten)
    }
    if (pending.length) {
      try {
        const modelResult = await enrichRowsWithModel(pending, chunk[0].unitName)
        filled += modelResult.filled
        for (const word of modelResult.words) updatedById.set(word.id, word)
      } catch (error) {
        // One failed batch must not explode into N single-word calls (token storm).
        console.error('Incomplete-word backfill batch failed; deferring chunk:', error.message || error)
        for (const row of pending) skippedIncompleteIds.add(row.id)
      }
    }
    return { filled, remaining: await database.countIncompleteWords(), words: [...updatedById.values()] }
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
      return res.json({ filled: 0, remaining: 0, running: false, words: [] })
    }
    const result = await enqueueIncompleteBatch()
    res.json({
      filled: result.filled,
      remaining: result.remaining,
      running: backfillRunning,
      words: Array.isArray(result.words) ? result.words : [],
    })
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
    }, 120_000)
    res.json({ text: data.text, language: data.language, gateway: data.gateway, requestId: headers.get('x-request-id') || data.gateway?.requestId })
  } catch (error) {
    console.error(error)
    res.status(publicStatus(error)).json({ error: error.name === 'AbortError' ? '语音转写超时。' : clientGatewayMessage(error, '语音转写超时。', '语音转写失败。') })
  }
})

app.get('/api/passages', async (req, res) => {
  try {
    const lightParam = req.query.light
    const light = lightParam === undefined || lightParam === '1' || lightParam === 'true'
    res.json(await database.listPassages({ light }))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: '读取课文失败。' })
  }
})

app.get('/api/passages/:id', async (req, res) => {
  try {
    res.json({ passage: await database.getPassage(req.params.id) })
  } catch (error) {
    console.error(error)
    if (error.message === 'PASSAGE_NOT_FOUND') return res.status(404).json({ error: '课文不存在。' })
    res.status(error.message === 'INVALID_PASSAGE' ? 400 : 500).json({ error: '读取课文失败。' })
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

app.put('/api/passages/:id', async (req, res) => {
  try {
    const passage = await database.upsertPassage({ ...(req.body || {}), id: req.params.id })
    res.json({ passage })
  } catch (error) {
    console.error(error)
    res.status(error.message === 'INVALID_PASSAGE' ? 400 : 500).json({ error: '课文保存失败。' })
  }
})

app.patch('/api/passages/:id/progress', async (req, res) => {
  try {
    const passage = await database.patchPassageProgress(req.params.id, req.body?.progress || req.body)
    res.json({ passage })
  } catch (error) {
    console.error(error)
    if (error.message === 'PASSAGE_NOT_FOUND') return res.status(404).json({ error: '课文不存在。' })
    res.status(error.message === 'INVALID_PASSAGE' ? 400 : 500).json({ error: '进度保存失败。' })
  }
})

app.delete('/api/passages/:id', async (req, res) => {
  try {
    res.json(await database.deletePassage(req.params.id))
  } catch (error) {
    console.error(error)
    if (error.message === 'PASSAGE_NOT_FOUND') return res.status(404).json({ error: '课文不存在。' })
    res.status(error.message === 'INVALID_PASSAGE' ? 400 : 500).json({ error: '删除课文失败。' })
  }
})

app.put('/api/passage-books', async (req, res) => {
  try {
    const body = req.body || {}
    const result = await database.replacePassageBooks(
      body.books || body,
      body.lessons !== undefined ? body.lessons : undefined,
    )
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: '课本分组保存失败。' })
  }
})

// Frontend now accepts Markdown/text only; OCR endpoint retired.
app.post('/api/passage/ocr', (_req, res) => {
  res.status(410).json({ error: '图片 OCR 已下线，请粘贴课文 Markdown/文本。' })
})

// Frontend handbook upload is self-contained (原文/假名/中文); analyze endpoint retired.
app.post('/api/passage/analyze', (_req, res) => {
  res.status(410).json({ error: '课文 AI 解析已下线。请使用含「原文 / 假名注音 / 中文解释」的 Markdown 模版上传。' })
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
