import { looksLikeVocabularyTerm } from './lexeme'
import type { Word } from './types'
import { getReviewState, toHiragana } from './utils'

export const DICTATION_PLAN_KEY = 'kotonoha-dictation-plan-v1'
export const DICTATION_PLAY_KEY = 'kotonoha-dictation-play-v1'
export const DEFAULT_DICTATION_GOAL = 20
export const MIN_DICTATION_GOAL = 5
export const MAX_DICTATION_GOAL = 200
export const DEFAULT_PLAY_TIMES = 3
export const PLAY_TIMES_OPTIONS = [1, 2, 3, 4, 5] as const
export const PLAY_SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const

export type DictationPlan = {
  date: string
  goal: number
  learnedIds: string[]
  reviewedIds: string[]
}

export type KatakanaMark = {
  char: string
  ok: boolean
}

export function todayKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function clampDictationGoal(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DICTATION_GOAL
  return Math.max(MIN_DICTATION_GOAL, Math.min(MAX_DICTATION_GOAL, Math.round(value)))
}

export function emptyDictationPlan(goal = DEFAULT_DICTATION_GOAL): DictationPlan {
  return { date: todayKey(), goal: clampDictationGoal(goal), learnedIds: [], reviewedIds: [] }
}

export function loadDictationPlan(): DictationPlan {
  try {
    const parsed = JSON.parse(localStorage.getItem(DICTATION_PLAN_KEY) || '')
    if (parsed?.date !== todayKey()) return emptyDictationPlan(Number(parsed?.goal) || DEFAULT_DICTATION_GOAL)
    return {
      date: parsed.date,
      goal: clampDictationGoal(Number(parsed.goal) || DEFAULT_DICTATION_GOAL),
      learnedIds: Array.isArray(parsed.learnedIds) ? parsed.learnedIds.map(String) : [],
      reviewedIds: Array.isArray(parsed.reviewedIds) ? parsed.reviewedIds.map(String) : [],
    }
  } catch {
    return emptyDictationPlan()
  }
}

export function saveDictationPlan(plan: DictationPlan) {
  localStorage.setItem(DICTATION_PLAN_KEY, JSON.stringify({
    ...plan,
    date: todayKey(),
    goal: clampDictationGoal(plan.goal),
  }))
}

export type DictationPlay = {
  times: number
  speed: number
}

export function clampPlayTimes(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PLAY_TIMES
  return Math.max(1, Math.min(5, Math.round(value)))
}

export function clampPlaySpeed(value: number) {
  const speed = Number(value)
  return (PLAY_SPEED_OPTIONS as readonly number[]).includes(speed) ? speed : 1
}

export function emptyDictationPlay(): DictationPlay {
  return { times: DEFAULT_PLAY_TIMES, speed: 1 }
}

export function loadDictationPlay(): DictationPlay {
  try {
    const parsed = JSON.parse(localStorage.getItem(DICTATION_PLAY_KEY) || '')
    return {
      times: clampPlayTimes(Number(parsed?.times)),
      speed: clampPlaySpeed(Number(parsed?.speed)),
    }
  } catch {
    return emptyDictationPlay()
  }
}

export function saveDictationPlay(play: DictationPlay) {
  localStorage.setItem(DICTATION_PLAY_KEY, JSON.stringify({
    times: clampPlayTimes(play.times),
    speed: clampPlaySpeed(play.speed),
  }))
}

export function toKatakana(input: string) {
  return String(input || '').replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
}

export function isDictationSubmitEnter(event: {
  key: string
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}) {
  if (event.key !== 'Enter') return false
  if (event.isComposing || event.nativeEvent?.isComposing) return false
  const code = event.keyCode ?? event.nativeEvent?.keyCode
  return code !== 229
}

export function compactKana(input: string) {
  return toKatakana(toHiragana(String(input || '').normalize('NFKC')))
    .replace(/[\s。、！？,.!?・「」『』]/g, '')
}

export function wordKatakana(word: Pick<Word, 'term' | 'reading'>) {
  const reading = String(word.reading || '').trim()
  const term = String(word.term || '').trim()
  const source = reading || term
  return toKatakana(toHiragana(source)).replace(/[−-]/g, 'ー')
}

export function matchesKatakanaAnswer(input: string, word: Pick<Word, 'term' | 'reading'>) {
  const typed = compactKana(input)
  if (!typed) return false
  const expected = compactKana(wordKatakana(word))
  const reading = compactKana(word.reading)
  const term = compactKana(word.term)
  const termIsKana = !/[一-龯々〆〇]/.test(String(word.term || ''))
  return typed === expected || (Boolean(reading) && typed === reading) || (termIsKana && Boolean(term) && typed === term)
}

