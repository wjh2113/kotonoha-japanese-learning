import type { ImportDraft, Word } from './types'
import { fallbackLexicon } from './data'
import { extractUploadedLexeme, looksLikeVocabularyTerm, normalizeImportDrafts } from './lexeme'

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const TABLE_HEADER_ALIASES: Array<[keyof ImportDraft, RegExp]> = [
  ['term', /^(单词|単語|term|word)$/i],
  ['reading', /^(假名|读音|かな|kana|reading)$/i],
  ['partOfSpeech', /^(词性|詞性|品词|pos|partofspeech)$/i],
  ['meaning', /^(中文释义|释义|意思|中文|meaning|definition)$/i],
  ['romaji', /^(罗马音|ローマ字|romaji|romanji)$/i],
  ['example', /^(例句|例文|example|sentence)$/i],
  ['translation', /^(例句译文|例句翻译|译文|翻译|translation)$/i],
  ['pronunciationNote', /^(发音注意事项|发音注意|发音|pronunciation)/i],
  ['memoryTip', /^(记忆技巧|记忆法|记忆|口诀|memory|memo)/i],
  ['synonyms', /^(同义词|近义词|同义|近义|synonym)/i],
  ['similarWords', /^(形近词|相似词|形近|similar)/i],
]

/** Ignore index/serial columns from vocabulary handbooks. */
const TABLE_HEADER_SKIP = /^(序号|編號|编号|no\.?|index|#)$/i

function matchTableHeader(cols: string[]): Array<keyof ImportDraft | null> | null {
  const keys = cols.map((col) => {
    const label = col.trim()
    if (!label || TABLE_HEADER_SKIP.test(label)) return null
    const hit = TABLE_HEADER_ALIASES.find(([, pattern]) => pattern.test(label))
    return hit ? hit[0] : null
  })
  return keys.includes('term') && keys.filter(Boolean).length >= 2 ? keys : null
}

function splitImportColumns(line: string) {
  if (line.includes('\t')) return line.split('\t').map((part) => part.trim())
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if ((char === ',' || char === '，') && !quoted) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  out.push(current.trim())
  return out
}

function draftFromTableRow(cols: string[], header: Array<keyof ImportDraft | null> | null): ImportDraft | null {
  const pick = (key: keyof ImportDraft, index: number) => {
    if (header) {
      const at = header.indexOf(key)
      return at >= 0 ? String(cols[at] || '').trim() : ''
    }
    return String(cols[index] || '').trim()
  }
  // Handbook template: 序号 单词 假名 词性 中文释义 罗马音 例句 例句译文 发音注意事项 记忆技巧 同义词 形近词
  const handbook = !header && cols.length >= 11 && /^\d+$/.test(String(cols[0] || '').trim())
  const term = handbook ? pick('term', 1) : pick('term', 0)
  if (!term || TABLE_HEADER_SKIP.test(term) || term === '单词') return null
  const wide = header
    ? Boolean(header.includes('romaji') || header.includes('partOfSpeech') || header.includes('translation'))
    : cols.length >= 4
  if (handbook) {
    return {
      term,
      reading: pick('reading', 2) || undefined,
      partOfSpeech: pick('partOfSpeech', 3) || undefined,
      meaning: pick('meaning', 4) || undefined,
      romaji: pick('romaji', 5) || undefined,
      example: pick('example', 6) || undefined,
      translation: pick('translation', 7) || undefined,
      pronunciationNote: pick('pronunciationNote', 8) || undefined,
      memoryTip: pick('memoryTip', 9) || undefined,
      synonyms: pick('synonyms', 10) || undefined,
      similarWords: pick('similarWords', 11) || undefined,
    }
  }
  return {
    term,
    reading: pick('reading', 1) || undefined,
    meaning: wide ? pick('meaning', 3) || undefined : pick('meaning', 2) || undefined,
    partOfSpeech: wide ? pick('partOfSpeech', 2) || undefined : undefined,
    romaji: wide ? pick('romaji', 4) || undefined : undefined,
    example: wide ? pick('example', 5) || undefined : undefined,
    translation: wide ? pick('translation', 6) || undefined : undefined,
    pronunciationNote: wide ? pick('pronunciationNote', header?.includes('translation') ? 7 : 6) || undefined : undefined,
    memoryTip: wide ? pick('memoryTip', header?.includes('translation') ? 8 : 7) || undefined : undefined,
    synonyms: wide ? pick('synonyms', header?.includes('translation') ? 9 : 8) || undefined : undefined,
    similarWords: wide ? pick('similarWords', header?.includes('translation') ? 10 : 9) || undefined : undefined,
  }
}

function rawImportDrafts(raw: string): ImportDraft[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const json = JSON.parse(trimmed)
    const arr = Array.isArray(json) ? json : json.words
    if (Array.isArray(arr)) {
      return arr.map((item) => typeof item === 'string' ? { term: item } : {
        term: String(item.term || item.word || item['单词'] || '').trim(),
        reading: String(item.reading || item.kana || item['读音'] || item['假名'] || '').trim() || undefined,
        meaning: String(item.meaning || item.definition || item['释义'] || item['中文释义'] || '').trim() || undefined,
        partOfSpeech: String(item.partOfSpeech || item.pos || item['词性'] || '').trim() || undefined,
        romaji: String(item.romaji || item['罗马音'] || '').trim() || undefined,
        example: String(item.example || item.sentence || item['例句'] || '').trim() || undefined,
        translation: String(item.translation || item['例句译文'] || item['译文'] || '').trim() || undefined,
        pronunciationNote: String(item.pronunciationNote || item['发音注意事项'] || item['发音注意'] || '').trim() || undefined,
        memoryTip: String(item.memoryTip || item['记忆技巧'] || item['记忆法'] || '').trim() || undefined,
        synonyms: String(item.synonyms || item['同义词'] || item['近义词'] || '').trim() || undefined,
        similarWords: String(item.similarWords || item['形近词'] || item['相似词'] || '').trim() || undefined,
      }).filter((item) => item.term)
    }
  } catch { /* plain text or CSV */ }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let header: Array<keyof ImportDraft | null> | null = null
  const out: ImportDraft[] = []
  for (const line of lines) {
    const cols = splitImportColumns(line)
    if (!header) {
      const matched = matchTableHeader(cols)
      if (matched) { header = matched; continue }
    }
    if (/^(单词|word)[,\t]/i.test(line) && cols.length <= 3) continue
    const draft = draftFromTableRow(cols, header)
    if (draft) out.push(draft)
  }
  return out
}

