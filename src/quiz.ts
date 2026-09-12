import { initialUnits } from './data'
import { isChineseGloss, looksLikeVocabularyTerm, quizGloss } from './lexeme'
import type { Word } from './types'
import { scheduleReview, shuffle } from './utils'

export const ENRICH_BATCH_SIZE = 12

export function isPlaceholderMeaning(meaning?: string) {
  return !isChineseGloss(meaning)
}

export function usableQuizWords(words: Word[], kind: 'listening' | 'meaning' = 'meaning') {
  return words.filter((word) => kind === 'listening'
    ? looksLikeVocabularyTerm(word.term)
    : Boolean(word.term.trim()) && isChineseGloss(word.meaning))
}

export function optionLabel(word: Word, kind: 'listening' | 'meaning') {
  return kind === 'listening' ? word.term.trim() : quizGloss(word.meaning)
}

export function buildQuizOptions(current: Word, pool: Word[], extra: Word[] = [], kind: 'listening' | 'meaning' = 'meaning') {
  const wanted = optionLabel(current, kind)
  const seen = new Set<string>([wanted])
  const candidates = shuffle([...pool, ...extra])
  const distractors: Word[] = []
  for (const word of candidates) {
    if (word.id === current.id) continue
    if (kind === 'listening' ? !looksLikeVocabularyTerm(word.term) : !isChineseGloss(word.meaning)) continue
    const label = optionLabel(word, kind)
    if (!label || seen.has(label)) continue
    seen.add(label)
    distractors.push(word)
    if (distractors.length >= 3) break
  }
  return shuffle([current, ...distractors])
}

export function sharedDistractors() {
  return initialUnits.flatMap((unit) => unit.words)
}

export function mergeEnrichedWord(word: Word, extra: Partial<Word> = {}): Word {
  const meaning = String(extra.meaning || '').trim()
  return {
    ...word,
    reading: String(extra.reading || word.reading).trim() || word.reading,
    meaning: isChineseGloss(meaning) ? meaning : word.meaning,
    partOfSpeech: String(extra.partOfSpeech || word.partOfSpeech).trim() || word.partOfSpeech,
    example: String(extra.example || word.example).trim() || word.example,
    exampleReading: String(extra.exampleReading || word.exampleReading).trim() || word.exampleReading,
    translation: String(extra.translation || word.translation).trim() || word.translation,
  }
}

function tally(value?: number) {
  return Math.max(0, Math.min(99, Math.floor(Number(value) || 0)))
}

export function quizWeakness(word: Word, kind: 'listening' | 'meaning') {
  const wrong = kind === 'listening' ? tally(word.listeningWrong) : tally(word.meaningWrong)
  const correct = kind === 'listening' ? tally(word.listeningCorrect) : tally(word.meaningCorrect)
  if (wrong > 0) return 1000 + wrong * 10
  if (correct === 0) return 100
  return 1
}

export function orderQuizByWeakness(words: Word[], kind: 'listening' | 'meaning') {
  return [...words]
    .map((word) => ({ word, rank: quizWeakness(word, kind) * 1000 + Math.random() }))
    .sort((left, right) => right.rank - left.rank)
    .map((item) => item.word)
}

export function recordQuizAnswer(word: Word, kind: 'listening' | 'meaning', correct: boolean, now = Date.now()): Partial<Word> {
  const review = scheduleReview(word, correct, now)
  const deltaWrong = correct ? -1 : 1
  if (kind === 'listening') {
    return {
      ...review,
      listeningCorrect: tally(tally(word.listeningCorrect) + (correct ? 1 : 0)),
      listeningWrong: tally(tally(word.listeningWrong) + deltaWrong),
    }
  }
  return {
    ...review,
    meaningCorrect: tally(tally(word.meaningCorrect) + (correct ? 1 : 0)),
    meaningWrong: tally(tally(word.meaningWrong) + deltaWrong),
  }
}
