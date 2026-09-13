import { describe, expect, it } from 'vitest'
import { formatReviewTime, getReviewState, levenshtein, makeFallbackWord, matchesTypingAnswer, normalizeJapanese, parseVocabulary, parseVocabularyHandbook, pronunciationScore, pronunciationScoreFor, scheduleReview, splitJapaneseSentences, splitWordList, toHiragana, toRomaji } from './utils'
import { fallbackUnitTheme, isPlaceholderTheme } from './theme'

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

  it('parses an 8-column table with header', () => {
    const table = '单词\t假名\t词性\t中文释义\t罗马音\t例句\t发音注意事项\t记忆技巧\n桜\tさくら\t名词\t樱花\tsakura\t桜が咲きました。\t注意轻音\t“撒库拉”谐音'
    expect(parseVocabulary(table)).toEqual([{
      term: '桜',
      reading: 'さくら',
      partOfSpeech: '名词',
      meaning: '樱花',
      romaji: 'sakura',
      example: '桜が咲きました。',
      pronunciationNote: '注意轻音',
      memoryTip: '“撒库拉”谐音',
    }])
  })

  it('parses vocabulary handbook 12-column template with 序号 and 例句译文', () => {
    const table = [
      '序号\t单词\t假名\t词性\t中文释义\t罗马音\t例句\t例句译文\t发音注意事项\t记忆技巧\t同义词\t形近词',
      '1\tすみません\tすみません\t[惯]\t对不起；劳驾\tsumimasen\tすみません。\t劳驾。\t整体读五拍\t搭话通用\tごめんなさい\t—',
    ].join('\n')
    expect(parseVocabulary(table)[0]).toMatchObject({
      term: 'すみません',
      reading: 'すみません',
      partOfSpeech: '[惯]',
      meaning: '对不起；劳驾',
      romaji: 'sumimasen',
      example: 'すみません。',
      translation: '劳驾。',
      pronunciationNote: '整体读五拍',
      memoryTip: '搭话通用',
      synonyms: 'ごめんなさい',
      similarWords: '—',
    })
    expect(parseVocabularyHandbook(table)[0]).toMatchObject({
      term: 'すみません',
      translation: '劳驾。',
    })
  })

  it('rejects non-handbook formats in strict handbook parser', () => {
    expect(parseVocabularyHandbook('猫\n犬')).toEqual([])
    expect(parseVocabularyHandbook('单词,读音,释义\n食べる,たべる,吃')).toEqual([])
  })

  it('parses handbook rows without header when leading index is present', () => {
    const row = '2\t方\tかた\t[名]\t人（位）\tkata\tあの方は田中先生です。\t那位是田中老师。\t读 かた\t礼貌说法\t人（ひと）\t方向（ほうこう）'
    expect(parseVocabulary(row)[0]).toMatchObject({
      term: '方',
      reading: 'かた',
      meaning: '人（位）',
      translation: '那位是田中老师。',
      similarWords: '方向（ほうこう）',
    })
  })

  it('splits word-list cells into chips', () => {
    expect(splitWordList('櫻花、サクラ，さくら; 桃')).toEqual(['櫻花', 'サクラ', 'さくら', '桃'])
    expect(splitWordList('')).toEqual([])
  })

  it('parses an 8-column table without header positionally', () => {
    const table = '桜\tさくら\t名词\t樱花\tsakura\t桜が咲きました。\t\t'
    expect(parseVocabulary(table)[0]).toMatchObject({
      term: '桜', reading: 'さくら', partOfSpeech: '名词', meaning: '樱花', romaji: 'sakura', example: '桜が咲きました。',
    })
  })

  it('keeps the legacy 3-column mapping', () => {
    expect(parseVocabulary('食べる,たべる,吃')[0]).toEqual({ term: '食べる', reading: 'たべる', meaning: '吃' })
  })

  it('extracts 降る from OCR annotation lines instead of importing the note', () => {
    expect(parseVocabulary('・✍️ 笔记：手写批注：降る（ふる）、雨が降る（「雨が降る」下方有红色下划线）。')).toMatchObject([
      { term: '降る', reading: 'ふる' },
    ])
  })
})

describe('toRomaji', () => {
  it('converts basic hiragana', () => {
    expect(toRomaji('たべる')).toBe('taberu')
    expect(toRomaji('ねこ')).toBe('neko')
  })

  it('converts katakana and long vowels', () => {
    expect(toRomaji('コーヒー')).toBe('koohii')
    expect(toRomaji('ベンキョウ')).toBe('benkyou')
  })

  it('handles combos and sokuon', () => {
    expect(toRomaji('しゃしん')).toBe('shashin')
    expect(toRomaji('がっこう')).toBe('gakkou')
    expect(toRomaji('ちょっと')).toBe('chotto')
  })

  it('returns empty for kanji or empty input', () => {
    expect(toRomaji('食べる')).toBe('')
    expect(toRomaji('')).toBe('')
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

  it('scores sentence shadowing against the original line', () => {
    expect(pronunciationScoreFor('昨日学校へ行きました。', '昨日学校へ行きました。', 'きのうがっこうへいきました')).toBe(100)
    expect(pronunciationScoreFor('きのうがっこうへいきました', '昨日学校へ行きました。', 'きのうがっこうへいきました')).toBe(100)
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

  it('does not treat mastered words without a schedule as due', () => {
    expect(getReviewState(baseWord, 1000).due).toBe(false)
    expect(formatReviewTime(baseWord, 1000)).toBe('尚未进入复习计划')
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

describe('unit theme placeholders', () => {
  it('treats empty and default copy as needing AI summary', () => {
    expect(isPlaceholderTheme('')).toBe(true)
    expect(isPlaceholderTheme('上传词汇后由 AI 自动归纳主题')).toBe(true)
    expect(isPlaceholderTheme('AI 正在根据词汇归纳主题…')).toBe(true)
    expect(isPlaceholderTheme('校园与日常')).toBe(false)
  })

  it('builds a local fallback theme from meanings', () => {
    expect(fallbackUnitTheme('第3单元', [
      { term: '教室', meaning: '教室' },
      { term: '花', meaning: '花' },
    ])).toBe('教室与花')
    expect(fallbackUnitTheme('校园生活', [])).toBe('校园生活')
  })
})

describe('splitJapaneseSentences', () => {
  it('splits textbook Japanese on sentence punctuation', () => {
    expect(splitJapaneseSentences('昨日学校へ行きました。友達に会いました！')).toEqual([
      '昨日学校へ行きました。',
      '友達に会いました！',
    ])
  })

  it('keeps dialogue turns on separate lines', () => {
    expect(splitJapaneseSentences('A: 忙しいですか。\nB: いいえ、忙しくないです。')).toEqual([
      'A: 忙しいですか。',
      'B: いいえ、忙しくないです。',
    ])
  })
})
