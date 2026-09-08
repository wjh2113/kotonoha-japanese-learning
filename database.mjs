import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
        translation, mastered, starred, review_stage, last_reviewed_at, next_review_at, created_at
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
        for (const [wordIndex, word] of unit.words.entries()) {
          await client.query(
            `INSERT INTO words (id, unit_id, term, reading, meaning, part_of_speech, example,
              example_reading, translation, mastered, starred, review_stage, last_reviewed_at,
              next_review_at, sort_order, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,NOW()))`,
            [text(word.id), text(unit.id), text(word.term), text(word.reading), text(word.meaning),
              text(word.partOfSpeech), text(word.example), text(word.exampleReading), text(word.translation),
              Boolean(word.mastered), Boolean(word.starred), Number.isInteger(word.reviewStage) ? word.reviewStage : null,
              timestamp(word.lastReviewedAt), timestamp(word.nextReviewAt), wordIndex, timestamp(word.createdAt)],
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

  return { initialize, health, getState, replaceState, listPassages, replacePassages, close: () => pool.end() }
}
