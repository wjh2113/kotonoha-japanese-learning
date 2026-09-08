import { describe, expect, it } from 'vitest'
import { buildQuizOptions, isPlaceholderMeaning, optionLabel, usableQuizWords } from './quiz'
import { makeFallbackWord } from './utils'

describe('quiz meaning filters', () => {
  it('treats empty, unknown and romaji as unusable Chinese glosses', () => {
    expect(isPlaceholderMeaning('')).toBe(true)
    expect(isPlaceholderMeaning('待补充释义')).toBe(true)
    expect(isPlaceholderMeaning('未知')).toBe(true)
    expect(isPlaceholderMeaning('okiru')).toBe(true)
    expect(isPlaceholderMeaning('shimbun')).toBe(true)
    expect(isPlaceholderMeaning('图书馆')).toBe(false)
  })

  it('includes every word that already has a real gloss', () => {
    const words = [
      makeFallbackWord({ term: '図書館', meaning: '图书馆' }),
      makeFallbackWord({ term: '学校', meaning: '学校' }),
      makeFallbackWord({ term: '未知語' }),
      makeFallbackWord({ term: '図書室', meaning: '图书馆' }),
    ]
    expect(usableQuizWords(words, 'meaning').map((word) => word.term)).toEqual(['図書館', '学校', '図書室'])
  })

  it('never puts romaji or placeholders into meaning options', () => {
    const current = makeFallbackWord({ term: '新聞', meaning: '报纸' })
    const pool = [
      current,
      makeFallbackWord({ term: '町', meaning: 'machi' }),
      makeFallbackWord({ term: '起きる', meaning: 'okiru' }),
      makeFallbackWord({ term: '猫', meaning: '猫' }),
      makeFallbackWord({ term: '犬', meaning: '狗' }),
      makeFallbackWord({ term: '行く', meaning: '去' }),
    ]
    const options = buildQuizOptions(current, pool, [], 'meaning')
    expect(options.some((word) => word.id === current.id)).toBe(true)
    expect(options.map((word) => optionLabel(word, 'meaning'))).not.toEqual(expect.arrayContaining(['machi', 'okiru']))
    expect(options.every((word) => !isPlaceholderMeaning(word.meaning))).toBe(true)
  })

  it('uses Japanese words as listening options', () => {
    const current = makeFallbackWord({ term: '新聞', meaning: '报纸' })
    const pool = [
      current,
      makeFallbackWord({ term: '学校', meaning: '学校' }),
      makeFallbackWord({ term: '友達', meaning: '朋友' }),
      makeFallbackWord({ term: '水', meaning: '水' }),
    ]
    const options = buildQuizOptions(current, pool, [], 'listening')
    expect(options.map((word) => optionLabel(word, 'listening')).sort()).toEqual(['友達', '新聞', '学校', '水'].sort())
    expect(options.every((word) => !/okiru|machi/.test(optionLabel(word, 'listening')))).toBe(true)
  })
})
