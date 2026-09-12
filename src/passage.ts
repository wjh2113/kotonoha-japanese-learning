import { isPassagePlaceholder, looksLikeErrorDocument, PASSAGE_OCR_PLACEHOLDER } from './error-text'
import { looksLikeVocabularyTerm } from './lexeme'
import type { ImportDraft, Passage, PassageSentence, SentenceProgress } from './types'

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
      reading: match.reading || sentence.reading,
      translation: hasChineseTranslation(match.translation) ? match.translation : sentence.translation,
      tokens: match.tokens.length ? match.tokens : sentence.tokens,
      grammar: match.grammar.length ? match.grammar : sentence.grammar,
    }
  })
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
      attempts: previous.attempts + 1,
      lastScore: nextScore,
      bestScore: Math.max(previous.bestScore, nextScore),
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
