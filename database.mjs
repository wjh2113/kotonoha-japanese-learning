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

export function validatePassages(input) {
  const passages = Array.isArray(input?.passages) ? input.passages : null
  if (!passages) throw new Error('INVALID_PASSAGES')
  if (passages.length > 50) throw new Error('TOO_MANY_PASSAGES')
  if (passages.some((item) => !text(item?.id) || !text(item?.title))) throw new Error('INVALID_PASSAGE')
  return passages
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

  const getState = async () => {
    const [unitResult, wordResult, settingsResult] = await Promise.all([
      pool.query('SELECT id, name, description, color FROM units ORDER BY sort_order, created_at, id'),
      pool.query(`SELECT id, unit_id, term, reading, meaning, part_of_speech, example, example_reading,
        translation, mastered, starred, review_stage, last_reviewed_at, next_review_at,
        listening_wrong, meaning_wrong, listening_correct, meaning_correct, created_at
        FROM words ORDER BY unit_id, sort_order, created_at, id`),
      pool.query('SELECT avatar, voice_gender FROM app_settings WHERE id = 1'),
    ])
    const wordsByUnit = new Map()
    for (const row of wordResult.rows) {
      const words = wordsByUnit.get(row.unit_id) || []
      words.push({
        id: row.id, term: row.term, reading: row.reading, meaning: row.meaning,
        partOfSpeech: row.part_of_speech, example: row.example, exampleReading: row.example_reading,
        translation: row.translation, mastered: row.mastered, starred: row.starred,
        reviewStage: row.review_stage ?? undefined,
        lastReviewedAt: row.last_reviewed_at?.getTime(), nextReviewAt: row.next_review_at?.getTime(),
        listeningWrong: row.listening_wrong || 0, meaningWrong: row.meaning_wrong || 0,
        listeningCorrect: row.listening_correct || 0, meaningCorrect: row.meaning_correct || 0,
        createdAt: row.created_at.getTime(),
      })
      wordsByUnit.set(row.unit_id, words)
    }
    return {
      units: unitResult.rows.map((unit) => ({ ...unit, words: wordsByUnit.get(unit.id) || [] })),
      settings: settingsResult.rows[0]
        ? { avatar: settingsResult.rows[0].avatar, voiceGender: settingsResult.rows[0].voice_gender }
        : { avatar: 'ゆ', voiceGender: 'female' },
    }
  }

  const replaceState = async (input) => {
    const { units, settings } = validateState(input)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM units')
      for (const [unitIndex, unit] of units.entries()) {
        await client.query(
          'INSERT INTO units (id, name, description, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [text(unit.id), text(unit.name), text(unit.description), text(unit.color, '#e6533f'), unitIndex],
        )
        const seenTerms = new Set()
        for (const [wordIndex, word] of unit.words.entries()) {
          const lex = extractUploadedLexeme(word.term, word.reading)
          const term = looksLikeVocabularyTerm(lex.term) ? lex.term : ''
          if (!term || seenTerms.has(term)) continue
          seenTerms.add(term)
          const meaning = text(word.meaning)
          const placeholder = !meaning || /待补充|未知|不明|暂无|未查询|词义缺失|n\/a|unknown/i.test(meaning) || !/[一-鿿]/.test(meaning)
          const dirtyExample = /笔记|批注|手写/.test(`${word.example || ''}${word.translation || ''}`)
          await client.query(
            `INSERT INTO words (id, unit_id, term, reading, meaning, part_of_speech, example,
              example_reading, translation, mastered, starred, review_stage, last_reviewed_at,
              next_review_at, listening_wrong, meaning_wrong, listening_correct, meaning_correct,
              sort_order, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20,NOW()))`,
            [text(word.id), text(unit.id), term, text(lex.reading || word.reading),
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
              wordIndex, timestamp(word.createdAt)],
          )
        }
      }
      await client.query(
        `INSERT INTO app_settings (id, avatar, voice_gender, updated_at) VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET avatar = EXCLUDED.avatar, voice_gender = EXCLUDED.voice_gender, updated_at = NOW()`,
        [text(settings.avatar, 'ゆ').slice(0, 2), settings.voiceGender === 'male' ? 'male' : 'female'],
      )
      await client.query('COMMIT')
      return getState()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  const listPassages = async () => {
    const result = await pool.query('SELECT id, title, source_text, analysis, created_at FROM passages ORDER BY sort_order, created_at, id')
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceText: row.source_text,
      sentences: Array.isArray(row.analysis?.sentences) ? row.analysis.sentences : [],
      createdAt: row.created_at.getTime(),
    }))
  }

  const replacePassages = async (input) => {
    const passages = validatePassages(input)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM passages')
      for (const [index, passage] of passages.entries()) {
        const sentences = Array.isArray(passage.sentences) ? passage.sentences.slice(0, 80) : []
        await client.query(
          'INSERT INTO passages (id, title, source_text, analysis, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))',
          [text(passage.id), text(passage.title).slice(0, 80), text(passage.sourceText).slice(0, 20_000),
            JSON.stringify({ sentences }), index, timestamp(passage.createdAt)],
        )
      }
      await client.query('COMMIT')
      return listPassages()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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

  return { initialize, health, getState, replaceState, listIncompleteWords, countIncompleteWords, updateWordLexicon, unitHasTerm, deleteWord, listPassages, replacePassages, close: () => pool.end() }
}
