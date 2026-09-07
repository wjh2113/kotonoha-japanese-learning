import { describe, expect, it } from 'vitest'
import { validateState } from './database.mjs'

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
