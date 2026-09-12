import { isPassagePlaceholder, looksLikeErrorDocument, PASSAGE_OCR_PLACEHOLDER } from './error-text'
import { looksLikeVocabularyTerm } from './lexeme'
import type { ImportDraft, Passage, PassageSentence, SentenceProgress } from './types'
import { uid } from './utils'

const PARTICLES = /^(は|が|を|に|の|と|も|で|へ|や|か|ね|よ|な|だ|です|ます|した|して)$/

export const PASSAGE_ANALYZE_CHUNK = 2

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
  return !hasChineseTranslation(sentence.translation) || !(sentence.tokens || []).length
}

export function passageNeedsAnalysis(passage: Passage) {
  if (isTransientPassage(passage)) return false
  if (passage.status === 'processing' || passage.status === 'error') return true
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
      reading: sentence.reading || match.reading,
      // 用户表格里提供的翻译/语法优先，模型只补空缺。
      translation: hasChineseTranslation(sentence.translation) ? sentence.translation : match.translation,
      tokens: match.tokens.length ? match.tokens : sentence.tokens,
      grammar: sentence.grammar.length ? sentence.grammar : match.grammar,
    }
  })
}

const PASSAGE_TABLE_HEADER = {
  text: /^(原文|日文|日语|句子|课文|text|sentence|japanese)$/i,
  translation: /^(中文解释|中文释义|中文|解释|释义|翻译|译文|translation|chinese|meaning)$/i,
  grammar: /^(语法考点|语法|考点|grammar)/i,
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

/**
 * 解析用户整理的课文表格：每行「原文 [TAB/逗号] 中文解释 [语法考点]」，
 * 语法考点也可以单独成行（原文列为空，或以「【语法】」「语法：」开头），跟在每段课文后面。
 * 不是表格（没有任何多列行）时返回 null，走原来的纯文本流程。
 */
export function parsePassageTable(raw: string): { sourceText: string; sentences: PassageSentence[] } | null {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return null
  const rows = lines.map((line) => line.split(/\t|,|，/).map((col) => col.trim()))
  let header: { text: number; translation: number; grammar: number } | null = null
  const first = rows[0]
  if (first.length >= 2) {
    const find = (pattern: RegExp) => first.findIndex((col) => pattern.test(col))
    const text = find(PASSAGE_TABLE_HEADER.text)
    const translation = find(PASSAGE_TABLE_HEADER.translation)
    const grammar = find(PASSAGE_TABLE_HEADER.grammar)
    if (text >= 0 && translation >= 0) header = { text, translation, grammar: grammar >= 0 ? grammar : 2 }
  }
  const body = header ? rows.slice(1) : rows
  const col = (row: string[], key: 'text' | 'translation' | 'grammar') => {
    if (header) return row[header[key]] || ''
    return row[key === 'text' ? 0 : key === 'translation' ? 1 : 2] || ''
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
    sentences.push({
      id: uid(),
      text,
      reading: '',
      translation: col(row, 'translation'),
      tokens: [],
      grammar: [],
    })
    if (grammarCell) attachGrammar(grammarCell)
  }
  if (!sawMultiColumn || !sentences.length) return null
  // 至少一句带中文翻译才认可是用户整理的表格，否则回退到纯文本流程。
  if (!sentences.some((sentence) => hasChineseTranslation(sentence.translation))) return null
  return { sourceText: sentences.map((sentence) => sentence.text).join('\n'), sentences }
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

export function passagesInBook(passages: Passage[], bookId: string) {
  if (!bookId) return passages.filter((item) => !item.bookId)
  return passages.filter((item) => item.bookId === bookId)
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
