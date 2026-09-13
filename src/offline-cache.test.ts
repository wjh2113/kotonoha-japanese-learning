import { beforeEach, describe, expect, it } from 'vitest'
import { loadPassagesBundle, loadVocabState, savePassagesBundle, saveVocabState } from './offline-cache'
import type { AppSettings, Passage, Unit } from './types'

const settings: AppSettings = {
  displayName: '测试',
  avatar: '語',
  voiceGender: 'female',
  theme: 'matcha',
  streakDays: 1,
  lastStudyDate: '2026-09-13',
}

const unit: Unit = {
  id: 'u1',
  name: '第1课',
  description: '测试',
  color: '#668b87',
  words: [{
    id: 'w1',
    term: 'こんにちは',
    reading: 'こんにちは',
    meaning: '你好',
    example: 'こんにちは。',
    exampleMeaning: '你好。',
  }],
}

const passage: Passage = {
  id: 'p1',
  title: '课文1',
  sourceText: 'こんにちは。',
  createdAt: Date.now(),
  bookId: 'b1',
  bookName: '课本',
  lessonId: 'l1',
  lessonName: '第001课',
  sentences: [{ id: 's1', text: 'こんにちは。', reading: 'こんにちは。', meaning: '你好。' }],
}

describe('offline-cache', () => {
  beforeEach(async () => {
    // Clear IndexedDB between tests when available (jsdom may lack it).
    if (typeof indexedDB === 'undefined') return
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('kotonoha-offline-v1')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })
  })

  it('saves and loads vocab snapshot', async () => {
    if (typeof indexedDB === 'undefined') return
    await saveVocabState([unit], settings)
    const loaded = await loadVocabState()
    expect(loaded?.units[0]?.words[0]?.term).toBe('こんにちは')
    expect(loaded?.settings.theme).toBe('matcha')
  })

  it('saves and loads passages with sentences for offline TTS', async () => {
    if (typeof indexedDB === 'undefined') return
    await savePassagesBundle([passage], [{ id: 'b1', name: '课本' }], [{ id: 'l1', bookId: 'b1', name: '第001课' }])
    const loaded = await loadPassagesBundle()
    expect(loaded?.passages[0]?.sentences[0]?.text).toBe('こんにちは。')
  })
})
