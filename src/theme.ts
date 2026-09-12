import { apiFetch } from './api'

export const DEFAULT_UNIT_THEME = '上传词汇后由 AI 自动归纳主题'

export function isPlaceholderTheme(description?: string) {
  const text = String(description || '').trim()
  return !text
    || text === DEFAULT_UNIT_THEME
    || /AI\s*自动归纳/.test(text)
    || /AI\s*正在根据词汇归纳主题/.test(text)
}

/** Local theme only — avoids a separate LLM call for each unit. */
export function fallbackUnitTheme(unitName: string, words: { term?: string; meaning?: string }[] = []) {
  const meanings = words
    .map((word) => String(word.meaning || '').trim())
    .filter((meaning) => meaning && !/待补全|自动查询|AI|待补充/.test(meaning))
    .slice(0, 3)
  if (meanings.length >= 2) return meanings.slice(0, 2).join('与').replace(/\s+/g, '').slice(0, 12)
  if (meanings[0]) return meanings[0].replace(/\s+/g, '').slice(0, 12)
  const trimmed = String(unitName || '').replace(/^第\s*\d+\s*单元/, '').trim()
  return trimmed || '词汇学习'
}

/** Prefer local theme; optional API kept for older clients / manual refresh. */
export async function fetchUnitTheme(unitName: string, words: { term?: string; meaning?: string }[]) {
  const local = fallbackUnitTheme(unitName, words)
  if (local && !isPlaceholderTheme(local)) return local
  try {
    const terms = words.map((word) => String(word.term || '').trim()).filter(Boolean).slice(0, 80)
    const meanings = words.map((word) => String(word.meaning || '').trim()).filter(Boolean).slice(0, 40)
    const response = await apiFetch('/api/unit-theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitName, terms, meanings }),
    })
    const data = await response.json()
    if (!response.ok || !data.unitDescription) return local || '词汇学习'
    const description = String(data.unitDescription).trim()
    if (isPlaceholderTheme(description)) return local || '词汇学习'
    return description
  } catch {
    return local || '词汇学习'
  }
}
