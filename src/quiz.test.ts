import { describe, expect, it } from 'vitest'
import { buildQuizOptions, isPlaceholderMeaning, usableQuizWords } from './quiz'
import { makeFallbackWord } from './utils'

describe('quiz meaning filters', () => {
  it('treats empty and unknown placeholders as unusable', () => {
    expect(isPlaceholderMeaning('')).toBe(true)
    expect(isPlaceholderMeaning('待补充释义')).toBe(true)
    expect(isPlaceholderMeaning('未知')).toBe(true)
    expect(isPlaceholderMeaning('图书馆')).toBe(false)
  })

  it('keeps one word per distinct meaning and drops placeholders', () => {
    const words = [
      makeFallbackWord({ term: '図書館', meaning: '图书馆' }),
      makeFallbackWord({ term: '学校', meaning: '学校' }),
      makeFallbackWord({ term: '未知語' }),
      makeFallbackWord({ term: '図書館2', meaning: '图书馆' }),
    ]
    expect(usableQuizWords(words).map((word) => word.term)).toEqual(['図書館', '学校'])
  })

  it('never puts placeholder copy into quiz options', () => {
    const current = makeFallbackWord({ term: '水', meaning: '水' })
    const pool = [
      current,
      makeFallbackWord({ term: '謎' }),
      makeFallbackWord({ term: '未知', meaning: '未知' }),
      makeFallbackWord({ term: '猫', meaning: '猫' }),
      makeFallbackWord({ term: '犬', meaning: '狗' }),
      makeFallbackWord({ term: '行く', meaning: '去' }),
    ]
    const options = buildQuizOptions(current, pool)
    expect(options.some((word) => word.id === current.id)).toBe(true)
    expect(options.every((word) => !isPlaceholderMeaning(word.meaning))).toBe(true)
    expect(new Set(options.map((word) => word.meaning.trim())).size).toBe(options.length)
  })
})