export function katakanaDiff(typed: string, expected: string): KatakanaMark[] {
  const a = toKatakana(toHiragana(String(typed || '').normalize('NFKC'))).replace(/\s/g, '')
  const b = toKatakana(toHiragana(String(expected || '').normalize('NFKC'))).replace(/\s/g, '')
  return a.split('').map((char, index) => ({ char, ok: char === b[index] }))
}

export function dictationGap(misses: number) {
  if (misses <= 1) return 2
  if (misses === 2) return 5
  return 8
}

export function reinsertAfterMiss<T>(items: T[], index: number, gap: number) {
  if (index < 0 || index >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(Math.min(next.length, index + Math.max(1, gap)), 0, item)
  return next
}

export function removeCurrent<T>(items: T[], index: number) {
  if (index < 0 || index >= items.length) return items
  return items.filter((_, itemIndex) => itemIndex !== index)
}

export function hasUsableKanaReading(word: Pick<Word, 'term' | 'reading'>) {
  const isKanaOnly = (value: string) => {
    const compact = compactKana(value)
    return Boolean(compact) && !/[一-龯々〆〇A-Za-z]/.test(compact)
  }
  const reading = String(word.reading || '').trim()
  const term = String(word.term || '').trim()
  if (reading && isKanaOnly(reading)) return true
  // Pure kana headwords (no kanji) can be dictated without a separate reading.
  if (term && !/[一-龯々〆〇]/.test(term) && isKanaOnly(term)) return true
  return false
}

export function dictationCandidates(words: Word[]) {
  return words.filter((word) => looksLikeVocabularyTerm(word.term) && hasUsableKanaReading(word))
}

export function isConfirmEnter(event: { key: string; isComposing?: boolean; keyCode?: number }) {
  if (event.key !== 'Enter') return false
  return !event.isComposing && event.keyCode !== 229
}

export function hasDictationHistory(word: Word) {
  return Boolean(word.wrongBook) || (word.listeningCorrect || 0) + (word.listeningWrong || 0) > 0
}

export function suggestedReviewWords(words: Word[], now = Date.now()) {
  return dictationCandidates(words).filter((word) => {
    if (!hasDictationHistory(word)) return false
    if (word.wrongBook && !word.mastered) return true
    return getReviewState(word, now).due
  })
}

export function pickDictationWords(words: Word[], goal: number, alreadyLearned: string[] = []) {
  const learned = new Set(alreadyLearned)
  const usable = dictationCandidates(words)
  const fresh = usable.filter((word) => !word.mastered && !learned.has(word.id))
  const rest = usable.filter((word) => !fresh.some((item) => item.id === word.id) && !learned.has(word.id))
  return [...fresh, ...rest].slice(0, clampDictationGoal(goal))
}

export const STICKY_DICTATION_MISSES = 3

export type ErrorBookFilter = 'all' | 'fresh' | 'reviewing' | 'sticky' | 'mastered'

export function isStickyMiss(misses = 0) {
  return misses >= STICKY_DICTATION_MISSES
}

export function matchesErrorBookFilter(word: Word, filter: ErrorBookFilter) {
  if (!word.wrongBook) return false
  if (filter === 'fresh') return !word.mastered && !word.errorReviewed
  if (filter === 'reviewing') return !word.mastered && Boolean(word.errorReviewed)
  if (filter === 'sticky') return !word.mastered && isStickyMiss(word.dictationMisses)
  if (filter === 'mastered') return Boolean(word.mastered)
  return true
}

export function errorBookWords(words: Word[], filter: ErrorBookFilter = 'all') {
  return words.filter((word) => matchesErrorBookFilter(word, filter))
}

export function pickErrorBookWords(words: Word[], limit = 200) {
  return dictationCandidates(words.filter((word) => word.wrongBook && !word.mastered)).slice(0, limit)
}

export function unitStudyProgress(words: Word[]) {
  const total = words.length
  const mastered = words.filter((word) => word.mastered).length
  return { total, mastered, percent: total ? Math.round((mastered / total) * 100) : 0 }
}

export function sessionMissStats(missCounts: Record<string, number>) {
  const missedIds = Object.keys(missCounts)
  return {
    missed: missedIds.length,
    sticky: missedIds.filter((id) => isStickyMiss(missCounts[id])).length,
  }
}
