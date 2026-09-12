import { describe, expect, it } from 'vitest'
import { normalizePassageBooks, prepareUnitWords, validatePassages, validateState } from './database.mjs'

const validState = {
  units: [{ id: 'unit-1', name: '第一单元', words: [{ id: 'word-1', term: '水' }] }],
  settings: { avatar: 'ゆ', voiceGender: 'female' },
}

describe('PostgreSQL state validation', () => {
  it('accepts a normalized application snapshot', () => {
    expect(validateState(validState)).toEqual(validState)
  })

  it('rejects missing settings and invalid units', () => {
    expect(() => validateState({ units: [] })).toThrow('INVALID_STATE')
    expect(() => validateState({ units: [{ id: '', name: '', words: [] }], settings: {} })).toThrow('INVALID_UNIT')
  })

  it('rejects words without stable ids or terms', () => {
    expect(() => validateState({ ...validState, units: [{ id: 'u', name: 'unit', words: [{ id: '', term: '水' }] }] })).toThrow('INVALID_WORD')
  })
})

describe('prepareUnitWords', () => {
  it('keeps same surface form with different readings', () => {
    const { kept, dropped } = prepareUnitWords([
      { id: 'a', term: '日', reading: 'ひ' },
      { id: 'b', term: '日', reading: 'にち' },
    ])
    expect(kept.map((item) => item.reading)).toEqual(['ひ', 'にち'])
    expect(dropped).toEqual([])
  })

  it('dedupes by id and by term+reading, reports drops', () => {
    const { kept, dropped } = prepareUnitWords([
      { id: 'a', term: '水', reading: 'みず' },
      { id: 'a', term: '火', reading: 'ひ' },
      { id: 'b', term: '水', reading: 'みず' },
      { id: 'c', term: '笔记：无法辨认' },
    ])
    expect(kept).toHaveLength(1)
    expect(dropped.map((item) => item.reason).sort()).toEqual(['duplicate_id', 'duplicate_term_reading', 'invalid_term'].sort())
  })
})

describe('passage validation', () => {
  it('accepts a compact textbook snapshot', () => {
    expect(validatePassages({ passages: [{ id: 'p1', title: '第一课', sourceText: '行きます。', sentences: [] }] })).toHaveLength(1)
  })

  it('rejects missing ids and oversized libraries', () => {
    expect(() => validatePassages({ passages: [{ id: '', title: '第一课' }] })).toThrow('INVALID_PASSAGE')
    expect(() => validatePassages({ passages: Array.from({ length: 51 }, (_, index) => ({ id: `p${index}`, title: '课' })) })).toThrow('TOO_MANY_PASSAGES')
  })

  it('keeps textbook groups even when no lesson is assigned yet', () => {
    expect(normalizePassageBooks({
      books: [{ id: 'book-1', name: '大家的日语 第1册' }],
      passages: [{ id: 'p1', title: '第一课' }],
    })).toEqual([{ id: 'book-1', name: '大家的日语 第1册' }])
  })
})
