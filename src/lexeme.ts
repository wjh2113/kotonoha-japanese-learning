const NOTE_NOISE = /笔记|口诀|手写|批注|红色|虚线|原图|常见搭配|下方有|表旁|表上|表顶|无法辨认|下划线/
const MAX_TERM = 20

function firstMeaningClause(text: string) {
  return String(text || '')
    .replace(/多用于复合词.*$/s, '')
    .replace(/可单独使用.*$/s, '')
    .replace(/更口语化.*$/s, '')
    .replace(/与[“"「].*$/s, '')
    .replace(/[。．].*$/s, '')
    .split(/[／/]/)[0]
    .trim()
}

export type ImportLexeme = {
  term: string
  reading?: string
  meaning?: string
  partOfSpeech?: string
  romaji?: string
  example?: string
  pronunciationNote?: string
  memoryTip?: string
  synonyms?: string
  similarWords?: string
}

type ImportExtras = Omit<ImportLexeme, 'term' | 'reading' | 'meaning'>

function cleanExtras(extras?: ImportExtras): ImportExtras {
  if (!extras) return {}
  const clean = (value?: string) => String(value || '').trim() || undefined
  return {
    partOfSpeech: clean(extras.partOfSpeech),
    romaji: clean(extras.romaji),
    example: clean(extras.example),
    pronunciationNote: clean(extras.pronunciationNote),
    memoryTip: clean(extras.memoryTip),
    synonyms: clean(extras.synonyms),
    similarWords: clean(extras.similarWords),
  }
}

export function looksLikeVocabularyTerm(term?: string) {
  const text = String(term || '').trim()
  return Boolean(
    text
    && text.length <= MAX_TERM
    && /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)
    && !NOTE_NOISE.test(text)
    && !/^[-・●○\s✍✍️]+$/.test(text),
  )
}

export function isChineseGloss(meaning?: string) {
  const text = String(meaning || '').trim()
  if (!text) return false
  if (/待补充|未知|不明|暂无|未查询|词义缺失|n\/a|unknown/i.test(text)) return false
  if (!/[\u4e00-\u9fff]/.test(text)) return false
  const compact = text.replace(/\s/g, '')
  const letters = (compact.match(/[A-Za-z]/g) || []).length
  if (letters >= 3 && letters * 2 >= compact.length) return false
  if (text.length > 24) return false
  return true
}

export function quizGloss(meaning?: string) {
  return String(meaning || '')
    .trim()
    .split(/[；;。]/)[0]
    .replace(/（[^）]*[A-Za-z][^）]*）/g, '')
    .trim()
    .slice(0, 16)
}

function uniqueDrafts(items: Array<{ term?: string; reading?: string; meaning?: string } & ImportExtras>): ImportLexeme[] {
  const out: ImportLexeme[] = []
  const seen: string[] = []
  for (const item of items) {
    const term = String(item?.term || '').trim()
    if (!looksLikeVocabularyTerm(term)) continue
    if (seen.some((existing) => existing !== term && term.includes(existing))) continue
    if (seen.includes(term)) continue
    seen.push(term)
    const reading = String(item.reading || '').trim()
    const meaning = String(item.meaning || '').trim()
    out.push({
      term,
      reading: reading || undefined,
      meaning: meaning || undefined,
      ...cleanExtras(item),
    })
  }
  return out
}

function collectCandidates(term: string, reading: string): ImportLexeme[] {
  const combined = `${term}\n${reading}`
  const found: ImportLexeme[] = []
  for (const match of combined.matchAll(/([\u4e00-\u9fffぁ-んァ-ンー]{1,12})（([ぁ-んァ-ンー]{1,16})）/g)) {
    found.push({ term: match[1], reading: match[2] })
  }
  for (const match of combined.matchAll(/[「『]([\u3040-\u30ff\u4e00-\u9fffー]{1,12})[」』]/g)) {
    found.push({ term: match[1], reading: '' })
  }
  if (/东西用ある|记忆口诀/.test(term) || (term === 'ある' && /いる/.test(reading))) {
    found.unshift({ term: 'ある', reading: 'ある', meaning: '（物）有、在' })
    found.push({ term: 'いる', reading: 'いる', meaning: '（人/动物）有、在' })
  }
  return found
}

export function extractImportDrafts(term?: string, reading = '', meaning = '', extras?: ImportExtras) {
  const rawTerm = String(term || '').trim()
  const rawReading = String(reading || '').trim()
  const rawMeaning = String(meaning || '').trim()
  const extra = cleanExtras(extras)

  const numbered = rawTerm.match(/^\s*\d+\.\s*([^\s：:]{1,16})（([ぁ-んァ-ンー]+)）\s*[：:]\s*(.+)$/s)
  if (numbered) {
    return uniqueDrafts([{
      term: numbered[1].trim(),
      reading: numbered[2],
      meaning: firstMeaningClause(numbered[3]).slice(0, 40) || rawMeaning,
      ...extra,
    }])
  }

  const compact = rawTerm.match(/^([\u3040-\u30ff\u4e00-\u9fffー]{1,12})（([ぁ-んァ-ンー]+)）$/)
  if (compact && looksLikeVocabularyTerm(compact[1])) {
    return uniqueDrafts([{ term: compact[1], reading: compact[2], meaning: rawMeaning, ...extra }])
  }

  if (/东西用ある|记忆口诀/.test(rawTerm) || (rawTerm === 'ある' && /いる/.test(rawReading))) {
    return uniqueDrafts([
      { term: 'ある', reading: 'ある', meaning: '（物）有、在' },
      { term: 'いる', reading: 'いる', meaning: '（人/动物）有、在' },
    ])
  }

  if (looksLikeVocabularyTerm(rawTerm) && !NOTE_NOISE.test(rawReading) && rawTerm.length <= MAX_TERM) {
    return uniqueDrafts([{ term: rawTerm, reading: rawReading, meaning: rawMeaning, ...extra }])
  }

  const drafts = uniqueDrafts(collectCandidates(rawTerm, rawReading).map((item) => ({
    ...item,
    meaning: item.meaning || rawMeaning,
  })))
  if (drafts.length) return drafts
  return []
}

export function extractUploadedLexeme(term?: string, reading = '') {
  const drafts = extractImportDrafts(term, reading)
  if (drafts[0]) {
    return {
      term: drafts[0].term,
      reading: drafts[0].reading || '',
      meaning: drafts[0].meaning,
      cleaned: drafts[0].term !== String(term || '').trim(),
    }
  }
  return { term: String(term || '').trim().slice(0, MAX_TERM), reading: String(reading || '').trim().slice(0, 24), cleaned: false }
}

export function normalizeImportDrafts(drafts?: Array<{ term?: string; reading?: string; meaning?: string } & ImportExtras>) {
  return uniqueDrafts((Array.isArray(drafts) ? drafts : []).flatMap((draft) => (
    extractImportDrafts(draft?.term, draft?.reading, draft?.meaning, draft)
  )))
}
