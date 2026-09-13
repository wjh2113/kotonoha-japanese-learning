import { isPassagePlaceholder, looksLikeErrorDocument, PASSAGE_OCR_PLACEHOLDER } from './error-text'
import { looksLikeVocabularyTerm } from './lexeme'
import type { ImportDraft, Passage, PassageSentence, SentenceProgress } from './types'
import { uid } from './utils'

const PARTICLES = /^(は|が|を|に|の|と|も|で|へ|や|か|ね|よ|な|だ|です|ます|した|して)$/

export const PASSAGE_ANALYZE_CHUNK = 6
export const PASSAGE_ANALYZE_CONCURRENCY = 2
/** Soft cap shown in UI; server validatePassages also enforces 50. */
export const MAX_PASSAGES = 50

export function hasChineseTranslation(text?: string) {
  return /[\u4e00-\u9fff]/.test(String(text || '').trim())
}

/** Chinese study notes mixed into OCR — treat as already “translated”. */
export function isPrimarilyChineseLine(text?: string) {
  const value = String(text || '').trim()
  if (!value || /[\u3040-\u30ff]/.test(value)) return false
  const compact = value.replace(/\s/g, '')
  const cn = (compact.match(/[\u4e00-\u9fff]/g) || []).length
  return cn >= 6 && cn * 2 >= compact.length
}

export function sentenceNeedsAnalysis(sentence: PassageSentence) {
  if (isPrimarilyChineseLine(sentence.text)) return false
  // Handbook supplies 原文 + 假名注音 + 中文解释. Tokens are derived locally — never require LLM.
  const hasReading = Boolean(String(sentence.reading || '').trim())
  return !hasChineseTranslation(sentence.translation) || !hasReading
}

export function passageNeedsAnalysis(passage: Passage) {
  if (isTransientPassage(passage)) return false
  return (passage.sentences || []).some(sentenceNeedsAnalysis)
}

export function isTransientPassage(passage: Pick<Passage, 'status' | 'sourceText' | 'sentences'>) {
  const source = String(passage.sourceText || '').trim()
  const sentences = (passage.sentences || []).filter((sentence) => sentence.text && !isPassagePlaceholder(sentence.text))
  return passage.status === 'processing' && (!source || isPassagePlaceholder(source)) && !sentences.length
}

export function sanitizePassageRecord<T extends Partial<Passage>>(passage: T): T {
  const title = looksLikeErrorDocument(String(passage.title || '')) ? '课文' : passage.title
  const rawSource = String(passage.sourceText || '')
  const sourceText = looksLikeErrorDocument(rawSource) || rawSource.trim() === PASSAGE_OCR_PLACEHOLDER ? '' : rawSource
  const sentences = Array.isArray(passage.sentences)
    ? passage.sentences.filter((sentence) => sentence?.text && !isPassagePlaceholder(sentence.text))
    : passage.sentences
  const statusText = looksLikeErrorDocument(String(passage.statusText || ''))
    ? '课文解析暂时失败，请稍后重试。'
    : passage.statusText
  return { ...passage, title, sourceText, sentences, statusText }
}

export function recoverInterruptedIngest(passage: Passage): Passage {
  const next = sanitizePassageRecord(passage)
  if (!isTransientPassage(next)) return next
  return {
    ...next,
    sourceText: '',
    sentences: [],
    status: 'error',
    statusText: '课文识别未完成，请重新上传或粘贴原文。',
  }
}

export function chunkItems<T>(items: T[], size = PASSAGE_ANALYZE_CHUNK) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function normalizePassageSentence(item: unknown, fallbackId = ''): PassageSentence {
  const row = (item && typeof item === 'object') ? item as Record<string, any> : {}
  const text = String(row.text || '').trim()
  return {
    id: String(row.id || fallbackId || ''),
    text,
    reading: String(row.reading || '').trim(),
    translation: String(row.translation || '').trim(),
    tokens: Array.isArray(row.tokens) ? row.tokens.slice(0, 60).map((token: any) => ({
      surface: String(token?.surface || '').trim(),
      reading: String(token?.reading || '').trim(),
      meaning: String(token?.meaning || '').trim(),
    })).filter((token: { surface: string }) => token.surface) : [],
    grammar: Array.isArray(row.grammar) ? row.grammar.slice(0, 8).map((point: any) => ({
      name: String(point?.name || '').trim(),
      pattern: String(point?.pattern || '').trim(),
      explanation: String(point?.explanation || '').trim(),
    })).filter((point: { name: string }) => point.name) : [],
  }
}

