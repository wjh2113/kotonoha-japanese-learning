import { describe, expect, it } from 'vitest'
import { isPassagePlaceholder, looksLikeErrorDocument, publicApiMessage } from './error-text'

describe('gateway error documents', () => {
  it('detects nginx 502 HTML so it is never stored as a lesson', () => {
    const html = '<html> <head><title>502 Bad Gateway</title></head> <body><center><h1>502 Bad Gateway</h1></center></body></html>'
    expect(looksLikeErrorDocument(html)).toBe(true)
    expect(isPassagePlaceholder(html)).toBe(true)
    expect(publicApiMessage(html, '课文解析失败，请稍后重试。')).toBe('课文解析失败，请稍后重试。')
  })

  it('keeps ordinary Japanese sentences', () => {
    expect(looksLikeErrorDocument('昨日、学校で日本語を勉強しました。')).toBe(false)
    expect(isPassagePlaceholder('昨日、学校で日本語を勉強しました。')).toBe(false)
  })
})
