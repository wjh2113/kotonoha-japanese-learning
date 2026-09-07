// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { docxHtmlToVocabularyText, readVocabularyFile } from './docx'
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

  it('keeps multi-paragraph table cells on one row', () => {
    const html = '<table><tr><td><p>勉強</p></td><td><p>べんきょう</p></td><td><p>学习</p><p>用功</p></td></tr></table>'
    expect(docxHtmlToVocabularyText(html)).toBe('勉強\tべんきょう\t学习 用功')
  })
})
