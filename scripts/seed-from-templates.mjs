#!/usr/bin/env node
/**
 * Wipe learning data and seed from public handbook templates.
 *   node --env-file=.env scripts/seed-from-templates.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { createDatabase } from '../database.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseVocabTsv(text) {
  const lines = String(text || '').split('\n').map((line) => line.trimEnd()).filter(Boolean)
  if (!lines.length) return []
  const rows = []
  for (const line of lines) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(',')
    if (!cols.length) continue
    const first = String(cols[0] || '').trim()
    if (first === '序号' || first === '单词') continue
    const handbook = cols.length >= 11 && /^\d+$/.test(first)
    const term = String(handbook ? cols[1] : cols[0] || '').trim()
    if (!term) continue
    rows.push({
      term,
      reading: String(handbook ? cols[2] : cols[1] || '').trim(),
      partOfSpeech: String(handbook ? cols[3] : '').trim(),
      meaning: String(handbook ? cols[4] : cols[2] || '').trim(),
      romaji: String(handbook ? cols[5] : '').trim(),
      example: String(handbook ? cols[6] : '').trim(),
      translation: String(handbook ? cols[7] : '').trim(),
      pronunciationNote: String(handbook ? cols[8] : '').trim(),
      memoryTip: String(handbook ? cols[9] : '').trim(),
      synonyms: String(handbook ? cols[10] : '').trim(),
      similarWords: String(handbook ? cols[11] : '').trim(),
    })
  }
  return rows
}

function parsePassageMd(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const lessons = []
  const parts = text.split(/\n(?=##\s+)/)
  let documentTitle = ''
  const h1 = text.match(/^#\s+(.+)$/m)
  if (h1) documentTitle = h1[1].replace(/^【课文整理】\s*/, '').trim()

  for (const part of parts) {
    const titleMatch = part.match(/^##\s+(.+)$/m)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    const tableBlock = part.match(/\|[^\n]+\|\n\|[-| :]+\|\n([\s\S]*?)(?=\n\n|\n\*\*|<\/|$)/)
    if (!tableBlock) continue
    const sentences = []
    const sourceLines = []
    for (const line of tableBlock[1].split('\n')) {
      if (!line.trim().startsWith('|')) continue
      const cells = line.split('|').map((cell) => cell.trim()).filter((_, index, arr) => index > 0 && index < arr.length - 1)
      if (cells.length < 2) continue
      const jp = cells[0].replace(/\*\*/g, '').trim()
      const zh = cells[1].replace(/\*\*/g, '').trim()
      if (!jp || jp === '原文') continue
      sourceLines.push(jp)
      sentences.push({
        id: `s${sentences.length + 1}`,
        text: jp,
        reading: '',
        translation: zh,
        tokens: [],
        grammar: [],
      })
    }
    if (!sentences.length) continue
    lessons.push({
      title,
      sourceText: sourceLines.join('\n'),
      sentences,
    })
  }
  return { documentTitle, lessons }
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const db = createDatabase(connectionString)
  await db.initialize()
  await db.wipeLearningData()

  const workbook = XLSX.read(await fs.readFile(path.join(root, 'public/templates/词汇导入模版.xlsx')))
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const tsv = rows
    .map((row) => row.map((cell) => String(cell ?? '').replace(/\r?\n/g, ' ').trim()).join('\t'))
    .filter((line) => line.replace(/\t/g, '').trim())
    .join('\n')
  const drafts = parseVocabTsv(tsv)
  if (!drafts.length) throw new Error('vocab template empty')

  const words = drafts.map((draft, index) => ({
    id: `seed-w-${index + 1}`,
    term: draft.term,
    reading: draft.reading || '',
    meaning: draft.meaning || '',
    partOfSpeech: draft.partOfSpeech || '',
    romaji: draft.romaji || '',
    example: draft.example || '',
    exampleReading: '',
    translation: draft.translation || '',
    pronunciationNote: draft.pronunciationNote || '',
    memoryTip: draft.memoryTip || '',
    synonyms: draft.synonyms || '',
    similarWords: draft.similarWords || '',
    mastered: false,
    starred: false,
    createdAt: Date.now(),
  }))

  await db.replaceState({
    units: [{
      id: 'unit-seed-1',
      name: '第1单元 · 模版示例',
      description: '词汇手册模版',
      color: '#dd5b43',
      words,
    }],
    settings: {
      avatar: 'ゆ',
      voiceGender: 'female',
      theme: 'matcha',
      displayName: '小林同学',
      streakDays: 0,
      lastStudyDate: '',
    },
  })

  const handbook = parsePassageMd(await fs.readFile(path.join(root, 'public/templates/课文导入模版.md'), 'utf8'))
  if (!handbook.lessons.length) throw new Error('passage template parse failed')
  const bookId = 'book-seed-1'
  const bookName = handbook.documentTitle || '课文整理模版'
  const passages = handbook.lessons.map((lesson, index) => ({
    id: `seed-p-${index + 1}`,
    title: String(lesson.title || `课文${index + 1}`).slice(0, 80),
    sourceText: lesson.sourceText || '',
    sentences: lesson.sentences.map((sentence, sentenceIndex) => ({
      ...sentence,
      id: `seed-p-${index + 1}-s${sentenceIndex + 1}`,
    })),
    bookId,
    bookName,
    progress: {},
    status: 'ready',
    statusText: '',
    createdAt: Date.now() + index,
  }))

  await db.replacePassages({ passages, books: [{ id: bookId, name: bookName }] })

  const state = await db.getState()
  const listed = await db.listPassages({ light: true })
  console.log(JSON.stringify({
    ok: true,
    units: state.units.length,
    words: state.units.reduce((sum, unit) => sum + unit.words.length, 0),
    passages: listed.passages.length,
    books: listed.books.length,
    sampleWords: state.units[0]?.words?.map((word) => word.term),
    samplePassages: listed.passages.map((item) => item.title),
  }, null, 2))
  await db.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
