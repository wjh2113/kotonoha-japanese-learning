import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractUploadedLexeme, looksLikeVocabularyTerm } from './lexeme.mjs'

const { Pool } = pg
const dirname = path.dirname(fileURLToPath(import.meta.url))

const text = (value, fallback = '') => String(value ?? fallback).trim()
const timestamp = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? new Date(number) : null
}

export function validateState(input) {
  const units = Array.isArray(input?.units) ? input.units : null
  const settings = input?.settings
  if (!units || !settings || typeof settings !== 'object') throw new Error('INVALID_STATE')
  if (units.length > 100) throw new Error('TOO_MANY_UNITS')
  const wordCount = units.reduce((sum, unit) => sum + (Array.isArray(unit?.words) ? unit.words.length : 0), 0)
  if (wordCount > 20_000) throw new Error('TOO_MANY_WORDS')
  if (units.some((unit) => !text(unit?.id) || !text(unit?.name) || !Array.isArray(unit?.words))) throw new Error('INVALID_UNIT')
  if (units.some((unit) => unit.words.some((word) => !text(word?.id) || !text(word?.term)))) throw new Error('INVALID_WORD')
  return { units, settings }
}

const BOOKS_META_ID = '__kotonoha_books__'
const looksLikeErrorDocument = (value) => /<\s*html\b/i.test(String(value || '')) || /502\s*Bad\s*Gateway/i.test(String(value || ''))

function storePassageTitle(value) {
  const next = text(value)
  return looksLikeErrorDocument(next) ? '课文' : (next.slice(0, 80) || '课文')
}

function storePassageSource(value) {
  const next = text(value)
  if (looksLikeErrorDocument(next) || next === '（正在识别课文…）') return ''
  return next.slice(0, 20_000)
}

function storeStatusText(value) {
  const next = text(value)
  if (looksLikeErrorDocument(next)) return '课文解析暂时失败，请稍后重试。'
  return next.slice(0, 120)
}

export function validatePassages(input) {
  const passages = Array.isArray(input?.passages)
    ? input.passages.filter((item) => text(item?.id) !== BOOKS_META_ID)
    : null
  if (!passages) throw new Error('INVALID_PASSAGES')
  if (passages.length > 50) throw new Error('TOO_MANY_PASSAGES')
  if (passages.some((item) => !text(item?.id) || !text(item?.title))) throw new Error('INVALID_PASSAGE')
  return passages
}

export function normalizePassageBooks(input, passages = []) {
  const map = new Map()
  const rows = [
    ...(Array.isArray(input?.books) ? input.books : []),
    ...passages.map((passage) => ({ id: passage?.bookId, name: passage?.bookName })),
  ]
  for (const book of rows) {
    const id = text(book?.id).slice(0, 40)
    if (!id || id === BOOKS_META_ID) continue
    map.set(id, text(book?.name).slice(0, 80) || map.get(id) || '未命名课本')
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).slice(0, 40)
}

export function prepareUnitWords(words = []) {
  const seenIds = new Set()
  const seenKeys = new Set()
  const kept = []
  const dropped = []
  for (const word of words) {
    const id = text(word?.id)
    if (!id) {
      dropped.push({ reason: 'missing_id', term: text(word?.term) })
      continue
    }
    if (seenIds.has(id)) {
      dropped.push({ id, reason: 'duplicate_id', term: text(word?.term) })
      continue
    }
    const lex = extractUploadedLexeme(word.term, word.reading)
    let term = looksLikeVocabularyTerm(lex.term) ? lex.term : ''
    if (!term && looksLikeVocabularyTerm(text(word.term))) term = text(word.term)
    if (!term) {
      dropped.push({ id, reason: 'invalid_term', term: text(word?.term) })
      continue
    }
    const reading = text(lex.reading || word.reading)
    const key = `${term}\0${reading}`
    if (seenKeys.has(key)) {
      dropped.push({ id, reason: 'duplicate_term_reading', term, reading })
      continue
    }
    seenIds.add(id)
    seenKeys.add(key)
    kept.push({ word, term, reading, lex })
  }
  return { kept, dropped }
}

