/** Shared kanji → kana for TTS. Keep textbook names/places from being read as Chinese. */
export const KNOWN_KANJI_KANA = {
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

export function expandFuriganaForTts(text) {
  return String(text || '').replace(/[\u4e00-\u9fff]+[（(]([^）)]+)[）)]/g, '$1')
}

export function replaceKnownKanji(text) {
  let out = String(text || '')
  const keys = Object.keys(KNOWN_KANJI_KANA).sort((a, b) => b.length - a.length)
  for (const kanji of keys) out = out.split(kanji).join(KNOWN_KANJI_KANA[kanji])
  return out
}

/** 去掉行首「佐藤：」「りん：」说话人标签，避免与句中人名读两遍。 */
export function stripDialogueSpeakerPrefix(text) {
  return String(text || '').replace(
    /^\s*[^\s：:]{1,24}?(?:（[^）]*）|\([^)]*\))?\s*[：:]\s*/,
    '',
  )
}

export function finalizeTtsKana(text) {
  // 先去说话人标签、再展开注音、最后补无注音汉字
  return replaceKnownKanji(expandFuriganaForTts(stripDialogueSpeakerPrefix(String(text || ''))))
}
