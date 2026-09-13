import { describe, expect, it } from 'vitest'
import { chunkItems, extractPassageVocab, unusedPassageVocab, isTransientPassage, listPassageBooks, mergeAnalyzedSentences, MAX_PASSAGES, PASSAGE_ANALYZE_CHUNK, PASSAGE_ANALYZE_CONCURRENCY, passageNeedsAnalysis, passageProgressSummary, parsePassageHandbook, parsePassageTable, recordSentenceScore, recoverInterruptedIngest } from './passage'
import type { Passage } from './types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('parsePassageTable', () => {
  it('uses larger analyze chunks with limited concurrency', () => {
    expect(PASSAGE_ANALYZE_CHUNK).toBeGreaterThanOrEqual(4)
    expect(PASSAGE_ANALYZE_CONCURRENCY).toBeGreaterThanOrEqual(2)
    expect(MAX_PASSAGES).toBe(50)
    expect(chunkItems([1, 2, 3, 4, 5, 6, 7], 6)).toEqual([[1, 2, 3, 4, 5, 6], [7]])
  })
  it('parses 原文/中文解释/语法考点 rows with a header', () => {
    const table = [
      '原文\t中文解释\t语法考点',
      '学校で友達に会いました。\t在学校遇见了朋友。\t',
      'とても嬉しかったです。\t非常开心。\t',
      '【语法】〜たい：表示愿望',
      '駅へ行きます。\t去车站。\t〜へ：表示移动方向',
    ].join('\n')
    const parsed = parsePassageTable(table)
    expect(parsed).not.toBeNull()
    expect(parsed!.sentences.map((s) => s.text)).toEqual(['学校で友達に会いました。', 'とても嬉しかったです。', '駅へ行きます。'])
    expect(parsed!.sentences[0].translation).toBe('在学校遇见了朋友。')
    // 段落后的语法行挂到该段最后一句
    expect(parsed!.sentences[1].grammar[0]).toMatchObject({ name: '〜たい', explanation: '表示愿望' })
    // 行内语法列挂到当前句
    expect(parsed!.sentences[2].grammar[0]).toMatchObject({ name: '〜へ', explanation: '表示移动方向' })
    expect(parsed!.sourceText).toBe('学校で友達に会いました。\nとても嬉しかったです。\n駅へ行きます。')
  })

  it('parses markdown pipe tables', () => {
    const md = [
      '| 原文 | 中文解释 |',
      '| --- | --- |',
      '| 店員：いらっしゃいませ。 | 店员：欢迎光临。 |',
    ].join('\n')
    const parsed = parsePassageTable(md)
    expect(parsed!.sentences[0]).toMatchObject({
      text: '店員：いらっしゃいませ。',
      translation: '店员：欢迎光临。',
    })
  })

  it('parses without a header positionally', () => {
    const parsed = parsePassageTable('桜が咲きました。\t樱花开了。')
    expect(parsed!.sentences[0]).toMatchObject({ text: '桜が咲きました。', translation: '樱花开了。' })
  })

  it('returns null for plain prose (no table)', () => {
    expect(parsePassageTable('昨日、学校で日本語を勉強しました。\nとても楽しかったです。')).toBeNull()
  })

  it('returns null when no translation column has Chinese', () => {
    expect(parsePassageTable('桜が咲きました。\tsakura ga sakimashita')).toBeNull()
  })
})

describe('parsePassageHandbook', () => {
  it('splits 课文整理 markdown into multiple lessons with furigana', () => {
    const md = readFileSync(resolve(process.cwd(), 'public/templates/课文导入模版.md'), 'utf8')
    const parsed = parsePassageHandbook(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.documentTitle).toMatch(/第007课/)
    expect(parsed!.lessons).toHaveLength(3)
    expect(parsed!.lessons[0].title).toMatch(/课文1/)
    expect(parsed!.lessons[0].sentences.length).toBeGreaterThanOrEqual(3)
    expect(parsed!.lessons[0].sentences[0]).toMatchObject({
      text: 'リン：あのう、私はリンです。佐藤さんですか。',
    })
    expect(parsed!.lessons[0].sentences[0].reading).toContain('わたし')
    expect(parsed!.lessons[0].sentences[0].translation).toMatch(/佐藤/)
    expect(parsed!.lessons[0].sentences[0].tokens.some((token) => token.surface === '私' && token.reading === 'わたし')).toBe(true)
    expect(parsed!.lessons[0].sentences.at(-1)!.grammar.length).toBeGreaterThanOrEqual(1)
    expect(parsed!.lessons[1].title).toMatch(/课文2/)
    expect(parsed!.lessons[2].sentences.length).toBeGreaterThanOrEqual(4)
  })
})

