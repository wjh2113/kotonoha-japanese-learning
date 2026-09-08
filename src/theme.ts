import { apiFetch } from './api'

export const DEFAULT_UNIT_THEME = '上传词汇后由 AI 自动归纳主题'

export function isPlaceholderTheme(description?: string) {
  const text = String(description || '').trim()
  return !text || text === DEFAULT_UNIT_THEME || /AI\s*自动归纳/.test(text)
}

export async function fetchUnitTheme(unitName: string, words: { term?: string; meaning?: string }[]) {
  const terms = words.map((word) => String(word.term || '').trim()).filter(Boolean).slice(0, 80)
  const meanings = words.map((word) => String(word.meaning || '').trim()).filter(Boolean).slice(0, 40)
  const response = await apiFetch('/api/unit-theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitName, terms, meanings }),
  })
  const data = await response.json()
  if (!response.ok || !data.unitDescription) throw new Error(data.error || '归纳主题失败')
  return String(data.unitDescription).trim()
}
