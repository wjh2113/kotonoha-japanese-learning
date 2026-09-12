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

export async function speakJapanese(text: string, voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  restart?: boolean
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  if (!text.trim() || typeof speechSynthesis === 'undefined') {
    options.onEnd?.()
    return
  }
  if (options.restart !== false) speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  const base = options.sentence ? 0.82 : 0.72
  const speed = Number.isFinite(options.speed) ? Number(options.speed) : 1
  utterance.rate = Math.max(0.3, Math.min(2, base * speed))
  utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
  utterance.voice = selectJapaneseVoice(await loadSpeechVoices(), voiceGender).voice
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      options.onEnd?.()
      resolve()
    }
    const timer = window.setTimeout(finish, Math.max(12_000, Math.ceil((text.length * 420) / Math.max(0.3, utterance.rate)) + 3000))
    utterance.onstart = () => options.onStart?.()
    utterance.onend = finish
    utterance.onerror = finish
    speechSynthesis.speak(utterance)
  })
}

export function stopSpeaking() {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
}

export async function speakJapaneseQueue(texts: string[], voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  onIndex?: (index: number) => void
  onAllEnd?: () => void
} = {}) {
  if (typeof speechSynthesis === 'undefined') return
  const lines = texts.map((item) => item.trim()).filter(Boolean)
  if (!lines.length) return
  speechSynthesis.cancel()
  const voice = selectJapaneseVoice(await loadSpeechVoices(), voiceGender).voice
  const base = options.sentence ? 0.82 : 0.72
  const speed = Number.isFinite(options.speed) ? Number(options.speed) : 1
  lines.forEach((text, index) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ja-JP'
    utterance.rate = Math.max(0.3, Math.min(2, base * speed))
    utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
    utterance.voice = voice
    utterance.onstart = () => options.onIndex?.(index)
    utterance.onend = () => { if (index === lines.length - 1) options.onAllEnd?.() }
    utterance.onerror = () => { if (index === lines.length - 1) options.onAllEnd?.() }
    speechSynthesis.speak(utterance)
  })
}