export function mergeAnalyzedSentences(current: PassageSentence[], analyzed: unknown[]) {
  const unused = (Array.isArray(analyzed) ? analyzed : [])
    .map((item) => normalizePassageSentence(item))
    .filter((item) => item.text)
  const normalizeKey = (text: string) => text.replace(/\s+/g, '').trim()
  const byExact = new Map<string, PassageSentence>()
  const byLoose = new Map<string, PassageSentence>()
  for (const item of unused) {
    if (!byExact.has(item.text)) byExact.set(item.text, item)
    const loose = normalizeKey(item.text)
    if (loose && !byLoose.has(loose)) byLoose.set(loose, item)
  }
  return current.map((sentence) => {
    // Only match by text — never shift leftovers onto unrelated lines (e.g. Chinese notes).
    const match = byExact.get(sentence.text) || byLoose.get(normalizeKey(sentence.text))
    if (!match) return sentence
    byExact.delete(match.text)
    byLoose.delete(normalizeKey(match.text))
    return {
      ...sentence,
      reading: sentence.reading || match.reading || match.tokens.map((token) => token.reading).filter(Boolean).join(''),
      // 用户表格里提供的翻译/语法优先，模型只补空缺。
      translation: hasChineseTranslation(sentence.translation) ? sentence.translation : match.translation,
      tokens: match.tokens.length ? match.tokens : sentence.tokens,
      grammar: sentence.grammar.length ? sentence.grammar : match.grammar,
    }
  })
}

const PASSAGE_TABLE_HEADER = {
  text: /^(原文|日文|日语|句子|课文|text|sentence|japanese)$/i,
  reading: /^(假名注音|假名|读音|注音|ふりがな|かな|reading|furigana|kana)$/i,
  translation: /^(中文解释|中文释义|中文|解释|释义|翻译|译文|translation|chinese|meaning)$/i,
  grammar: /^(语法考点|语法|考点|grammar)/i,
}

/**
 * Turn annotated furigana like「私（わたし）は佐藤（さとう）さん」into display tokens.
 * No model — only the （） annotations the author already wrote.
 */
export function tokensFromAnnotatedReading(reading: string): PassageSentence['tokens'] {
  const raw = String(reading || '').trim()
  if (!raw) return []
  const tokens: PassageSentence['tokens'] = []
  const pushGap = (gap: string) => {
    const pattern = /([ぁ-んァ-ンー]+)|([^\s（）()]+)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(gap))) {
      const surface = String(match[1] || match[2] || '').trim()
      if (!surface || /^[：:、。．，,！!？?\s]+$/.test(surface)) continue
      tokens.push({
        surface,
        reading: /[ぁ-んァ-ンー]/.test(surface)
          ? surface.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
          : '',
        meaning: '',
      })
    }
  }
  // Pull 漢字（かな） first so leading punctuation cannot swallow the kanji.
  const rubyRe = /([おご]?[\u4e00-\u9fff]+[\u3040-\u30ffー]*)（([ぁ-んァ-ンー]+)）/g
  let cursor = 0
  for (const match of raw.matchAll(rubyRe)) {
    const start = match.index || 0
    if (cursor < start) pushGap(raw.slice(cursor, start))
    tokens.push({ surface: match[1], reading: match[2], meaning: '' })
    cursor = start + match[0].length
  }
  if (cursor < raw.length) pushGap(raw.slice(cursor))
  return tokens.slice(0, 60)
}

function finalizePassageSentence(partial: Omit<PassageSentence, 'tokens'> & { tokens?: PassageSentence['tokens'] }): PassageSentence {
  const reading = String(partial.reading || '').trim()
  const tokens = (partial.tokens && partial.tokens.length)
    ? partial.tokens
    : tokensFromAnnotatedReading(reading)
  return { ...partial, reading, tokens }
}

const JP_CHUNK = /[\u3040-\u30ff\u4e00-\u9fffー]{2,40}/g

