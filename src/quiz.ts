import { initialUnits } from './data'
import { isChineseGloss, looksLikeVocabularyTerm, quizGloss } from './lexeme'
import type { Word } from './types'
import { shuffle } from './utils'

export const ENRICH_BATCH_SIZE = 20

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