export function createDatabase(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })

  const initialize = async () => {
    const schema = await fs.readFile(path.join(dirname, 'db', 'schema.sql'), 'utf8')
    await pool.query(schema)
  }

  const health = async () => {
    const result = await pool.query('SELECT current_database() AS database, NOW() AS time')
    return result.rows[0]
  }

  const mapWordRow = (row) => ({
    id: row.id, term: row.term, reading: row.reading, meaning: row.meaning,
    partOfSpeech: row.part_of_speech, example: row.example, exampleReading: row.example_reading,
    translation: row.translation, mastered: row.mastered, starred: row.starred,
    wrongBook: row.wrong_book, dictationMisses: row.dictation_misses || 0,
    errorReviewed: row.error_reviewed,
    reviewStage: row.review_stage ?? undefined,
    lastReviewedAt: row.last_reviewed_at?.getTime(), nextReviewAt: row.next_review_at?.getTime(),
    listeningWrong: row.listening_wrong || 0, meaningWrong: row.meaning_wrong || 0,
    listeningCorrect: row.listening_correct || 0, meaningCorrect: row.meaning_correct || 0,
    romaji: row.romaji || undefined,
    pronunciationNote: row.pronunciation_note || undefined,
    memoryTip: row.memory_tip || undefined,
    synonyms: row.synonyms || undefined,
    similarWords: row.similar_words || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at.getTime(),
  })

  const wordUpsertSql = `INSERT INTO words (
      id, unit_id, term, reading, meaning, part_of_speech, example, example_reading, translation,
      mastered, starred, review_stage, last_reviewed_at, next_review_at,
      listening_wrong, meaning_wrong, listening_correct, meaning_correct,
      wrong_book, dictation_misses, error_reviewed,
      romaji, pronunciation_note, memory_tip, synonyms, similar_words, notes,
      sort_order, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25,$26,$27,$28,COALESCE($29,NOW())
    )
    ON CONFLICT (id) DO UPDATE SET
      unit_id = EXCLUDED.unit_id,
      term = EXCLUDED.term,
      reading = EXCLUDED.reading,
      meaning = EXCLUDED.meaning,
      part_of_speech = EXCLUDED.part_of_speech,
      example = EXCLUDED.example,
      example_reading = EXCLUDED.example_reading,
      translation = EXCLUDED.translation,
      mastered = EXCLUDED.mastered,
      starred = EXCLUDED.starred,
      review_stage = EXCLUDED.review_stage,
      last_reviewed_at = EXCLUDED.last_reviewed_at,
      next_review_at = EXCLUDED.next_review_at,
      listening_wrong = EXCLUDED.listening_wrong,
      meaning_wrong = EXCLUDED.meaning_wrong,
      listening_correct = EXCLUDED.listening_correct,
      meaning_correct = EXCLUDED.meaning_correct,
      wrong_book = EXCLUDED.wrong_book,
      dictation_misses = EXCLUDED.dictation_misses,
      error_reviewed = EXCLUDED.error_reviewed,
      romaji = EXCLUDED.romaji,
      pronunciation_note = EXCLUDED.pronunciation_note,
      memory_tip = EXCLUDED.memory_tip,
      synonyms = EXCLUDED.synonyms,
      similar_words = EXCLUDED.similar_words,
      notes = EXCLUDED.notes,
      sort_order = EXCLUDED.sort_order`

  const buildWordParams = (word, unitId, wordIndex, term, reading, lex) => {
    const meaning = text(word.meaning)
    const placeholder = !meaning || /待补充|未知|不明|暂无|未查询|词义缺失|n\/a|unknown/i.test(meaning) || !/[一-鿿]/.test(meaning)
    const dirtyExample = /笔记|批注|手写/.test(`${word.example || ''}${word.translation || ''}`)
    return [
      text(word.id), text(unitId), term, reading,
      placeholder && lex.meaning ? lex.meaning : meaning,
      text(word.partOfSpeech),
      dirtyExample ? `${term}を勉強します。` : text(word.example),
      dirtyExample ? '' : text(word.exampleReading),
      dirtyExample ? `学习“${term}”这个词。` : text(word.translation),
      Boolean(word.mastered), Boolean(word.starred), Number.isInteger(word.reviewStage) ? word.reviewStage : null,
      timestamp(word.lastReviewedAt), timestamp(word.nextReviewAt),
      Math.max(0, Math.min(99, Number(word.listeningWrong) || 0)),
      Math.max(0, Math.min(99, Number(word.meaningWrong) || 0)),
      Math.max(0, Math.min(99, Number(word.listeningCorrect) || 0)),
      Math.max(0, Math.min(99, Number(word.meaningCorrect) || 0)),
      Boolean(word.wrongBook),
      Math.max(0, Math.min(99, Number(word.dictationMisses) || 0)),
      Boolean(word.errorReviewed),
      text(word.romaji).slice(0, 120),
      text(word.pronunciationNote).slice(0, 200),
      text(word.memoryTip).slice(0, 200),
      text(word.synonyms).slice(0, 200),
      text(word.similarWords).slice(0, 200),
      text(word.notes).slice(0, 1000),
      wordIndex, timestamp(word.createdAt),
    ]
  }

  const upsertSettings = async (clientOrPool, settings) => {
    const theme = settings.theme === 'aka' || settings.theme === 'ai' ? settings.theme : 'matcha'
    await clientOrPool.query(
      `INSERT INTO app_settings (id, avatar, voice_gender, theme, display_name, streak_days, last_study_date, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         avatar = EXCLUDED.avatar,
         voice_gender = EXCLUDED.voice_gender,
         theme = EXCLUDED.theme,
         display_name = EXCLUDED.display_name,
         streak_days = EXCLUDED.streak_days,
         last_study_date = EXCLUDED.last_study_date,
         updated_at = NOW()`,
      [
        text(settings.avatar, 'ゆ').slice(0, 2),
        settings.voiceGender === 'male' ? 'male' : 'female',
        theme,
        text(settings.displayName, '小林同学').slice(0, 40) || '小林同学',
        Math.max(0, Math.min(9999, Number(settings.streakDays) || 0)),
        text(settings.lastStudyDate).slice(0, 16),
      ],
    )
  }

  const getState = async () => {
    const [unitResult, wordResult, settingsResult] = await Promise.all([
      pool.query('SELECT id, name, description, color FROM units ORDER BY sort_order, created_at, id'),
      pool.query(`SELECT id, unit_id, term, reading, meaning, part_of_speech, example, example_reading,
        translation, mastered, starred, review_stage, last_reviewed_at, next_review_at,
        listening_wrong, meaning_wrong, listening_correct, meaning_correct,
        wrong_book, dictation_misses, error_reviewed,
        romaji, pronunciation_note, memory_tip, synonyms, similar_words, notes, created_at
        FROM words ORDER BY unit_id, sort_order, created_at, id`),
      pool.query('SELECT avatar, voice_gender, theme, display_name, streak_days, last_study_date FROM app_settings WHERE id = 1'),
    ])
    const wordsByUnit = new Map()
    for (const row of wordResult.rows) {
      const words = wordsByUnit.get(row.unit_id) || []
      words.push(mapWordRow(row))
      wordsByUnit.set(row.unit_id, words)
    }
    const theme = settingsResult.rows[0]?.theme
    return {
      units: unitResult.rows.map((unit) => ({ ...unit, words: wordsByUnit.get(unit.id) || [] })),
      settings: settingsResult.rows[0]
        ? {
          avatar: settingsResult.rows[0].avatar,
          voiceGender: settingsResult.rows[0].voice_gender,
          theme: theme === 'aka' || theme === 'ai' || theme === 'matcha' ? theme : 'matcha',
          displayName: settingsResult.rows[0].display_name || '小林同学',
          streakDays: Math.max(0, Number(settingsResult.rows[0].streak_days) || 0),
          lastStudyDate: String(settingsResult.rows[0].last_study_date || ''),
        }
        : { avatar: 'ゆ', voiceGender: 'female', theme: 'matcha', displayName: '小林同学', streakDays: 0, lastStudyDate: '' },
    }
  }

  /** Upsert units/words/settings; delete orphans. Avoids DELETE-all rewrite. */
  const replaceState = async (input) => {
    const { units, settings } = validateState(input)
    const client = await pool.connect()
    const dropped = []
    try {
      await client.query('BEGIN')
      const keepUnitIds = []
      const keepWordIds = []
      for (const [unitIndex, unit] of units.entries()) {
        const unitId = text(unit.id)
        keepUnitIds.push(unitId)
        await client.query(
          `INSERT INTO units (id, name, description, color, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             color = EXCLUDED.color,
             sort_order = EXCLUDED.sort_order`,
          [unitId, text(unit.name), text(unit.description), text(unit.color, '#e6533f'), unitIndex],
        )
        const prepared = prepareUnitWords(unit.words)
        dropped.push(...prepared.dropped.map((item) => ({ ...item, unitId })))
        for (const [wordIndex, entry] of prepared.kept.entries()) {
          keepWordIds.push(text(entry.word.id))
          await client.query(wordUpsertSql, buildWordParams(entry.word, unitId, wordIndex, entry.term, entry.reading, entry.lex))
        }
      }
      if (keepWordIds.length) {
        await client.query('DELETE FROM words WHERE NOT (id = ANY($1::text[]))', [keepWordIds])
      } else {
        await client.query('DELETE FROM words')
      }
      if (keepUnitIds.length) {
        await client.query('DELETE FROM units WHERE NOT (id = ANY($1::text[]))', [keepUnitIds])
      } else {
        await client.query('DELETE FROM units')
      }
      await upsertSettings(client, settings)
      await client.query('COMMIT')
      const state = await getState()
      return dropped.length ? { ...state, droppedCount: dropped.length, dropped } : state
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  const patchSettings = async (settings) => {
    if (!settings || typeof settings !== 'object') throw new Error('INVALID_STATE')
    await upsertSettings(pool, settings)
    return (await getState()).settings
  }

  const patchWord = async (id, fields = {}) => {
    const wordId = text(id)
    if (!wordId) throw new Error('INVALID_WORD')
    const existing = await pool.query('SELECT * FROM words WHERE id = $1', [wordId])
    if (!existing.rows[0]) throw new Error('WORD_NOT_FOUND')
    const row = existing.rows[0]
    const merged = {
      id: wordId,
      term: fields.term ?? row.term,
      reading: fields.reading ?? row.reading,
      meaning: fields.meaning ?? row.meaning,
      partOfSpeech: fields.partOfSpeech ?? row.part_of_speech,
      example: fields.example ?? row.example,
      exampleReading: fields.exampleReading ?? row.example_reading,
      translation: fields.translation ?? row.translation,
      mastered: fields.mastered ?? row.mastered,
      starred: fields.starred ?? row.starred,
      reviewStage: fields.reviewStage !== undefined ? fields.reviewStage : row.review_stage,
      lastReviewedAt: fields.lastReviewedAt !== undefined ? fields.lastReviewedAt : row.last_reviewed_at?.getTime(),
      nextReviewAt: fields.nextReviewAt !== undefined ? fields.nextReviewAt : row.next_review_at?.getTime(),
      listeningWrong: fields.listeningWrong ?? row.listening_wrong,
      meaningWrong: fields.meaningWrong ?? row.meaning_wrong,
      listeningCorrect: fields.listeningCorrect ?? row.listening_correct,
      meaningCorrect: fields.meaningCorrect ?? row.meaning_correct,
      wrongBook: fields.wrongBook ?? row.wrong_book,
      dictationMisses: fields.dictationMisses ?? row.dictation_misses,
      errorReviewed: fields.errorReviewed ?? row.error_reviewed,
      romaji: fields.romaji ?? row.romaji,
      pronunciationNote: fields.pronunciationNote ?? row.pronunciation_note,
      memoryTip: fields.memoryTip ?? row.memory_tip,
      synonyms: fields.synonyms ?? row.synonyms,
      similarWords: fields.similarWords ?? row.similar_words,
      notes: fields.notes ?? row.notes,
      createdAt: row.created_at?.getTime(),
    }
    const lex = extractUploadedLexeme(merged.term, merged.reading)
    const term = looksLikeVocabularyTerm(lex.term) ? lex.term : text(merged.term)
    if (!term) throw new Error('INVALID_WORD')
    await pool.query(wordUpsertSql, buildWordParams(merged, row.unit_id, row.sort_order || 0, term, text(lex.reading || merged.reading), lex))
    const next = await pool.query('SELECT * FROM words WHERE id = $1', [wordId])
    return mapWordRow(next.rows[0])
  }

  const listPassages = async () => {
    const result = await pool.query('SELECT id, title, source_text, analysis, created_at FROM passages ORDER BY sort_order, created_at, id')
    const meta = result.rows.find((row) => row.id === BOOKS_META_ID)
    const books = Array.isArray(meta?.analysis?.books)
      ? meta.analysis.books
        .map((book) => ({ id: text(book?.id).slice(0, 40), name: text(book?.name).slice(0, 80) }))
        .filter((book) => book.id && book.name)
        .slice(0, 40)
      : []
    const passages = result.rows.filter((row) => row.id !== BOOKS_META_ID).map((row) => ({
      id: row.id,
      title: row.title,
      sourceText: row.source_text,
      sentences: Array.isArray(row.analysis?.sentences) ? row.analysis.sentences : [],
      bookId: row.analysis?.bookId || '',
      bookName: row.analysis?.bookName || '',
      progress: row.analysis?.progress && typeof row.analysis.progress === 'object' ? row.analysis.progress : {},
      status: row.analysis?.status === 'processing' || row.analysis?.status === 'error' ? row.analysis.status : 'ready',
      statusText: row.analysis?.statusText || '',
      createdAt: row.created_at.getTime(),
    }))
    return { passages, books }
  }

  const passageAnalysisPayload = (passage) => {
    const sentences = Array.isArray(passage.sentences)
      ? passage.sentences.filter((item) => {
        const line = text(item?.text)
        return line && !looksLikeErrorDocument(line) && line !== '（正在识别课文…）'
      }).slice(0, 80)
      : []
    const progress = passage.progress && typeof passage.progress === 'object' ? passage.progress : {}
    return {
      sentences,
      bookId: text(passage.bookId).slice(0, 40),
      bookName: text(passage.bookName).slice(0, 80),
      progress,
      status: passage.status === 'processing' || passage.status === 'error' ? passage.status : 'ready',
      statusText: storeStatusText(passage.statusText),
    }
  }

  /** Upsert passages + books meta; delete orphans instead of wiping the table. */
  const replacePassages = async (input) => {
    const passages = validatePassages(input)
    const books = normalizePassageBooks(input, passages)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const keepIds = [BOOKS_META_ID]
      for (const [index, passage] of passages.entries()) {
        keepIds.push(text(passage.id))
        await client.query(
          `INSERT INTO passages (id, title, source_text, analysis, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             source_text = EXCLUDED.source_text,
             analysis = EXCLUDED.analysis,
             sort_order = EXCLUDED.sort_order`,
          [text(passage.id), storePassageTitle(passage.title), storePassageSource(passage.sourceText),
            JSON.stringify(passageAnalysisPayload(passage)), index, timestamp(passage.createdAt)],
        )
      }
      await client.query(
        `INSERT INTO passages (id, title, source_text, analysis, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           analysis = EXCLUDED.analysis,
           sort_order = EXCLUDED.sort_order`,
        [BOOKS_META_ID, '课本分组', '', JSON.stringify({ books, sentences: [] }), passages.length],
      )
      await client.query('DELETE FROM passages WHERE NOT (id = ANY($1::text[]))', [keepIds])
      await client.query('COMMIT')
      return listPassages()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  const upsertPassage = async (passage) => {
    if (!passage || !text(passage.id) || !text(passage.title)) throw new Error('INVALID_PASSAGE')
    const existing = await pool.query('SELECT sort_order, created_at FROM passages WHERE id = $1', [text(passage.id)])
    const sortOrder = existing.rows[0]?.sort_order ?? 0
    await pool.query(
      `INSERT INTO passages (id, title, source_text, analysis, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         source_text = EXCLUDED.source_text,
         analysis = EXCLUDED.analysis`,
      [text(passage.id), storePassageTitle(passage.title), storePassageSource(passage.sourceText),
        JSON.stringify(passageAnalysisPayload(passage)), sortOrder,
        timestamp(passage.createdAt) || existing.rows[0]?.created_at || null],
    )
    const listed = await listPassages()
    return listed.passages.find((item) => item.id === text(passage.id)) || null
  }

  const patchPassageProgress = async (id, progress) => {
    const passageId = text(id)
    if (!passageId || passageId === BOOKS_META_ID) throw new Error('INVALID_PASSAGE')
    const result = await pool.query('SELECT analysis FROM passages WHERE id = $1', [passageId])
    if (!result.rows[0]) throw new Error('PASSAGE_NOT_FOUND')
    const analysis = result.rows[0].analysis && typeof result.rows[0].analysis === 'object' ? result.rows[0].analysis : {}
    const nextProgress = progress && typeof progress === 'object' ? progress : {}
    await pool.query(
      'UPDATE passages SET analysis = $2::jsonb WHERE id = $1',
      [passageId, JSON.stringify({ ...analysis, progress: nextProgress })],
    )
    const listed = await listPassages()
    return listed.passages.find((item) => item.id === passageId) || null
  }

  const replacePassageBooks = async (booksInput) => {
    const books = normalizePassageBooks({ books: booksInput }, [])
    await pool.query(
      `INSERT INTO passages (id, title, source_text, analysis, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET analysis = EXCLUDED.analysis`,
      [BOOKS_META_ID, '课本分组', '', JSON.stringify({ books, sentences: [] }), 0],
    )
    return (await listPassages()).books
  }

  const listIncompleteWords = async (limit = 20) => {
    const result = await pool.query(
      `SELECT w.id, w.unit_id, w.term, w.reading, w.meaning, u.name AS unit_name
       FROM words w JOIN units u ON u.id = w.unit_id
       WHERE btrim(w.meaning) = ''
          OR w.meaning ~ '(待补充|未知|不明|暂无|未查询|词义缺失)'
          OR lower(w.meaning) IN ('unknown', 'n/a', 'none')
          OR w.meaning !~ '[一-鿿]'
       ORDER BY u.sort_order, w.sort_order, w.id
       LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 20, 50))],
    )
    return result.rows.map((row) => ({
      id: row.id,
      unitId: row.unit_id,
      unitName: row.unit_name,
      term: row.term,
      reading: row.reading,
      meaning: row.meaning,
    }))
  }

  const countIncompleteWords = async () => {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM words
       WHERE btrim(meaning) = ''
          OR meaning ~ '(待补充|未知|不明|暂无|未查询|词义缺失)'
          OR lower(meaning) IN ('unknown', 'n/a', 'none')
          OR meaning !~ '[一-鿿]'`,
    )
    return result.rows[0]?.count || 0
  }

  const updateWordLexicon = async (id, fields) => {
    await pool.query(
      `UPDATE words
       SET term = COALESCE(NULLIF($2, ''), term),
           reading = $3, meaning = $4, part_of_speech = $5, example = $6,
           example_reading = $7, translation = $8
       WHERE id = $1`,
      [
        text(id),
        text(fields.term).slice(0, 40),
        text(fields.reading).slice(0, 80),
        text(fields.meaning).slice(0, 80),
        text(fields.partOfSpeech).slice(0, 40),
        text(fields.example).slice(0, 200),
        text(fields.exampleReading).slice(0, 200),
        text(fields.translation).slice(0, 200),
      ],
    )
  }

  const unitHasTerm = async (unitId, term, excludeId) => {
    const result = await pool.query(
      'SELECT 1 FROM words WHERE unit_id = $1 AND term = $2 AND id <> $3 LIMIT 1',
      [text(unitId), text(term), text(excludeId)],
    )
    return result.rows.length > 0
  }

  const deleteWord = async (id) => {
    await pool.query('DELETE FROM words WHERE id = $1', [text(id)])
  }

  return { initialize, health, getState, replaceState, patchSettings, patchWord, listIncompleteWords, countIncompleteWords, updateWordLexicon, unitHasTerm, deleteWord, listPassages, replacePassages, upsertPassage, patchPassageProgress, replacePassageBooks, close: () => pool.end() }
}