function pushGrammarTerm(bucket: string[], value: string) {
  const term = String(value || '').trim()
  if (!term || term.length < 1 || term.length > 40) return
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(term)) return
  // Skip pure Chinese tip fragments.
  if (!/[\u3040-\u30ff]/.test(term) && /[\u4e00-\u9fff]/.test(term) && !/[ぁ-んァ-ン]/.test(term)) {
    // Allow kanji-only Japanese examples like 東京大学.
    if (term.length < 2) return
  }
  bucket.push(term)
}

/** Collect searchable Japanese fragments from lesson grammar notes for red highlighting. */
export function grammarHighlightTerms(points: Array<{ name?: string; pattern?: string; explanation?: string }>) {
  const raw: string[] = []
  for (const point of points || []) {
    const name = String(point?.name || '').trim()
    const pattern = String(point?.pattern || '').trim()
    const explanation = String(point?.explanation || '').trim()
    const blob = [pattern, name, explanation].filter(Boolean).join('\n')

    // Example before —— : 「私はリンです——名词谓语句…」
    const beforeDash = blob.split(/——/)[0] || ''
    for (const part of beforeDash.split(/[：:／/;；、，,\n]+/)) {
      const cleaned = part.replace(/[～〜]/g, '').trim()
      pushGrammarTerm(raw, cleaned)
    }

    // Pattern slots: ～は～です / ～ですか → は, です, ですか
    for (const field of [name, pattern]) {
      for (const slot of String(field || '').split(/[～〜]+/)) {
        const piece = slot.replace(/[：:].*$/, '').trim()
        if (piece && piece.length <= 12) pushGrammarTerm(raw, piece)
      }
    }

    // JP phrase before a Chinese parenthetical: どうぞよろしく…（请多关照）
    for (const match of blob.matchAll(/([\u3040-\u30ff\u4e00-\u9fffー、。！？!?…\s]{2,40})（[^）]*[\u4e00-\u9fff]/g)) {
      pushGrammarTerm(raw, match[1].replace(/\s+/g, ''))
    }

    for (const match of explanation.matchAll(JP_CHUNK)) pushGrammarTerm(raw, match[0])
  }

  const unique = [...new Set(raw)]
  // Prefer longer phrases so「ですか」wins over「です」when overlapping left-to-right after sort.
  return unique.sort((a, b) => b.length - a.length || a.localeCompare(b, 'ja'))
}

export function highlightGrammarInText(text: string, terms: string[]) {
  const source = String(text || '')
  if (!source || !terms.length) return [{ text: source, hit: false as const }]
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  while (cursor < source.length) {
    let best: { term: string; at: number } | null = null
    for (const term of terms) {
      if (!term) continue
      const at = source.indexOf(term, cursor)
      if (at < 0) continue
      if (!best || at < best.at || (at === best.at && term.length > best.term.length)) {
        best = { term, at }
      }
    }
    if (!best) {
      parts.push({ text: source.slice(cursor), hit: false })
      break
    }
    if (best.at > cursor) parts.push({ text: source.slice(cursor, best.at), hit: false })
    parts.push({ text: best.term, hit: true })
    cursor = best.at + best.term.length
  }
  return parts.filter((part) => part.text)
}

function parseGrammarCell(cell: string): PassageSentence['grammar'] {
  return String(cell || '')
    .split(/[；;\n]+/)
    .map((item) => item.trim().replace(/^【|】$/g, ''))
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => {
      const match = item.match(/^(.{1,24}?)[：:]\s*(.+)$/s) || item.match(/^(.{1,24}?)\s*[（(]\s*(.+?)\s*[）)]$/)
      if (match) return { name: match[1].trim(), pattern: '', explanation: match[2].trim() }
      return { name: item.slice(0, 24), pattern: '', explanation: item }
    })
    .filter((point) => point.name)
}

function splitPassageColumns(line: string) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return [] as string[]
  // Markdown table: | 原文 | 中文解释 |
  if (trimmed.startsWith('|')) {
    return trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((col) => col.trim())
  }
  return trimmed.split(/\t|,|，/).map((col) => col.trim())
}

function isMarkdownSeparatorRow(cols: string[]) {
  return cols.length >= 2 && cols.every((col) => /^:?-{3,}:?$/.test(col.replace(/\s/g, '')))
}

