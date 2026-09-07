import { describe, expect, it } from 'vitest'
import { formatReviewTime, getReviewState, levenshtein, makeFallbackWord, matchesTypingAnswer, normalizeJapanese, parseVocabulary, pronunciationScore, scheduleReview, toHiragana } from './utils'

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

describe('spaced review scheduling', () => {
  const baseWord = { term: '水', reading: 'みず', mastered: true, reviewStage: 0 } as any

  it('starts never-scheduled words on the 1-day interval', () => {
    const now = new Date('2026-09-08T00:00:00Z').getTime()
    const result = scheduleReview(baseWord, true, now)
    expect(result.reviewStage).toBe(0)
    expect(result.nextReviewAt).toBe(now + 1 * 24 * 60 * 60 * 1000)
  })

  it('advances remembered words through Ebbinghaus-style intervals', () => {
    const now = new Date('2026-09-08T00:00:00Z').getTime()
    const result = scheduleReview({ ...baseWord, lastReviewedAt: now - 1000, nextReviewAt: now }, true, now)
    expect(result.reviewStage).toBe(1)
    expect(result.nextReviewAt).toBe(now + 2 * 24 * 60 * 60 * 1000)
  })

  it('resets forgotten words for a short retry', () => {
    const now = 1000
    expect(scheduleReview({ ...baseWord, reviewStage: 4 }, false, now)).toMatchObject({ reviewStage: 0, nextReviewAt: now + 10 * 60 * 1000 })
  })

  it('treats legacy mastered words as due now', () => {
    expect(getReviewState(baseWord, 1000).due).toBe(true)
    expect(formatReviewTime(baseWord, 1000)).toBe('现在应复习')
  })
})

describe('typing practice', () => {
  const word = makeFallbackWord({ term: '勉強', reading: 'べんきょう', meaning: '学习' })

  it('accepts the current term or its kana reading', () => {
    expect(matchesTypingAnswer('勉強', word)).toBe(true)
    expect(matchesTypingAnswer('べんきょう。', word)).toBe(true)
  })

  it('rejects a different word and empty input', () => {
    expect(matchesTypingAnswer('水', word)).toBe(false)
    expect(matchesTypingAnswer('  ', word)).toBe(false)
  })
})
