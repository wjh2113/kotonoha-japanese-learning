import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from './database.mjs'

const DATABASE_URL = process.env.DATABASE_URL || process.env.KOTONOHA_TEST_DATABASE_URL || ''
const run = DATABASE_URL ? describe : describe.skip

run('PostgreSQL persist integration', () => {
  /** @type {ReturnType<typeof createDatabase>} */
  let db
  const suffix = `t${Date.now().toString(36)}`
  const unitId = `unit-${suffix}`
  const wordId = `word-${suffix}`
  const passageId = `pass-${suffix}`

  beforeAll(async () => {
    db = createDatabase(DATABASE_URL)
    await db.initialize()
  })

  afterAll(async () => {
    try {
      await db.deleteWord(wordId)
    } catch { /* ignore */ }
    try {
      await db.deletePassage(passageId)
    } catch { /* ignore */ }
    // Clean unit via replaceState orphan delete
    const state = await db.getState()
    await db.replaceState({
      units: state.units.filter((unit) => unit.id !== unitId),
      settings: state.settings,
    })
    await db.close()
  })

  it('upserts word extras without wiping other units', async () => {
    const before = await db.getState()
    const units = [
      ...before.units.filter((unit) => unit.id !== unitId),
      {
        id: unitId,
        name: `Persist ${suffix}`,
        description: '测试',
        color: '#668b87',
        words: [{
          id: wordId,
          term: '水',
          reading: 'みず',
          meaning: '水',
          partOfSpeech: '名词',
          example: '水を飲みます。',
          exampleReading: '',
          translation: '喝水。',
          romaji: 'mizu',
          memoryTip: '记忆测',
          pronunciationNote: '发音测',
          synonyms: '同义',
          similarWords: '形近',
          notes: '备注',
          mastered: false,
          createdAt: Date.now(),
        }],
      },
    ]
    const saved = await db.replaceState({ units, settings: before.settings })
    const word = saved.units.find((unit) => unit.id === unitId)?.words.find((item) => item.id === wordId)
    expect(word).toMatchObject({
      term: '水',
      romaji: 'mizu',
      memoryTip: '记忆测',
      pronunciationNote: '发音测',
      synonyms: '同义',
      similarWords: '形近',
      notes: '备注',
    })
    expect(saved.units.length).toBeGreaterThanOrEqual(before.units.length)

    const patched = await db.patchWord(wordId, { romaji: 'mizu-2', memoryTip: '改' })
    expect(patched.romaji).toBe('mizu-2')
    expect(patched.memoryTip).toBe('改')
    expect(patched.term).toBe('水')
  })

  it('upserts passage and patches progress without full wipe', async () => {
    const before = await db.listPassages()
    await db.upsertPassage({
      id: passageId,
      title: `课 ${suffix}`,
      sourceText: '水です。',
      sentences: [{ id: 's1', text: '水です。', reading: '', translation: '是水。', tokens: [], grammar: [] }],
      bookId: '',
      bookName: '',
      progress: {},
      status: 'ready',
      statusText: '',
      createdAt: Date.now(),
    })
    const patched = await db.patchPassageProgress(passageId, {
      s1: { attempts: 2, lastScore: 90, bestScore: 90 },
    })
    expect(patched?.progress?.s1?.bestScore).toBe(90)
    const listed = await db.listPassages()
    expect(listed.passages.some((item) => item.id === passageId)).toBe(true)
    // Other passages remain
    for (const item of before.passages) {
      expect(listed.passages.some((row) => row.id === item.id)).toBe(true)
    }
    await db.deletePassage(passageId)
    const afterDelete = await db.listPassages()
    expect(afterDelete.passages.some((item) => item.id === passageId)).toBe(false)
  })

  it('stores passage books in passage_books table', async () => {
    const bookId = `book-${suffix}`
    const books = await db.replacePassageBooks([{ id: bookId, name: `课本${suffix}` }])
    expect(books.some((book) => book.id === bookId && book.name.startsWith('课本'))).toBe(true)
    const listed = await db.listPassages()
    expect(listed.books.some((book) => book.id === bookId)).toBe(true)
    expect(listed.passages.some((item) => item.id === '__kotonoha_books__')).toBe(false)
    await db.replacePassageBooks(listed.books.filter((book) => book.id !== bookId))
  })

  it('patches settings independently', async () => {
    const before = await db.getState()
    const next = await db.patchSettings({
      ...before.settings,
      displayName: `测${suffix}`.slice(0, 40),
    })
    expect(next.displayName).toContain('测')
    await db.patchSettings(before.settings)
  })
})