/**
 * 解析用户整理的课文表格：每行「原文 [TAB/逗号/|] 中文解释 [语法考点]」，
 * 语法考点也可以单独成行（原文列为空，或以「【语法】」「语法：」开头），跟在每段课文后面。
 * 不是表格（没有任何多列行）时返回 null，走原来的纯文本流程。
 */
export function parsePassageTable(raw: string): { sourceText: string; sentences: PassageSentence[] } | null {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return null
  const rows = lines.map(splitPassageColumns).filter((row) => row.length && !isMarkdownSeparatorRow(row))
  let header: { text: number; reading: number; translation: number; grammar: number } | null = null
  const first = rows[0]
  if (first?.length >= 2) {
    const find = (pattern: RegExp) => first.findIndex((col) => pattern.test(col))
    const text = find(PASSAGE_TABLE_HEADER.text)
    const reading = find(PASSAGE_TABLE_HEADER.reading)
    const translation = find(PASSAGE_TABLE_HEADER.translation)
    const grammar = find(PASSAGE_TABLE_HEADER.grammar)
    if (text >= 0 && translation >= 0) {
      header = {
        text,
        reading: reading >= 0 ? reading : -1,
        translation,
        grammar: grammar >= 0 ? grammar : -1,
      }
    }
  }
  const body = header ? rows.slice(1) : rows
  const col = (row: string[], key: 'text' | 'reading' | 'translation' | 'grammar') => {
    if (header) {
      const index = header[key]
      return index >= 0 ? (row[index] || '') : ''
    }
    // Legacy 2–3 col: 原文 | 中文解释 [| 语法]
    if (key === 'text') return row[0] || ''
    if (key === 'translation') return row[1] || ''
    if (key === 'grammar') return row[2] || ''
    return ''
  }
  const sentences: PassageSentence[] = []
  let sawMultiColumn = false
  const attachGrammar = (cell: string) => {
    const points = parseGrammarCell(cell)
    if (!points.length || !sentences.length) return
    const last = sentences[sentences.length - 1]
    const seen = new Set(last.grammar.map((point) => point.name))
    last.grammar = [...last.grammar, ...points.filter((point) => !seen.has(point.name))].slice(0, 12)
  }
  for (const row of body) {
    let text = col(row, 'text')
    let grammarCell = col(row, 'grammar')
    const marker = text.match(/^【语法(考点)?】\s*[：:]?\s*(.+)$/s) || text.match(/^语法(考点)?\s*[：:]\s*(.+)$/s)
    if (marker) { text = ''; grammarCell = [marker[2], grammarCell].filter(Boolean).join('；') }
    if (row.length >= 2) sawMultiColumn = true
    if (!text) { attachGrammar(grammarCell); continue }
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) { attachGrammar(grammarCell || text); continue }
    sentences.push(finalizePassageSentence({
      id: uid(),
      text,
      reading: col(row, 'reading'),
      translation: col(row, 'translation'),
      grammar: [],
    }))
    if (grammarCell) attachGrammar(grammarCell)
  }
  if (!sawMultiColumn || !sentences.length) return null
  // 至少一句带中文翻译才认可是用户整理的表格，否则回退到纯文本流程。
  if (!sentences.some((sentence) => hasChineseTranslation(sentence.translation))) return null
  return { sourceText: sentences.map((sentence) => sentence.text).join('\n'), sentences }
}

export type PassageLessonDraft = {
  title: string
  learningGoal?: string
  sourceText: string
  sentences: PassageSentence[]
}

export type ParsedPassageImport = {
  documentTitle: string
  lessons: PassageLessonDraft[]
}

