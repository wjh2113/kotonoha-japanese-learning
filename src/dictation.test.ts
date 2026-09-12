import { describe, expect, it } from 'vitest'
import {
  clampDictationGoal, compactKana, dictationGap, katakanaDiff, matchesKatakanaAnswer,
  pickDictationWords, reinsertAfterMiss, removeCurrent, toKatakana, wordKatakana,
} from './dictation'
import { makeFallbackWord } from './utils'

describe('kana conversion for dictation', () => {
  it('turns hiragana readings into katakana', () => {
    expect(toKatakana('べんきょう')).toBe('ベンキョウ')
    expect(wordKatakana(makeFallbackWord({ term: '勉強', reading: 'べんきょう', meaning: '学习' }))).toBe('ベンキョウ')
  })

  it('accepts hiragana or katakana of the reading', () => {
    const word = makeFallbackWord({ term: '水', reading: 'みず', meaning: '水' })
    expect(matchesKatakanaAnswer('ミズ', word)).toBe(true)
    expect(matchesKatakanaAnswer('みず', word)).toBe(true)
    expect(matchesKatakanaAnswer('水', word)).toBe(false)
    expect(matchesKatakanaAnswer('ミズウ', word)).toBe(false)
  })

  it('marks mistyped katakana in red-style diffs', () => {
    expect(katakanaDiff('ペラミ', 'セラミ')).toEqual([
      { char: 'ペ', ok: false },
      { char: 'ラ', ok: true },
      { char: 'ミ', ok: true },
    ])
  })

  it('compacts punctuation before comparing', () => {
    expect(compactKana(' ミズ。')).toBe('ミズ')
  })
})

describe('in-round wrong-word spacing', () => {
  it('puts a first miss two cards later', () => {
    expect(dictationGap(1)).toBe(2)
    expect(reinsertAfterMiss(['a', 'b', 'c', 'd', 'e'], 0, 2)).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('spaces repeated misses further back', () => {
    expect(dictationGap(2)).toBe(5)
    expect(dictationGap(3)).toBe(8)
  })

  it('drops a correctly written card from the remaining queue', () => {
    expect(removeCurrent(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
})

describe('today plan picking', () => {
  it('clamps the daily goal', () => {
    expect(clampDictationGoal(1)).toBe(5)
    expect(clampDictationGoal(20)).toBe(20)
    expect(clampDictationGoal(999)).toBe(200)
  })

  it('prefers unmastered words that are not yet finished today', () => {
    const fresh = makeFallbackWord({ term: '猫', reading: 'ねこ', meaning: '猫' })
    const mastered = { ...makeFallbackWord({ term: '犬', reading: 'いぬ', meaning: '狗' }), mastered: true }
    const done = makeFallbackWord({ term: '水', reading: 'みず', meaning: '水' })
    expect(pickDictationWords([mastered, done, fresh], 5, [done.id]).map((word) => word.term)).toEqual(['猫', '犬'])
  })
})
