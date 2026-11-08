import { describe, expect, it } from 'vitest'
import {
  collectGrammarPointSpeakLines,
  countGrammarQuestions,
  flattenGrammarPoints,
  parseGrammarMarkdown,
} from './grammar'
import sample from '../content/grammar/L02_電気屋で.md?raw'

describe('parseGrammarMarkdown', () => {
  it('parses L02 lesson into 2 parts, 8 points and 30 questions', () => {
    const lesson = parseGrammarMarkdown(sample, 'L02_電気屋で.md')
    expect(lesson).not.toBeNull()
    expect(lesson!.title).toContain('電気屋')
    expect(lesson!.course).toBe('TRY! N5')
    expect(lesson!.parts).toHaveLength(2)
    const points = flattenGrammarPoints(lesson!)
    expect(points).toHaveLength(8)
    expect(countGrammarQuestions(lesson!)).toBe(30)
    expect(points[0].title).toMatch(/です/)
    expect(points[0].questions[0].choices.length).toBe(4)
    expect(points[0].questions[0].answer).toBe('B')
    expect(points[0].questions[0].explain).toMatch(/习惯性/)
    expect(points.some((point) => point.blocks.some((block) => block.type === 'table'))).toBe(true)
    expect(points.some((point) => point.blocks.some((block) => block.type === 'examples'))).toBe(true)
  })

  it('returns null for empty content', () => {
    expect(parseGrammarMarkdown('')).toBeNull()
  })

  it('collects title, examples and kana table cells for full-point TTS', () => {
    const point = {
      id: 'p1',
      index: 1,
      title: '量词：枚・台・番・円',
      questions: [],
      blocks: [
        { type: 'section' as const, title: '句型公式', kind: 'formula' as const },
        {
          type: 'table' as const,
          headers: ['量词', '读音', '用于', '示例'],
          rows: [
            ['~枚', 'まい', '薄而平的物品', '紙を一枚 (いちまい)'],
            ['~台', 'だい', '机器车辆', 'パソコンを一台 (いちだい)'],
          ],
        },
        {
          type: 'table' as const,
          headers: ['数字', '~枚', '~台'],
          rows: [
            ['1', 'いちまい', 'いちだい'],
            ['2', 'にまい', 'にだい'],
          ],
        },
        {
          type: 'examples' as const,
          items: [{ jp: 'りんごを一つください。', zh: '请给我一个苹果。' }],
        },
      ],
    }
    const lines = collectGrammarPointSpeakLines(point)
    expect(lines[0]).toBe('量词：枚・台・番・円')
    expect(lines).toContain('まい')
    expect(lines).toContain('紙を一枚 (いちまい)')
    expect(lines).toContain('いちまい')
    expect(lines).toContain('にだい')
    expect(lines).toContain('りんごを一つください。')
    expect(lines.some((line) => line === '句型公式')).toBe(false)
    expect(lines.some((line) => line === '薄而平的物品')).toBe(false)
  })

  it('tolerates section titles with trailing colon and keeps table rows + playable examples', () => {
    const raw = `---
title: 容错语法
course: TEST
unit: 1
lesson: 1
---
# 容错语法
## ① 动词分类判别法
**句型公式**:
| 判别步骤 | 条件 | 判定结果 | 示例 |
| --- | --- | --- | --- |
| 1 看词尾 | 是る | 可能二类 | 食べる |
| 2 看る前 | い段/え段 | 二类动词 | 見る |
| 3 其余 | う段等 | 一类动词 | 作る |
**例句**
- 私は 新しいパソコンが ほしいです。—— 我想要新电脑。
- 私は 子どものとき 自転車が ほしかったです。
**⚠️ 注意**
- 「名词＋が ほしい」只能用于想要某个**物品**
  想做某事要用「たいです」
- 【～が ほしいですか】询问时要慎重
### 测验
**Q1.** 食べる是哪一类？
- A. 一类
- B. 二类
- C. 三类
- D. 形容动词
| 题号 | 答案 | 解析 |
| --- | --- | --- |
| 1 | B | 词尾る且る前是べ（え段） |
`
    const lesson = parseGrammarMarkdown(raw, 'tolerance.md')
    expect(lesson).not.toBeNull()
    const point = flattenGrammarPoints(lesson!)[0]
    const sections = point.blocks.filter((block) => block.type === 'section')
    expect(sections.some((block) => block.type === 'section' && block.title === '句型公式')).toBe(true)
    expect(point.blocks.some((block) => block.type === 'paragraph' && /\*\*句型公式\*\*/.test(block.text))).toBe(false)
    const table = point.blocks.find((block) => block.type === 'table')
    expect(table?.type).toBe('table')
    if (table?.type === 'table') expect(table.rows).toHaveLength(3)
    const examples = point.blocks.find((block) => block.type === 'examples')
    expect(examples?.type).toBe('examples')
    if (examples?.type === 'examples') {
      expect(examples.items).toHaveLength(2)
      expect(examples.items[0].jp).toContain('ほしいです')
      expect(examples.items[0].zh).toContain('新电脑')
      expect(examples.items[1].jp).toContain('ほしかった')
    }
    const notes = point.blocks.find((block) => block.type === 'notes')
    expect(notes?.type).toBe('notes')
    if (notes?.type === 'notes') {
      expect(notes.items).toHaveLength(2)
      expect(notes.items[0]).toContain('たいです')
      expect(notes.items[0]).toContain('**物品**')
    }
    expect(point.questions).toHaveLength(1)
  })
})
