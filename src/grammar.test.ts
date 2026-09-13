import { describe, expect, it } from 'vitest'
import { countGrammarQuestions, flattenGrammarPoints, parseGrammarMarkdown } from './grammar'
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
})
