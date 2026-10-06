import { describe, expect, it } from 'vitest'
import { expandFuriganaForTts, spokenJapanese, spokenLexeme } from './tts-text'

describe('spokenJapanese', () => {
  it('replaces annotated kanji with kana', () => {
    expect(expandFuriganaForTts('店員（てんいん）：いらっしゃいませ。')).toBe('てんいん：いらっしゃいませ。')
  })

  it('builds a sentence from token readings', () => {
    expect(spokenJapanese({
      text: '店員：いらっしゃいませ。',
      tokens: [
        { surface: '店員', reading: 'てんいん' },
        { surface: '：' },
        { surface: 'いらっしゃいませ。' },
      ],
    })).toBe('てんいん：いらっしゃいませ。')
  })

  it('uses word reading instead of kanji', () => {
    expect(spokenLexeme('電子辞書', 'でんしじしょ')).toBe('でんしじしょ')
    expect(spokenLexeme('電子辞書', 'デンシジショ')).toBe('でんしじしょ')
  })

  it('reads speaker names like 山田 in Japanese even without ruby', () => {
    expect(spokenJapanese({
      text: '山田：スミスさん、今度の日曜日、上野へ行きませんか。',
      tokens: [
        { surface: '山田' },
        { surface: '：' },
        { surface: 'スミスさん、今度の日曜日、上野へ行きませんか。' },
      ],
    })).toBe('やまだ：スミスさん、こんどのにちようび、うえのへいきませんか。')
  })
})
