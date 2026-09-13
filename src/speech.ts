import type { VoiceGender } from './types'

const MALE_VOICE_HINT = /ichiro|keita|takumi|haruto|daichi|naoki|otoya|male|man|男性|男声/i
const FEMALE_VOICE_HINT = /nanami|ayumi|haruka|kyoko|sayaka|female|woman|女性|女声/i

let cachedVoices: SpeechSynthesisVoice[] = []
let voicesLoading: Promise<SpeechSynthesisVoice[]> | null = null
let speechUnlocked = false

function speechAvailable() {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
}

function readVoices() {
  if (!speechAvailable()) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) cachedVoices = voices
  return cachedVoices
}

export async function loadSpeechVoices() {
  if (!speechAvailable()) return []
  const current = readVoices()
  if (current.length) return current
  if (voicesLoading) return voicesLoading
  voicesLoading = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const finish = () => {
      voicesLoading = null
      resolve(readVoices())
    }
    const timeout = window.setTimeout(finish, 1200)
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      window.clearTimeout(timeout)
      finish()
    }, { once: true })
  })
  return voicesLoading
}

/** Warm voices + unlock TTS inside a user gesture (required on iOS / some WebViews). */
export function unlockSpeech() {
  if (!speechAvailable() || speechUnlocked) {
    void loadSpeechVoices()
    return
  }
  speechUnlocked = true
  void loadSpeechVoices()
  try {
    window.speechSynthesis.resume()
  } catch {
    // ignore
  }
}

export function selectJapaneseVoice(voices: SpeechSynthesisVoice[], voiceGender: VoiceGender) {
  const japanese = voices.filter((voice) => voice.lang.toLowerCase().startsWith('ja'))
  const wanted = voiceGender === 'male' ? MALE_VOICE_HINT : FEMALE_VOICE_HINT
  const unwanted = voiceGender === 'male' ? FEMALE_VOICE_HINT : MALE_VOICE_HINT
  const matched = japanese.find((voice) => wanted.test(`${voice.name} ${voice.voiceURI}`))
  return { voice: matched || japanese.find((voice) => !unwanted.test(`${voice.name} ${voice.voiceURI}`)) || japanese[0] || null, nativeMatch: Boolean(matched) }
}

function resumeSpeechSoon() {
  if (!speechAvailable()) return
  const kick = () => {
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume()
    } catch {
      // ignore
    }
  }
  kick()
  window.setTimeout(kick, 0)
  window.setTimeout(kick, 250)
}

export async function speakJapanese(text: string, voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  restart?: boolean
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  if (!text.trim() || !speechAvailable()) {
    options.onEnd?.()
    return
  }

  // Do not await before speak() — mobile browsers require speak() in the user-gesture stack.
  void loadSpeechVoices()
  unlockSpeech()

  if (options.restart !== false) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  const base = options.sentence ? 0.82 : 0.72
  const speed = Number.isFinite(options.speed) ? Number(options.speed) : 1
  utterance.rate = Math.max(0.3, Math.min(2, base * speed))
  utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
  utterance.voice = selectJapaneseVoice(readVoices(), voiceGender).voice

  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      options.onEnd?.()
      resolve()
    }
    const timer = window.setTimeout(
      finish,
      Math.max(12_000, Math.ceil((text.length * 420) / Math.max(0.3, utterance.rate)) + 3000),
    )
    utterance.onstart = () => options.onStart?.()
    utterance.onend = finish
    utterance.onerror = finish
    try {
      window.speechSynthesis.speak(utterance)
      resumeSpeechSoon()
    } catch {
      finish()
    }
  })
}

export function stopSpeaking() {
  if (!speechAvailable()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore
  }
}

export async function speakJapaneseQueue(texts: string[], voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  onIndex?: (index: number) => void
  onAllEnd?: () => void
} = {}) {
  if (!speechAvailable()) return
  const lines = texts.map((item) => item.trim()).filter(Boolean)
  if (!lines.length) return

  void loadSpeechVoices()
  unlockSpeech()
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore
  }

  const voice = selectJapaneseVoice(readVoices(), voiceGender).voice
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
    window.speechSynthesis.speak(utterance)
  })
  resumeSpeechSoon()
}
