import { describe, expect, it } from 'vitest'
import { levenshtein, makeFallbackWord, normalizeJapanese, parseVocabulary, pronunciationScore, toHiragana } from './utils'

describe('parseVocabulary', () => {
  it('parses one-word-per-line text', () => {
    expect(parseVocabulary('猫\n犬')).toEqual([{ term: '猫', reading: undefined, meaning: undefined }, { term: '犬', reading: undefined, meaning: undefined }])
  })

  it('parses CSV and skips a header', () => {
    expect(parseVocabulary('单词,读音,释义\n食べる,たべる,吃')).toEqual([{ term: '食べる', reading: 'たべる', meaning: '吃' }])
  })

  it('parses supported JSON aliases', () => {
    expect(parseVocabulary('[{"word":"図書館","kana":"としょかん","definition":"图书馆"}]')[0]).toEqual({ term: '図書館', reading: 'としょかん', meaning: '图书馆' })
  })
})

describe('Japanese pronunciation helpers', () => {
  it('normalizes katakana and punctuation', () => {
    expect(normalizeJapanese(' ベンキョウ。')).toBe('べんきょう')
  })

  it('converts katakana to hiragana', () => {
    expect(toHiragana('トショカン')).toBe('としょかん')
  })

  it('calculates edit distance', () => {
    expect(levenshtein('ねこ', 'ねご')).toBe(1)
  })

  it('gives a perfect score for matching kana', () => {
    const word = makeFallbackWord({ term: '猫', reading: 'ねこ', meaning: '猫' })
    expect(pronunciationScore('ねこ。', word)).toBe(100)
  })

  it('uses the built-in fallback lexicon', () => {
    const word = makeFallbackWord({ term: '水' })
    expect(word.reading).toBe('みず')
    expect(word.example).toContain('水')
  })
})
