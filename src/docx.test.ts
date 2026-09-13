// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { docxHtmlToVocabularyText, htmlToPassageText, readVocabularyFile } from './docx'
import { parseVocabulary } from './utils'

describe('Word vocabulary extraction', () => {
  it('extracts vocabulary from Word paragraphs and lists', () => {
    const text = docxHtmlToVocabularyText('<h1>第一单元</h1><p>猫</p><ul><li>犬</li><li>水</li></ul>')
    expect(parseVocabulary(text).map((item) => item.term)).toEqual(['猫', '犬', '水'])
  })

  it('explains how to handle legacy Word files', async () => {
    const file = new File(['legacy'], 'words.doc')
    await expect(readVocabularyFile(file)).rejects.toThrow('另存为')
  })

  it('preserves Word table columns as term, reading and meaning', () => {
    const html = '<table><tr><th><p>单词</p></th><th>读音</th><th>释义</th></tr><tr><td><p>旅行</p></td><td><p>りょこう</p></td><td><p>旅行</p></td></tr></table>'
    expect(parseVocabulary(docxHtmlToVocabularyText(html))).toEqual([{ term: '旅行', reading: 'りょこう', meaning: '旅行' }])
  })

  it('reads the Excel vocabulary handbook template', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const bytes = readFileSync(resolve(process.cwd(), 'public/templates/词汇导入模版.xlsx'))
    const file = new File([bytes], '词汇导入模版.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const text = await readVocabularyFile(file)
    const drafts = parseVocabulary(text)
    expect(drafts.length).toBeGreaterThanOrEqual(2)
    expect(drafts[0]).toMatchObject({
      term: 'ありがとうございます',
      reading: 'ありがとうございます',
      meaning: '谢谢',
      translation: '谢谢。',
      partOfSpeech: '[惯]',
    })
  })
})

describe('Word passage extraction', () => {
  it('keeps textbook paragraphs and headings as readable text', () => {
    const html = '<h1>第一課</h1><p>昨日、学校で日本語を勉強しました。</p><p>とても楽しかったです。</p>'
    expect(htmlToPassageText(html)).toBe('第一課\n昨日、学校で日本語を勉強しました。\nとても楽しかったです。')
  })

  it('flattens Word tables into sentences instead of vocabulary columns', () => {
    const html = '<table><tr><td>田中さんは</td><td>学生です。</td></tr></table>'
    expect(htmlToPassageText(html)).toBe('田中さんは 学生です。')
  })
})
