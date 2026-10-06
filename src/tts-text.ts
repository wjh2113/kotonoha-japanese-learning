import { toHiragana } from './utils'

const KANJI = /[\u4e00-\u9fff]/

const KNOWN_KANJI_KANA: Record<string, string> = {
  電子辞書: 'でんしじしょ',
  店員: 'てんいん',
  行きません: 'いきません',
  行きましょう: 'いきましょう',
  行きます: 'いきます',
  日曜日: 'にちようび',
  月曜日: 'げつようび',
  火曜日: 'かようび',
  水曜日: 'すいようび',
  木曜日: 'もくようび',
  金曜日: 'きんようび',
  土曜日: 'どようび',
  秋葉原: 'あきはばら',
  山田: 'やまだ',
  佐藤: 'さとう',
  鈴木: 'すずき',
  田中: 'たなか',
  上野: 'うえの',
  浅草: 'あさくさ',
  新宿: 'しんじゅく',
  渋谷: 'しぶや',
  池袋: 'いけぶくろ',
  東京: 'とうきょう',
  大阪: 'おおさか',
  京都: 'きょうと',
  横浜: 'よこはま',
  名古屋: 'なごや',
  今度: 'こんど',
  今日: 'きょう',
  明日: 'あした',
  昨日: 'きのう',
  行って: 'いって',
  行った: 'いった',
  行く: 'いく',
  行き: 'いき',
}

/** 店員（てんいん）→ てんいん，avoid CosyVoice reading kanji as Chinese. */
export function expandFuriganaForTts(text: string) {
  return String(text || '').replace(/[\u4e00-\u9fff]+[（(]([^）)]+)[）)]/g, '$1')
}

export function replaceKnownKanji(text: string) {
  let out = String(text || '')
  const keys = Object.keys(KNOWN_KANJI_KANA).sort((a, b) => b.length - a.length)
  for (const kanji of keys) out = out.split(kanji).join(KNOWN_KANJI_KANA[kanji])
  return out
}

export function finalizeTtsKana(text: string) {
  return expandFuriganaForTts(replaceKnownKanji(String(text || '')))
}

function countKanji(text: string) {
  return (String(text || '').match(/[\u4e00-\u9fff]/g) || []).length
}

export function spokenLexeme(term?: string, reading?: string) {
  const kana = toHiragana(finalizeTtsKana(String(reading || '').trim()))
  if (kana && /[\u3040-\u30ffー]/.test(kana) && !KANJI.test(kana)) return kana
  return toHiragana(finalizeTtsKana(String(term || '').trim()))
}

function spokenToken(token: { surface?: string; reading?: string }) {
  const surface = String(token.surface || '')
  const reading = finalizeTtsKana(String(token.reading || '').trim())
  if (KANJI.test(surface) && reading && !KANJI.test(reading)) return toHiragana(reading)
  return finalizeTtsKana(surface)
}

/** Prefer kana readings so TTS is Japanese, not Chinese kanji. */
export function spokenJapanese(source: {
  text?: string
  reading?: string
  tokens?: Array<{ surface?: string; reading?: string }>
} | string) {
  if (typeof source === 'string') return spokenLexeme(source)
  const readingSpoken = finalizeTtsKana(String(source.reading || '').trim())
  if (readingSpoken && !KANJI.test(readingSpoken)) return readingSpoken

  const tokens = Array.isArray(source.tokens) ? source.tokens : []
  if (tokens.length) {
    const joined = tokens.map(spokenToken).join('')
    if (!KANJI.test(joined)) return joined
    if (readingSpoken && countKanji(readingSpoken) < countKanji(joined)) return readingSpoken
    return joined
  }
  return spokenLexeme(source.text, source.reading)
}
