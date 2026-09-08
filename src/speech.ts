import type { VoiceGender } from './types'

const MALE_VOICE_HINT = /ichiro|keita|takumi|haruto|daichi|naoki|otoya|male|man|男性|男声/i
const FEMALE_VOICE_HINT = /nanami|ayumi|haruka|kyoko|sayaka|female|woman|女性|女声/i

export async function loadSpeechVoices() {
  const current = speechSynthesis.getVoices()
  if (current.length) return current
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => resolve(speechSynthesis.getVoices()), 1200)
    speechSynthesis.addEventListener('voiceschanged', () => {
      window.clearTimeout(timeout)
      resolve(speechSynthesis.getVoices())
    }, { once: true })
  })
}

export function selectJapaneseVoice(voices: SpeechSynthesisVoice[], voiceGender: VoiceGender) {
  const japanese = voices.filter((voice) => voice.lang.toLowerCase().startsWith('ja'))
  const wanted = voiceGender === 'male' ? MALE_VOICE_HINT : FEMALE_VOICE_HINT
  const unwanted = voiceGender === 'male' ? FEMALE_VOICE_HINT : MALE_VOICE_HINT
  const matched = japanese.find((voice) => wanted.test(`${voice.name} ${voice.voiceURI}`))
  return { voice: matched || japanese.find((voice) => !unwanted.test(`${voice.name} ${voice.voiceURI}`)) || japanese[0] || null, nativeMatch: Boolean(matched) }
}

export async function speakJapanese(text: string, voiceGender: VoiceGender, options: { sentence?: boolean; onStart?: () => void; onEnd?: () => void } = {}) {
  if (!text.trim() || typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = options.sentence ? 0.82 : 0.72
  utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
  utterance.voice = selectJapaneseVoice(await loadSpeechVoices(), voiceGender).voice
  utterance.onstart = () => options.onStart?.()
  utterance.onend = () => options.onEnd?.()
  utterance.onerror = () => options.onEnd?.()
  speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
}

export async function speakJapaneseQueue(texts: string[], voiceGender: VoiceGender, options: {
  sentence?: boolean
  onIndex?: (index: number) => void
  onAllEnd?: () => void
} = {}) {
  if (typeof speechSynthesis === 'undefined') return
  const lines = texts.map((item) => item.trim()).filter(Boolean)
  if (!lines.length) return
  speechSynthesis.cancel()
  const voice = selectJapaneseVoice(await loadSpeechVoices(), voiceGender).voice
  lines.forEach((text, index) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ja-JP'
    utterance.rate = options.sentence ? 0.82 : 0.72
    utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
    utterance.voice = voice
    utterance.onstart = () => options.onIndex?.(index)
    utterance.onend = () => { if (index === lines.length - 1) options.onAllEnd?.() }
    utterance.onerror = () => { if (index === lines.length - 1) options.onAllEnd?.() }
    speechSynthesis.speak(utterance)
  })
}
