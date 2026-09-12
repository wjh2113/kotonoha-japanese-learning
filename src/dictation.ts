import { looksLikeVocabularyTerm } from './lexeme'
import type { Word } from './types'
import { getReviewState, toHiragana } from './utils'

export const DICTATION_PLAN_KEY = 'kotonoha-dictation-plan-v1'
export const DEFAULT_DICTATION_GOAL = 20
export const MIN_DICTATION_GOAL = 5
export const MAX_DICTATION_GOAL = 200

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

export function toKatakana(input: string) {
  return String(input || '').replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
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

export function dictationCandidates(words: Word[]) {
  return words.filter((word) => looksLikeVocabularyTerm(word.term) && compactKana(wordKatakana(word)))
}

export function suggestedReviewWords(words: Word[], now = Date.now()) {
  return dictationCandidates(words).filter((word) => getReviewState(word, now).due)
}

export function pickDictationWords(words: Word[], goal: number, alreadyLearned: string[] = []) {
  const learned = new Set(alreadyLearned)
  const usable = dictationCandidates(words)
  const fresh = usable.filter((word) => !word.mastered && !learned.has(word.id))
  const rest = usable.filter((word) => !fresh.some((item) => item.id === word.id) && !learned.has(word.id))
  return [...fresh, ...rest].slice(0, clampDictationGoal(goal))
}
