import { Capacitor } from '@capacitor/core'
import { apiUrl } from './api'
import type { VoiceGender } from './types'

const MALE_VOICE_HINT = /ichiro|keita|takumi|haruto|daichi|naoki|otoya|male|man|男性|男声/i
const FEMALE_VOICE_HINT = /nanami|ayumi|haruka|kyoko|sayaka|female|woman|女性|女声/i

let cachedVoices: SpeechSynthesisVoice[] = []
let voicesLoading: Promise<SpeechSynthesisVoice[]> | null = null
let speechUnlocked = false
let activeAudio: HTMLAudioElement | null = null
let audioToken = 0

function speechAvailable() {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
}

function readVoices() {
  if (!speechAvailable()) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) cachedVoices = voices
  return cachedVoices
}

/** Mobile web + Capacitor WebViews often have silent/broken Japanese speechSynthesis. */
export function preferAudioTtsFallback() {
  try {
    if (Capacitor.isNativePlatform()) return true
  } catch {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches) return true
  } catch {
    // ignore
  }
  return false
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
  if (speechUnlocked) {
    void loadSpeechVoices()
    return
  }
  speechUnlocked = true
  void loadSpeechVoices()
  if (speechAvailable()) {
    try {
      window.speechSynthesis.resume()
    } catch {
      // ignore
    }
  }
  // Do NOT play a warm Audio here — it steals the user-gesture on Android WebView
  // and causes the real word TTS play() to be blocked.
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

function stopAudioPlayback() {
  audioToken += 1
  if (!activeAudio) return
  try {
    activeAudio.pause()
    activeAudio.removeAttribute('src')
    activeAudio.load()
  } catch {
    // ignore
  }
  activeAudio = null
}

function chunkText(text: string, max = 80) {
  const raw = String(text || '').trim()
  if (raw.length <= max) return raw ? [raw] : []
  const parts: string[] = []
  let buffer = ''
  for (const ch of raw) {
    buffer += ch
    if (buffer.length >= max && /[。．.!！?？、，,\s]/.test(ch)) {
      parts.push(buffer.trim())
      buffer = ''
    } else if (buffer.length >= max + 20) {
      parts.push(buffer.trim())
      buffer = ''
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts
}

function ttsAudioUrl(text: string) {
  return apiUrl(`/api/tts?q=${encodeURIComponent(text)}`)
}

async function playAudioUrl(url: string, token: number) {
  const audio = new Audio()
  audio.preload = 'auto'
  activeAudio = audio
  // Assign src then play in the same turn so mobile WebViews keep the user gesture.
  audio.src = url
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      resolve()
    }
    const fail = (reason: string) => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      reject(new Error(reason))
    }
    audio.onended = finish
    audio.onerror = () => fail('audio-tts-failed')
    audio.onplaying = () => {
      // Playback actually started — keep waiting for onended.
    }
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => fail('audio-tts-blocked'))
    }
    window.setTimeout(() => {
      if (token !== audioToken) return
      if (audio.paused && audio.currentTime === 0) fail('audio-tts-timeout')
    }, 8000)
  })
  if (token !== audioToken) return
  if (activeAudio === audio) activeAudio = null
}

async function speakWithAudioFallback(text: string, options: {
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  const parts = chunkText(text)
  if (!parts.length) {
    options.onEnd?.()
    return
  }
  const token = ++audioToken
  options.onStart?.()
  try {
    for (const part of parts) {
      if (token !== audioToken) return
      await playAudioUrl(ttsAudioUrl(part), token)
    }
  } finally {
    if (token === audioToken) options.onEnd?.()
  }
}

function speakWithBrowser(text: string, voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  const base = options.sentence ? 0.82 : 0.72
  const speed = Number.isFinite(options.speed) ? Number(options.speed) : 1
  utterance.rate = Math.max(0.3, Math.min(2, base * speed))
  utterance.pitch = voiceGender === 'male' ? 0.72 : 1.06
  utterance.voice = selectJapaneseVoice(readVoices(), voiceGender).voice

  return new Promise<'ok' | 'error'>((resolve) => {
    let done = false
    let started = false
    const finish = (result: 'ok' | 'error') => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.clearTimeout(startWatch)
      if (result === 'ok') options.onEnd?.()
      resolve(result)
    }
    const timer = window.setTimeout(
      () => finish(started ? 'ok' : 'error'),
      Math.max(12_000, Math.ceil((text.length * 420) / Math.max(0.3, utterance.rate)) + 3000),
    )
    const startWatch = window.setTimeout(() => {
      if (!started) finish('error')
    }, 1200)
    utterance.onstart = () => {
      started = true
      options.onStart?.()
    }
    utterance.onend = () => finish('ok')
    utterance.onerror = () => finish('error')
    try {
      window.speechSynthesis.speak(utterance)
      resumeSpeechSoon()
    } catch {
      finish('error')
    }
  })
}

export async function speakJapanese(text: string, voiceGender: VoiceGender, options: {
  sentence?: boolean
  speed?: number
  restart?: boolean
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  const value = String(text || '').trim()
  if (!value) {
    options.onEnd?.()
    return
  }

  if (options.restart !== false) stopSpeaking()
  void loadSpeechVoices()
  unlockSpeech()

  // Native WebViews / missing ja voices: use audio TTS that actually plays on phone.
  if (preferAudioTtsFallback()) {
    try {
      await speakWithAudioFallback(value, options)
      return
    } catch {
      // Fall through to browser TTS if audio CDN blocked.
    }
  }

  if (!speechAvailable()) {
    try {
      await speakWithAudioFallback(value, options)
    } catch {
      options.onEnd?.()
    }
    return
  }

  const result = await speakWithBrowser(value, voiceGender, options)
  if (result === 'ok') return

  // Browser speak queued but never started / errored — try audio fallback.
  try {
    await speakWithAudioFallback(value, options)
  } catch {
    options.onEnd?.()
  }
}

export function stopSpeaking() {
  stopAudioPlayback()
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
  const lines = texts.map((item) => String(item || '').trim()).filter(Boolean)
  if (!lines.length) return
  stopSpeaking()
  for (let index = 0; index < lines.length; index += 1) {
    options.onIndex?.(index)
    await speakJapanese(lines[index], voiceGender, {
      sentence: options.sentence,
      speed: options.speed,
      restart: false,
    })
  }
  options.onAllEnd?.()
}