function stripMarkdownHeading(line: string) {
  return String(line || '').replace(/^#{1,6}\s+/, '').replace(/\*+/g, '').trim()
}

function looksLikePassageHandbook(raw: string) {
  const text = String(raw || '')
  if (/^#{1,3}\s*课文\s*\d+/m.test(text) || /^#{1,3}\s*.*会話/m.test(text)) return true
  if (/【课文整理】/.test(text) && /\|\s*原文\s*\|/.test(text)) return true
  if (/^#{1,3}\s+/m.test(text) && /\|\s*原文\s*\|/.test(text) && /\|\s*中文解释\s*\|/.test(text)) return true
  return false
}

function parseHandbookGrammarBullets(block: string): PassageSentence['grammar'] {
  const points: PassageSentence['grammar'] = []
  for (const line of String(block || '').split(/\r?\n/)) {
    const bullet = line.trim().match(/^[-*・]\s+(.+)$/) || line.trim().match(/^\d+[\.、]\s*(.+)$/)
    if (!bullet) continue
    points.push(...parseGrammarCell(bullet[1]))
  }
  return points.slice(0, 12)
}

function parseHandbookLessonBody(title: string, body: string): PassageLessonDraft | null {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n')
  let learningGoal = ''
  const tableLines: string[] = []
  let inTable = false
  let grammarBlock = ''
  let inGrammar = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,6}\s+/.test(line)) continue
    if (/^学习目标\s*[：:]/.test(line)) {
      learningGoal = line.replace(/^学习目标\s*[：:]\s*/, '').trim()
      inGrammar = false
      continue
    }
    if (/^\*{0,2}语法考点\*{0,2}\s*$/.test(line) || /^#{1,6}\s*语法考点/.test(line)) {
      inGrammar = true
      inTable = false
      continue
    }
    if (line.startsWith('|')) {
      inTable = true
      inGrammar = false
      tableLines.push(line)
      continue
    }
    if (inTable && !line.startsWith('|')) inTable = false
    if (inGrammar) {
      grammarBlock += `${line}\n`
      continue
    }
  }

  const table = parsePassageTable(tableLines.join('\n'))
  if (!table?.sentences.length) return null
  const grammar = parseHandbookGrammarBullets(grammarBlock)
  if (grammar.length) {
    const last = table.sentences[table.sentences.length - 1]
    const seen = new Set(last.grammar.map((point) => point.name))
    last.grammar = [...last.grammar, ...grammar.filter((point) => !seen.has(point.name))].slice(0, 12)
  }
  return {
    title: title.slice(0, 80) || '课文',
    learningGoal: learningGoal.slice(0, 200) || undefined,
    sourceText: table.sourceText,
    sentences: table.sentences,
  }
}

/**
 * 解析「课文整理」Markdown 手册：
 * # 课时（如第007课）
 * ## 章节（课文1 / 课文2 …）
 * 学习目标：…
 * | 原文 | 假名注音 | 中文解释 |
 * **语法考点**
 * - …
 * 一篇文件可含多章节，每章节拆成独立 Passage。上传内容原样入库，不调用模型。
 */
export function parsePassageHandbook(raw: string): ParsedPassageImport | null {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  if (!text || !looksLikePassageHandbook(text)) return null

  const lines = text.split('\n')
  let documentTitle = ''
  const sections: Array<{ title: string; body: string }> = []
  let current: { title: string; body: string } | null = null

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const title = stripMarkdownHeading(heading[2])
      if (level === 1 && !documentTitle) {
        documentTitle = title.replace(/^【课文整理】\s*/, '').trim() || title
        continue
      }
      if (level <= 2) {
        if (current) sections.push(current)
        current = { title, body: '' }
        continue
      }
    }
    if (current) current.body += `${line}\n`
    else if (!documentTitle && line.trim() && !line.trim().startsWith('|')) {
      // fall through: preamble without H1
    }
  }
  if (current) sections.push(current)

  const lessons = (sections.length
    ? sections
    : [{ title: documentTitle || '课文', body: text }]
  )
    .map((section) => parseHandbookLessonBody(section.title, section.body))
    .filter((item): item is PassageLessonDraft => Boolean(item))

  if (!lessons.length) {
    // 整篇只有一张表、没有「课文N」二级标题时
    const fallback = parseHandbookLessonBody(documentTitle || '课文', text)
    if (!fallback) return null
    return { documentTitle: documentTitle || fallback.title, lessons: [fallback] }
  }

  return { documentTitle: documentTitle || lessons[0].title, lessons }
}

/** 手册 Markdown → 多课；否则单表 TSV；都不是则 null（走纯文本拆句）。 */
export function parsePassageImport(raw: string): ParsedPassageImport | null {
  const handbook = parsePassageHandbook(raw)
  if (handbook?.lessons.length) return handbook
  const table = parsePassageTable(raw)
  if (!table) return null
  return {
    documentTitle: '',
    lessons: [{ title: '课文', sourceText: table.sourceText, sentences: table.sentences }],
  }
}