export function parseVocabulary(raw: string): ImportDraft[] {
  return normalizeImportDrafts(rawImportDrafts(raw))
}

/** 仅接受词汇手册表头（至少含：单词、假名、词性、中文释义）。 */
export function isVocabularyHandbookHeader(cols: string[]) {
  const header = matchTableHeader(cols)
  if (!header) return false
  return Boolean(
    header.includes('term')
    && header.includes('reading')
    && header.includes('partOfSpeech')
    && header.includes('meaning'),
  )
}

/**
 * 严格按词汇手册解析：必须有标准表头，忽略 JSON / 纯词表 / 三列简表。
 * 不符合时返回空数组。
 */
export function parseVocabularyHandbook(raw: string): ImportDraft[] {
  const lines = String(raw || '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const headerCols = splitImportColumns(lines[0])
  if (!isVocabularyHandbookHeader(headerCols)) return []
  const header = matchTableHeader(headerCols)
  if (!header) return []
  const out: ImportDraft[] = []
  for (const line of lines.slice(1)) {
    const draft = draftFromTableRow(splitImportColumns(line), header)
    if (draft) out.push(draft)
  }
  return normalizeImportDrafts(out)
}

export function makeFallbackWord(draft: ImportDraft): Word {
  const cleaned = looksLikeVocabularyTerm(draft.term)
    ? draft
    : extractUploadedLexeme(draft.term, draft.reading || '')
  const term = cleaned.term || draft.term
  const known = fallbackLexicon[term] || {}
  const reading = cleaned.reading || draft.reading || known.reading || toHiragana(term)
  const userExample = String(draft.example || '').trim()
  const userTranslation = String(draft.translation || '').trim()
  return {
    id: uid(), term, reading,
    meaning: draft.meaning || cleaned.meaning || known.meaning || '待补充释义',
    partOfSpeech: String(draft.partOfSpeech || '').trim() || known.partOfSpeech || '词性待确认',
    example: userExample || known.example || `${term}を勉強します。`,
    exampleReading: userExample ? '' : (known.exampleReading || `${reading}を べんきょうします。`),
    translation: userExample ? (userTranslation || '') : (userTranslation || known.translation || `学习“${term}”这个词。`),
    romaji: String(draft.romaji || '').trim() || toRomaji(reading) || undefined,
    pronunciationNote: String(draft.pronunciationNote || '').trim() || undefined,
    memoryTip: String(draft.memoryTip || '').trim() || undefined,
    synonyms: String(draft.synonyms || '').trim() || undefined,
    similarWords: String(draft.similarWords || '').trim() || undefined,
    mastered: false, createdAt: Date.now(),
  }
}

export function toHiragana(input: string) {
  return input.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

const ROMAJI_BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
}

const ROMAJI_COMBO: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  でぃ: 'di', でゅ: 'dyu', とぅ: 'tu', どぅ: 'du',
}