describe('furigana column', () => {
  it('parses 假名注音 and derives tokens from 漢字（かな）', async () => {
    const { tokensFromAnnotatedReading, sentenceNeedsAnalysis } = await import('./passage')
    const md = [
      '| 原文 | 假名注音 | 中文解释 |',
      '| --- | --- | --- |',
      '| 私は学生です。 | 私（わたし）は学生（がくせい）です。 | 我是学生。 |',
    ].join('\n')
    const parsed = parsePassageTable(md)
    expect(parsed!.sentences[0].reading).toBe('私（わたし）は学生（がくせい）です。')
    expect(sentenceNeedsAnalysis(parsed!.sentences[0])).toBe(false)
    expect(tokensFromAnnotatedReading('私（わたし）は学生（がくせい）です。').map((t) => t.surface)).toEqual([
      '私', 'は', '学生', 'です',
    ])
    expect(tokensFromAnnotatedReading('りん：あのう、私（わたし）はりんです。佐藤（さとう）さんですか。').some((t) => (
      t.surface === '私' && t.reading === 'わたし'
    ))).toBe(true)
  })
})

const passage: Passage = {
  id: 'p1',
  title: '第一课',
  sourceText: '学校で友達に会いました。',
  createdAt: 1,
  bookId: 'book-1',
  bookName: '大家的日语 第1册',
  sentences: [{
    id: 's1',
    text: '学校で友達に会いました。',
    reading: '',
    translation: '在学校遇见了朋友。',
    tokens: [
      { surface: '学校', reading: 'がっこう', meaning: '学校' },
      { surface: 'で', reading: 'で', meaning: '在' },
      { surface: '友達', reading: 'ともだち', meaning: '朋友' },
      { surface: 'に', reading: 'に', meaning: '向' },
      { surface: '会いました', reading: 'あいました', meaning: '遇见了' },
    ],
    grammar: [],
  }],
}

describe('extractPassageVocab', () => {
  it('turns content words into drafts and skips particles', () => {
    expect(extractPassageVocab(passage).map((item) => item.term)).toEqual(['学校', '友達', '会いました'])
  })

  it('skips terms already in the target unit', () => {
    expect(unusedPassageVocab(passage, ['学校']).map((item) => item.term)).toEqual(['友達', '会いました'])
  })
})

describe('passage progress and books', () => {
  it('records best score without lowering a previous high', () => {
    const first = recordSentenceScore({}, 's1', 60)
    const second = recordSentenceScore(first, 's1', 88)
    const third = recordSentenceScore(second, 's1', 70)
    expect(third.s1).toEqual({ attempts: 3, lastScore: 70, bestScore: 88 })
  })

  it('summarizes practiced sentences', () => {
    const next = { ...passage, progress: recordSentenceScore({}, 's1', 80) }
    expect(passageProgressSummary(next)).toEqual({ total: 1, practiced: 1, average: 80 })
  })

  it('lists unique textbooks from passage book fields', () => {
    expect(listPassageBooks([passage, { ...passage, id: 'p2' }])).toEqual([
      { id: 'book-1', name: '大家的日语 第1册' },
    ])
  })
})

