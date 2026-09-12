export const PASSAGE_OCR_PLACEHOLDER = '（正在识别课文…）'

export function looksLikeErrorDocument(text: string) {
  const value = String(text || '')
  return /<\s*html\b/i.test(value)
    || /<\s*head\b/i.test(value)
    || /<\s*title\b/i.test(value)
    || /502\s*Bad\s*Gateway/i.test(value)
    || /nginx\/\d/i.test(value)
}

export function isPassagePlaceholder(text?: string) {
  const value = String(text || '').trim()
  return !value || value === PASSAGE_OCR_PLACEHOLDER || looksLikeErrorDocument(value)
}

export function publicApiMessage(value: unknown, fallback: string) {
  const text = String(value || '').trim()
  if (!text || looksLikeErrorDocument(text) || /unexpected token/i.test(text) || /is not valid JSON/i.test(text)) {
    return fallback
  }
  return text.slice(0, 120)
}
