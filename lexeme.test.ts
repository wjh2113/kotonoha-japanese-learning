import { describe, expect, it } from 'vitest'
import { extractImportDrafts, extractUploadedLexeme, isChineseGloss, looksLikeVocabularyTerm, normalizeImportDrafts } from './src/lexeme'

describe('extractUploadedLexeme', () => {
  it('keeps a short vocabulary term', () => {
    expect(extractUploadedLexeme('図書館', 'としょかん')).toMatchObject({
      term: '図書館',
      reading: 'としょかん',
      cleaned: false,
    })
  })

  it('pulls 降る out of an OCR annotation line', () => {
    expect(extractUploadedLexeme(
      '・✍️ 笔记：手写批注：降る（ふる）、雨が降る（「雨が降る」下方有红色下划线）。',
      '・✍️ 笔记：手写批注：降る（ふる）、雨が降る（「雨が降る」下方有红色下划线）。',
    )).toMatchObject({ term: '降る', reading: 'ふる', cleaned: true })
  })

  it('pulls the headword out of a numbered definition', () => {
    expect(extractUploadedLexeme(
      '1. 晩（ばん）：晚、傍晚、晚上。多用于复合词',
      '单独使用较少。常见搭配：晩ご飯',
    )).toMatchObject({ term: '晩', reading: 'ばん', meaning: '晚、傍晚、晚上', cleaned: true })
  })

  it('splits 嬉しい（うれしい）', () => {
    expect(extractUploadedLexeme('嬉しい（うれしい）', '楽しい（たのしい）')).toMatchObject({
      term: '嬉しい',
      reading: 'うれしい',
    })
  })
})

describe('extractImportDrafts', () => {
  it('turns a margin note into real vocabulary cards', () => {
    expect(extractImportDrafts(
      '・✍️ 笔记：手写批注：ご飯（ごはん）；虚线框内：朝ごはん／昼ごはん／晩ごはん。',
    ).map((item) => item.term)).toEqual(['ご飯'])
  })

  it('keeps seasons from a handwritten table note', () => {
    expect(extractImportDrafts(
      '・✍️ 笔记：「冬」表上方手写批注：春（はる）／夏（なつ）／秋（あき）、休み（やすみ）。',
    ).map((item) => item.term)).toEqual(['春', '夏', '秋', '休み', '冬'])
  })

  it('drops leftover English or Chinese commentary', () => {
    expect(extractImportDrafts('右侧红色标注补充')).toEqual([])
    expect(looksLikeVocabularyTerm('・✍️ 笔记：手写批注：降る（ふる）')).toBe(false)
  })
})

describe('normalizeImportDrafts', () => {
  it('filters notes and deduplicates extracted words', () => {
    const drafts = normalizeImportDrafts([
      { term: '猫' },
      { term: '・✍️ 笔记：手写批注：降る（ふる）、雨が降る（「雨が降る」下方有红色下划线）。' },
      { term: '降る', reading: 'ふる' },
    ])
    expect(drafts.map((item) => item.term)).toEqual(['猫', '降る'])
  })
})

describe('isChineseGloss', () => {
  it('rejects romaji and accepts short Chinese glosses', () => {
    expect(isChineseGloss('okiru')).toBe(false)
    expect(isChineseGloss('pan')).toBe(false)
    expect(isChineseGloss('报纸')).toBe(true)
    expect(isChineseGloss('下（雨、雪等）')).toBe(true)
  })
})
