import { toHiragana } from './utils'

const KANJI = /[\u4e00-\u9fff]/

/** 店員（てんいん）→ てんいん，avoid CosyVoice reading kanji as Chinese. */
export function expandFuriganaForTts(text: string) {
  return String(text || '').replace(/[\u4e00-\u9fff]+[（(]([^）)]+)[）)]/g, '$1')
}

export function spokenLexeme(term?: string, reading?: string) {
  const kana = expandFuriganaForTts(String(reading || '').trim())
  if (kana && /[\u3040-\u30ffー]/.test(kana)) return toHiragana(kana)
  return toHiragana(expandFuriganaForTts(String(term || '').trim()))
}

function spokenToken(token: { surface?: string; reading?: string }) {
  const surface = String(token.surface || '')
  const reading = expandFuriganaForTts(String(token.reading || '').trim())
  if (KANJI.test(surface) && reading) return toHiragana(reading)
  return toHiragana(expandFuriganaForTts(surface))
}

/** Prefer kana readings so TTS is Japanese, not Chinese kanji. */
export function spokenJapanese(source: {
  text?: string
  reading?: string
  tokens?: Array<{ surface?: string; reading?: string }>
} | string) {
  if (typeof source === 'string') return spokenLexeme(source)
  const tokens = Array.isArray(source.tokens) ? source.tokens : []
  if (tokens.length) return tokens.map(spokenToken).join('')
  return spokenLexeme(source.text, source.reading)
}
