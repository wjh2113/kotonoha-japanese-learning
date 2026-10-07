// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { docxHtmlToVocabularyText, htmlToPassageText, readPassageSource, readVocabularyFile } from './docx'
import { parseVocabulary, parseVocabularyHandbook } from './utils'

describe('Word vocabulary extraction', () => {
  it('extracts vocabulary from Word paragraphs and lists', () => {
    const text = docxHtmlToVocabularyText('<h1>第一单元</h1><p>猫</p><ul><li>犬</li><li>水</li></ul>')
    expect(parseVocabulary(text).map((item) => item.term)).toEqual(['猫', '犬', '水'])
  })

  it('rejects non-Excel vocabulary uploads', async () => {
    const file = new File(['legacy'], 'words.doc')
    await expect(readVocabularyFile(file)).rejects.toThrow('词汇手册')
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
    const drafts = parseVocabularyHandbook(text)
    expect(drafts.length).toBeGreaterThanOrEqual(2)
    expect(drafts[0]).toMatchObject({
      term: 'ありがとうございます',
      reading: 'ありがとうございます',
      meaning: '谢谢',
      translation: '谢谢。',
      partOfSpeech: '[惯]',
    })
  })

  it('rejects passage non-markdown uploads', async () => {
    await expect(readPassageSource(new File(['x'], 'a.txt'))).rejects.toThrow('.md')
  })

  it('merges a lesson zip with 课文 md + 单词 tsv-as-md + 语法 md', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const { splitLessonHandbook } = await import('./passage')
    const passage = [
      '# 【课文整理】第011课',
      '',
      '## 课文1：测试',
      '',
      '| 原文 | 假名注音 | 中文解释 |',
      '| --- | --- | --- |',
      '| 私は学生です。 | 私（わたし）は学生（がくせい）です。 | 我是学生。 |',
      '',
      '**语法考点**',
      '',
      '- ～は～です：名词谓语句',
    ].join('\n')
    const vocab = [
      '| 序号 | 单词 | 假名 | 词性 | 中文释义 | 罗马音 | 例句 | 例句译文 | 发音注意事项 | 记忆技巧 | 同义词 | 形近词 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 私 | わたし | 代词 | 我 | watashi | 私は学生です。 | 我是学生。 | は读wa | 主题是我 |  |  |',
    ].join('\n')
    const grammar = [
      '# 第011课 です',
      '',
      '## 第 1 部分　谓语句',
      '',
      '## ① 名词谓语句',
      '',
      '**句型公式**',
      '',
      '- ［名1］は［名2］です',
      '',
      '**例句**',
      '',
      '- 私は学生です。—— 我是学生。',
      '',
      '**⚠️ 注意**',
      '',
      '- は读 wa',
      '',
      '### 测验（1题）',
      '',
      '**Q1.** 助词は怎么读？',
      '',
      '- A. は',
      '- B. わ',
      '- C. ば',
      '- D. ぱ',
      '',
      '| 题号 | 答案 | 解析 |',
      '| --- | --- | --- |',
      '| 1 | B | 提示主题的は读わ |',
    ].join('\n')
    const zipped = zipSync({
      '第011课/课文.md': strToU8(passage),
      '第011课/单词.md': strToU8(vocab),
      '第011课/语法.md': strToU8(grammar),
    })
    const file = new File([zipped], '第011课.zip', { type: 'application/zip' })
    const source = await readPassageSource(file)
    const parts = splitLessonHandbook(source.text)
    expect(parts.passageMarkdown).toContain('私は学生です')
    expect(parts.vocabMarkdown).toContain('わたし')
    expect(parts.grammarMarkdown).toContain('名词谓语句')
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
