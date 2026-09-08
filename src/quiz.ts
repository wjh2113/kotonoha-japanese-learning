import { initialUnits } from './data'
import type { Word } from './types'
import { shuffle } from './utils'

export const ENRICH_BATCH_SIZE = 20

export function isPlaceholderMeaning(meaning?: string) {
  const text = String(meaning || '').trim()
  if (!text) return true
  return /待补充|未知|不明|暂无|未查询|词义缺失|n\/a|unknown/i.test(text)
}

export function usableQuizWords(words: Word[]) {
  return words.filter((word) => word.term.trim() && !isPlaceholderMeaning(word.meaning))
}

export function buildQuizOptions(current: Word, pool: Word[], extra: Word[] = []) {
  const wanted = current.meaning.trim()
  const seen = new Set<string>([wanted])
  const candidates = shuffle([...pool, ...extra])
  const distractors: Word[] = []
  for (const word of candidates) {
    const meaning = word.meaning.trim()
    if (word.id === current.id || isPlaceholderMeaning(meaning) || seen.has(meaning)) continue
    seen.add(meaning)
    distractors.push(word)
    if (distractors.length >= 3) break
  }
  const options = [current, ...distractors]
  return shuffle(options)
}

export function sharedDistractors() {
  return initialUnits.flatMap((unit) => unit.words)
}

export function mergeEnrichedWord(word: Word, extra: Partial<Word> = {}): Word {
  const meaning = String(extra.meaning || '').trim()
  return {
    ...word,
    reading: String(extra.reading || word.reading).trim() || word.reading,
    meaning: isPlaceholderMeaning(meaning) ? word.meaning : meaning,
    partOfSpeech: String(extra.partOfSpeech || word.partOfSpeech).trim() || word.partOfSpeech,
    example: String(extra.example || word.example).trim() || word.example,
    exampleReading: String(extra.exampleReading || word.exampleReading).trim() || word.exampleReading,
    translation: String(extra.translation || word.translation).trim() || word.translation,
  }
}