export function unusedPassageVocab(passage: Passage, existingTerms: string[]) {
  const have = new Set(existingTerms.map((term) => term.trim()).filter(Boolean))
  return extractPassageVocab(passage).filter((draft) => !have.has(draft.term))
}

export function extractPassageVocab(passage: Passage): ImportDraft[] {
  const drafts: ImportDraft[] = []
  const seen = new Set<string>()
  for (const sentence of passage.sentences || []) {
    for (const token of sentence.tokens || []) {
      const term = String(token.surface || '').trim()
      if (!looksLikeVocabularyTerm(term) || PARTICLES.test(term) || seen.has(term)) continue
      seen.add(term)
      drafts.push({
        term,
        reading: String(token.reading || '').trim() || undefined,
        meaning: String(token.meaning || '').trim() || undefined,
      })
    }
  }
  return drafts
}

export function recordSentenceScore(progress: Record<string, SentenceProgress> | undefined, sentenceId: string, score: number): Record<string, SentenceProgress> {
  const previous = progress?.[sentenceId] || { attempts: 0, lastScore: 0, bestScore: 0 }
  const nextScore = Math.max(0, Math.min(100, Math.round(score)))
  return {
    ...(progress || {}),
    [sentenceId]: {
      ...previous,
      attempts: previous.attempts + 1,
      lastScore: nextScore,
      bestScore: Math.max(previous.bestScore, nextScore),
    },
  }
}

export function recordSentenceDictation(progress: Record<string, SentenceProgress> | undefined, sentenceId: string, dictation: string): Record<string, SentenceProgress> {
  const previous = progress?.[sentenceId] || { attempts: 0, lastScore: 0, bestScore: 0 }
  return {
    ...(progress || {}),
    [sentenceId]: {
      ...previous,
      dictation: String(dictation || '').slice(0, 2000),
    },
  }
}

export function passageProgressSummary(passage: Passage) {
  const sentences = passage.sentences || []
  const practiced = sentences.filter((sentence) => (passage.progress?.[sentence.id]?.attempts || 0) > 0)
  const scores = practiced.map((sentence) => passage.progress?.[sentence.id]?.bestScore || 0)
  return {
    total: sentences.length,
    practiced: practiced.length,
    average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
  }
}

export function listPassageBooks(passages: Passage[]) {
  const books = new Map<string, string>()
  for (const passage of passages) {
    const id = String(passage.bookId || '').trim()
    if (!id) continue
    books.set(id, String(passage.bookName || '').trim() || '未命名课本')
  }
  return [...books.entries()].map(([id, name]) => ({ id, name }))
}

export function listPassageLessons(passages: Passage[]): Array<{ id: string; bookId: string; name: string }> {
  const map = new Map<string, { id: string; bookId: string; name: string }>()
  for (const passage of passages) {
    const id = String(passage.lessonId || '').trim()
    const name = String(passage.lessonName || '').trim()
    if (!id || !name) continue
    const bookId = String(passage.bookId || '').trim()
    const prev = map.get(id)
    map.set(id, {
      id,
      bookId: bookId || prev?.bookId || '',
      name: name || prev?.name || '未命名课时',
    })
  }
  return [...map.values()]
}

export function passagesInBook(passages: Passage[], bookId: string) {
  if (!bookId) return passages.filter((item) => !item.bookId)
  return passages.filter((item) => item.bookId === bookId)
}

/** 课本 → 课时 → 章节 排序，供目录与「下一课」使用。 */
export function orderPassagesByCatalog(
  books: Array<{ id: string }>,
  lessons: Array<{ id: string; bookId: string }>,
  passages: Passage[],
) {
  const seen = new Set<string>()
  const ordered: Passage[] = []
  const push = (items: Passage[]) => {
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      ordered.push(item)
    }
  }

  for (const book of books) {
    const bookLessons = lessons.filter((lesson) => lesson.bookId === book.id)
    for (const lesson of bookLessons) {
      push(passages.filter((item) => item.bookId === book.id && item.lessonId === lesson.id))
    }
    push(passages.filter((item) => item.bookId === book.id && !item.lessonId))
  }
  push(passages.filter((item) => !item.bookId))
  return ordered
}