/** Split a 同义词/形近词 cell into individual words. */
export function splitWordList(input?: string) {
  return String(input || '')
    .split(/[、，,；;／/\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
}

/** Hepburn romaji derived from a kana reading. Returns '' when the text has kanji/other scripts. */
export function toRomaji(input: string) {
  const text = toHiragana(String(input || '').trim())
  if (!text) return ''
  let out = ''
  let sokuon = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === 'っ') { sokuon = true; continue }
    if (char === 'ー') {
      const vowel = out.match(/[aiueo]$/)
      if (vowel) out += vowel[0]
      continue
    }
    if (/\s/.test(char)) { out += ' '; continue }
    let roma = ROMAJI_COMBO[text.slice(i, i + 2)]
    if (roma) i += 1
    else roma = ROMAJI_BASE[char]
    if (!roma) return ''
    if (sokuon) {
      roma = (/^[aiueo]/.test(roma) ? 't' : roma[0]) + roma
      sokuon = false
    }
    out += roma
  }
  if (sokuon) out += 't'
  return out
}

export function normalizeJapanese(input: string) {
  return toHiragana(input)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s。、！？,.!?・「」『』]/g, '')
}

export function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[b.length][a.length]
}

export function pronunciationScoreFor(transcript: string, ...targets: string[]) {
  const spoken = normalizeJapanese(transcript)
  const candidates = targets.map(normalizeJapanese).filter(Boolean)
  if (!candidates.length) return 0
  const scores = candidates.map((target) => Math.max(0, Math.round((1 - levenshtein(spoken, target) / Math.max(spoken.length, target.length, 1)) * 100)))
  return Math.max(...scores)
}

export function pronunciationScore(transcript: string, word: Word) {
  return pronunciationScoreFor(transcript, word.term, word.reading)
}

export function splitJapaneseSentences(raw: string) {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。．！？!?])/u))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function matchesTypingAnswer(input: string, word: Word) {
  const normalized = normalizeJapanese(input)
  return Boolean(normalized) && [word.term, word.reading].some((answer) => normalizeJapanese(answer) === normalized)
}

export function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5)
}

export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const
const DAY = 24 * 60 * 60 * 1000

export function scheduleReview(word: Word, remembered: boolean, now = Date.now()): Partial<Word> {
  if (!remembered) {
    return { reviewStage: 0, lastReviewedAt: now, nextReviewAt: now + 10 * 60 * 1000 }
  }
  const previous = (word.lastReviewedAt || word.nextReviewAt) ? (word.reviewStage ?? 0) : -1
  const reviewStage = Math.min(previous + 1, REVIEW_INTERVAL_DAYS.length - 1)
  return { reviewStage, lastReviewedAt: now, nextReviewAt: now + REVIEW_INTERVAL_DAYS[reviewStage] * DAY }
}

export function getReviewState(word: Word, now = Date.now()) {
  const nextReviewAt = Number.isFinite(word.nextReviewAt) ? Number(word.nextReviewAt) : Number.POSITIVE_INFINITY
  const due = nextReviewAt <= now
  const daysUntil = Number.isFinite(nextReviewAt) ? Math.ceil((nextReviewAt - now) / DAY) : null
  return { due, nextReviewAt, daysUntil, stage: word.reviewStage ?? 0 }
}

export function formatReviewTime(word: Word, now = Date.now()) {
  const state = getReviewState(word, now)
  if (!Number.isFinite(state.nextReviewAt)) return '尚未进入复习计划'
  if (state.due) return '现在应复习'
  if (state.daysUntil === 1) return '明天复习'
  return `${state.daysUntil} 天后复习`
}

export function localDateKey(now = Date.now()) {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Update streak when the user studies today. */
export function touchStudyStreak(settings: { streakDays?: number; lastStudyDate?: string }, now = Date.now()) {
  const today = localDateKey(now)
  if (settings.lastStudyDate === today) {
    return { streakDays: settings.streakDays || 1, lastStudyDate: today }
  }
  const yesterday = localDateKey(now - DAY)
  const streakDays = settings.lastStudyDate === yesterday ? (settings.streakDays || 0) + 1 : 1
  return { streakDays, lastStudyDate: today }
}

/** 0–5 mastery dots for cards (review stage / mastered). */
export function masteryDots(word: Word) {
  if (word.mastered) return 5
  return Math.max(0, Math.min(5, (word.reviewStage ?? 0) + 1))
}

export function proficiencyPercent(word: Word) {
  if (word.mastered) return 100
  const stage = word.reviewStage ?? 0
  return Math.round(((stage + 1) / REVIEW_INTERVAL_DAYS.length) * 100)
}
