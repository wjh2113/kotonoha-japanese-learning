import type { ImportDraft, Word } from './types'
import { fallbackLexicon } from './data'

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function parseVocabulary(raw: string): ImportDraft[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const json = JSON.parse(trimmed)
    const arr = Array.isArray(json) ? json : json.words
    if (Array.isArray(arr)) {
      return arr.map((item) => typeof item === 'string' ? { term: item } : {
        term: String(item.term || item.word || item['单词'] || '').trim(),
        reading: String(item.reading || item.kana || item['读音'] || '').trim() || undefined,
        meaning: String(item.meaning || item.definition || item['释义'] || '').trim() || undefined,
      }).filter((item) => item.term)
    }
  } catch { /* plain text or CSV */ }

  return trimmed.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(单词|word)[,\t]/i.test(line))
    .map((line) => {
      const cols = line.split(/\t|,|，/).map((part) => part.trim())
      return { term: cols[0], reading: cols[1] || undefined, meaning: cols[2] || undefined }
    })
    .filter((item) => item.term)
}

export function makeFallbackWord(draft: ImportDraft): Word {
  const known = fallbackLexicon[draft.term] || {}
  const reading = draft.reading || known.reading || toHiragana(draft.term)
  return {
    id: uid(), term: draft.term, reading,
    meaning: draft.meaning || known.meaning || '待补充释义',
    partOfSpeech: known.partOfSpeech || '词性待确认',
    example: known.example || `${draft.term}を勉強します。`,
    exampleReading: known.exampleReading || `${reading}を べんきょうします。`,
    translation: known.translation || `学习“${draft.term}”这个词。`,
    mastered: false, createdAt: Date.now(),
  }
}

export function toHiragana(input: string) {
  return input.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

export function normalizeJapanese(input: string) {
  return toHiragana(input)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s。、！？,.!?・「」『』]/g, '')
}

export function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[b.length][a.length]
}

export function pronunciationScoreFor(transcript: string, ...targets: string[]) {
  const spoken = normalizeJapanese(transcript)
  const candidates = targets.map(normalizeJapanese).filter(Boolean)
  if (!candidates.length) return 0
  const scores = candidates.map((target) => Math.max(0, Math.round((1 - levenshtein(spoken, target) / Math.max(spoken.length, target.length, 1)) * 100)))
  return Math.max(...scores)
}

export function pronunciationScore(transcript: string, word: Word) {
  return pronunciationScoreFor(transcript, word.term, word.reading)
}

export function splitJapaneseSentences(raw: string) {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。．！？!?])/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function matchesTypingAnswer(input: string, word: Word) {
  const normalized = normalizeJapanese(input)
  return Boolean(normalized) && [word.term, word.reading].some((answer) => normalizeJapanese(answer) === normalized)
}

export function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5)
}

export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const
const DAY = 24 * 60 * 60 * 1000

export function scheduleReview(word: Word, remembered: boolean, now = Date.now()): Partial<Word> {
  if (!remembered) {
    return { reviewStage: 0, lastReviewedAt: now, nextReviewAt: now + 10 * 60 * 1000 }
  }
  const previous = (word.lastReviewedAt || word.nextReviewAt) ? (word.reviewStage ?? 0) : -1
  const reviewStage = Math.min(previous + 1, REVIEW_INTERVAL_DAYS.length - 1)
  return { reviewStage, lastReviewedAt: now, nextReviewAt: now + REVIEW_INTERVAL_DAYS[reviewStage] * DAY }
}

export function getReviewState(word: Word, now = Date.now()) {
  const nextReviewAt = word.nextReviewAt ?? (word.mastered ? 0 : Number.POSITIVE_INFINITY)
  const due = nextReviewAt <= now
  const daysUntil = Number.isFinite(nextReviewAt) ? Math.ceil((nextReviewAt - now) / DAY) : null
  return { due, nextReviewAt, daysUntil, stage: word.reviewStage ?? 0 }
}

export function formatReviewTime(word: Word, now = Date.now()) {
  const state = getReviewState(word, now)
  if (!Number.isFinite(state.nextReviewAt)) return '尚未进入复习计划'
  if (state.due) return '现在应复习'
  if (state.daysUntil === 1) return '明天复习'
  return `${state.daysUntil} 天后复习`
}