/** 目录里「课时」选项的稳定 key（有 lessonId 用课时，否则按课本下的未分课时）。 */
export function passageLessonKey(passage: Passage) {
  const lessonId = String(passage.lessonId || '').trim()
  if (lessonId) return `lesson:${lessonId}`
  return `orphan:${String(passage.bookId || '').trim()}`
}

export type CatalogLessonOption = {
  key: string
  bookId: string
  bookName: string
  lessonId: string
  lessonName: string
}

/** 课程目录用的课时列表（按课本分组顺序）。 */
export function listCatalogLessons(
  books: Array<{ id: string; name: string }>,
  lessons: Array<{ id: string; bookId: string; name: string }>,
  passages: Passage[],
): CatalogLessonOption[] {
  const options: CatalogLessonOption[] = []
  const seen = new Set<string>()
  const bookName = (bookId: string) => books.find((book) => book.id === bookId)?.name
    || passages.find((item) => item.bookId === bookId)?.bookName
    || ''

  const push = (option: CatalogLessonOption) => {
    if (!option.key || seen.has(option.key)) return
    if (!passages.some((item) => passageLessonKey(item) === option.key)) return
    seen.add(option.key)
    options.push(option)
  }

  for (const book of books) {
    for (const lesson of lessons.filter((item) => item.bookId === book.id)) {
      push({
        key: `lesson:${lesson.id}`,
        bookId: book.id,
        bookName: book.name,
        lessonId: lesson.id,
        lessonName: lesson.name,
      })
    }
    push({
      key: `orphan:${book.id}`,
      bookId: book.id,
      bookName: book.name,
      lessonId: '',
      lessonName: '未分课时',
    })
  }

  for (const lesson of lessons.filter((item) => !item.bookId || !books.some((book) => book.id === item.bookId))) {
    push({
      key: `lesson:${lesson.id}`,
      bookId: lesson.bookId,
      bookName: bookName(lesson.bookId) || '未分组',
      lessonId: lesson.id,
      lessonName: lesson.name,
    })
  }

  push({
    key: 'orphan:',
    bookId: '',
    bookName: '未分组',
    lessonId: '',
    lessonName: '未分课时',
  })

  return options
}

export function catalogOptionLabel(passage: Passage) {
  const lesson = String(passage.lessonName || '').trim()
  const title = String(passage.title || '').trim() || '课文'
  const count = passage.sentences?.length || passage.sentenceCount || 0
  const head = lesson ? `${lesson} · ${title}` : title
  return `${head}（${count} 句）`
}

export function chapterOptionLabel(passage: Passage) {
  const title = String(passage.title || '').trim() || '课文'
  const count = passage.sentences?.length || passage.sentenceCount || 0
  return `${title}（${count} 句）`
}

export function sentencePractice(passage: Passage, sentence: PassageSentence) {
  return passage.progress?.[sentence.id]
}

export function mergePassageBooks(books: { id: string; name: string }[], passages: Passage[]) {
  const map = new Map<string, string>()
  for (const book of books) {
    const id = String(book.id || '').trim()
    if (!id) continue
    map.set(id, String(book.name || '').trim() || '未命名课本')
  }
  for (const book of listPassageBooks(passages)) map.set(book.id, book.name)
  return [...map.entries()].map(([id, name]) => ({ id, name }))
}

export function mergePassageLessons(
  lessons: Array<{ id: string; bookId: string; name: string }>,
  passages: Passage[],
) {
  const map = new Map<string, { id: string; bookId: string; name: string }>()
  for (const lesson of lessons) {
    const id = String(lesson.id || '').trim()
    const name = String(lesson.name || '').trim()
    if (!id || !name) continue
    map.set(id, {
      id,
      bookId: String(lesson.bookId || '').trim(),
      name,
    })
  }
  for (const lesson of listPassageLessons(passages)) {
    const prev = map.get(lesson.id)
    map.set(lesson.id, {
      id: lesson.id,
      bookId: lesson.bookId || prev?.bookId || '',
      name: lesson.name || prev?.name || '未命名课时',
    })
  }
  return [...map.values()]
}
