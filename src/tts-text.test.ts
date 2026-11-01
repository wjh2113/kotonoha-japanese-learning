import { describe, expect, it } from 'vitest'
import { expandFuriganaForTts, spokenJapanese, spokenLexeme, stripDialogueSpeakerPrefix } from './tts-text'

describe('spokenJapanese', () => {
  it('replaces annotated kanji with kana', () => {
    expect(expandFuriganaForTts('店員（てんいん）：いらっしゃいませ。')).toBe('てんいん：いらっしゃいませ。')
  })

  it('strips dialogue speaker labels before TTS', () => {
    expect(stripDialogueSpeakerPrefix('佐藤：はい。東京大学の佐藤です。')).toBe('はい。東京大学の佐藤です。')
    expect(stripDialogueSpeakerPrefix('佐藤（さとう）：はい。')).toBe('はい。')
    expect(stripDialogueSpeakerPrefix('りん：こちらこそ。')).toBe('こちらこそ。')
  })

  it('reads dialogue body once when speaker name also appears in the line', () => {
    const spoken = spokenJapanese({
      text: '佐藤：はい。東京大学の佐藤です。どうぞよろしくおねがいします。',
      reading: '佐藤（さとう）：はい。東京大学（とうきょうだいがく）の佐藤（さとう）です。どうぞよろしくおねがいします。',
    })
    expect(spoken.startsWith('さとう')).toBe(false)
    expect(spoken.match(/さとう/g)).toEqual(['さとう'])
    expect(spoken).toBe('はい。とうきょうだいがくのさとうです。どうぞよろしくおねがいします。')
  })

  it('builds a sentence from token readings without speaking the speaker label', () => {
    expect(spokenJapanese({
      text: '店員：いらっしゃいませ。',
      tokens: [
        { surface: '店員', reading: 'てんいん' },
        { surface: '：' },
        { surface: 'いらっしゃいませ。' },
      ],
    })).toBe('いらっしゃいませ。')
  })

  it('uses word reading instead of kanji', () => {
    expect(spokenLexeme('電子辞書', 'でんしじしょ')).toBe('でんしじしょ')
    expect(spokenLexeme('電子辞書', 'デンシジショ')).toBe('でんしじしょ')
  })

  it('still reads names like 山田 in Japanese when they are not a speaker label', () => {
    expect(spokenJapanese({
      text: 'スミスさん、山田さん、今度の日曜日、上野へ行きませんか。',
      tokens: [
        { surface: 'スミスさん、' },
        { surface: '山田' },
        { surface: 'さん、今度の日曜日、上野へ行きませんか。' },
      ],
    })).toBe('スミスさん、やまださん、こんどのにちようび、うえのへいきませんか。')
  })
})