describe('mergeAnalyzedSentences', () => {
  it('fills Chinese translations onto the original sentence ids', () => {
    const stub = {
      ...passage,
      sentences: [{ ...passage.sentences[0], translation: '', tokens: [] }],
    }
    const merged = mergeAnalyzedSentences(stub.sentences, [{
      text: '学校で友達に会いました。',
      translation: '在学校遇见了朋友。',
      tokens: [{ surface: '学校', reading: 'がっこう', meaning: '学校' }],
    }])
    expect(merged[0].id).toBe('s1')
    expect(merged[0].translation).toBe('在学校遇见了朋友。')
    expect(merged[0].tokens[0].surface).toBe('学校')
  })

  it('does not shift analysis onto unrelated Chinese notes', () => {
    const current = [
      { id: '1', text: '会話', reading: '', translation: '', tokens: [], grammar: [] },
      { id: '2', text: '能够向店员询问商品，并能请店员帮助寻找其他商品。', reading: '', translation: '', tokens: [], grammar: [] },
      { id: '3', text: 'てんいん', reading: '', translation: '', tokens: [], grammar: [] },
    ]
    const merged = mergeAnalyzedSentences(current, [
      { text: '会話', reading: 'かいわ', translation: '会话。', tokens: [{ surface: '会話', reading: 'かいわ', meaning: '会话' }] },
      { text: 'てんいん', reading: 'てんいん', translation: '店员。', tokens: [{ surface: 'てんいん', reading: 'てんいん', meaning: '店员' }] },
    ])
    expect(merged[0].translation).toBe('会话。')
    expect(merged[1].translation).toBe('')
    expect(merged[1].reading).toBe('')
    expect(merged[2].translation).toBe('店员。')
    expect(merged[2].reading).toBe('てんいん')
  })
})

describe('interrupted passage ingest', () => {
  it('does not treat OCR placeholders as analyzable sentences', () => {
    expect(isTransientPassage({
      status: 'processing',
      sourceText: '（正在识别课文…）',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })).toBe(true)
    expect(passageNeedsAnalysis({
      ...passage,
      status: 'processing',
      sourceText: '（正在识别课文…）',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })).toBe(false)
  })

  it('turns leftover OCR stubs into a retryable error instead of keeping them processing', () => {
    const recovered = recoverInterruptedIngest({
      ...passage,
      title: '<html><head><title>502 Bad Gateway</title></head></html>',
      sourceText: '（正在识别课文…）',
      status: 'processing',
      statusText: '<html>502 Bad Gateway</html>',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })
    expect(recovered.title).toBe('课文')
    expect(recovered.sourceText).toBe('')
    expect(recovered.sentences).toEqual([])
    expect(recovered.status).toBe('error')
    expect(recovered.statusText).toContain('重新上传')
  })
})

describe('grammar highlight', () => {
  it('marks grammar examples and particles inside the source line', async () => {
    const { grammarHighlightTerms, highlightGrammarInText } = await import('./passage')
    const terms = grammarHighlightTerms([
      { name: '～は～です', explanation: '私はリンです——名词谓语句表判断' },
      { name: '～ですか', explanation: '佐藤さんですか——句末加疑问助词か' },
      { name: '寒暄套话', explanation: 'どうぞよろしくおねがいします（请多关照）／こちらこそ（我才是）' },
    ])
    expect(terms).toEqual(expect.arrayContaining(['私はリンです', 'ですか', 'は', 'です', 'どうぞよろしくおねがいします', 'こちらこそ']))
    const parts = highlightGrammarInText('リン：あのう、私はリンです。佐藤さんですか。', terms)
    const hits = parts.filter((part) => part.hit).map((part) => part.text)
    expect(hits.join('')).toContain('私はリンです')
    expect(hits.some((item) => item.includes('ですか') || item === 'ですか')).toBe(true)
  })
})

describe('chinese instructional lines in OCR', () => {
  it('skips primarily Chinese notes from analysis queue', async () => {
    const { isPrimarilyChineseLine, sentenceNeedsAnalysis } = await import('./passage')
    expect(isPrimarilyChineseLine('能够向店员询问商品，并能请店员帮助寻找其他商品。')).toBe(true)
    expect(isPrimarilyChineseLine('てんいん')).toBe(false)
    expect(sentenceNeedsAnalysis({
      id: '1', text: '能够向店员询问商品，并能请店员帮助寻找其他商品。', reading: '', translation: '', tokens: [], grammar: [],
    })).toBe(false)
  })
})
