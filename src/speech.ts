import { Capacitor } from '@capacitor/core'
import { apiUrl } from './api'
import type { VoiceGender } from './types'

const MALE_VOICE_HINT = /ichiro|keita|takumi|haruto|daichi|naoki|otoya|male|man|男性|男声/i
const FEMALE_VOICE_HINT = /nanami|ayumi|haruka|kyoko|sayaka|female|woman|女性|女声/i

let cachedVoices: SpeechSynthesisVoice[] = []
let voicesLoading: Promise<SpeechSynthesisVoice[]> | null = null
let speechUnlocked = false
let sharedAudio: HTMLAudioElement | null = null
let blobUrl: string | null = null
let audioToken = 0
let audioContext: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null

/** Tiny silent WAV so the shared <audio> can be primed inside a user gesture. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

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

/** Warm voices + unlock the shared audio element inside a user gesture. */
export function unlockSpeech() {
  if (speechUnlocked) {
    void loadSpeechVoices()
    primeSharedAudio()
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
  primeSharedAudio()
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

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioContext || audioContext.state === 'closed') audioContext = new Ctx()
  return audioContext
}

function getSharedAudio() {
  if (typeof window === 'undefined') return null
  if (sharedAudio) return sharedAudio
  try {
    const AudioCtor = window.Audio || (globalThis as typeof globalThis & { Audio?: typeof Audio }).Audio
    if (!AudioCtor) return null
    const audio = new AudioCtor()
    audio.preload = 'auto'
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    sharedAudio = audio
    return audio
  } catch {
    return null
  }
}

function primeSharedAudio() {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  const audio = getSharedAudio()
  if (!audio) return
  try {
    if (!audio.src) audio.src = SILENT_WAV
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      void playPromise.catch(() => {})
    }
  } catch {
    // ignore
  }
}

function stopAudioPlayback() {
  audioToken += 1
  if (activeSource) {
    try { activeSource.stop() } catch { /* ignore */ }
    activeSource = null
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
  if (!sharedAudio) return
  try {
    sharedAudio.pause()
    sharedAudio.currentTime = 0
  } catch {
    // ignore
  }
}

/** Split on particles / punctuation so each clip stays a single Youdao MP3. */
export function chunkJapaneseForTts(text: string, max = 12) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.length <= max) return [raw]
  const parts: string[] = []
  let buffer = ''
  for (const ch of raw) {
    buffer += ch
    const boundary = /[。．.!！?？、，,\s]|[はがをにでとはもへのねよ]/u.test(ch)
    if ((boundary && buffer.length >= 2) || buffer.length >= max) {
      const piece = buffer.trim()
      if (piece) parts.push(piece)
      buffer = ''
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts.length ? parts : [raw]
}

function ttsAudioUrl(text: string) {
  return apiUrl(`/api/tts?q=${encodeURIComponent(text)}`)
}

async function fetchTtsBlob(text: string) {
  const response = await fetch(ttsAudioUrl(text))
  const type = String(response.headers.get('content-type') || '')
  if (!response.ok || type.includes('json') || type.includes('html')) {
    throw new Error('tts-http')
  }
  const blob = await response.blob()
  if (blob.size < 400) throw new Error('tts-empty')
  return blob
}

async function playSharedBlob(blob: Blob, token: number) {
  const ctx = getAudioContext()
  if (ctx) {
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch { /* ignore */ }
    }
    const data = await blob.arrayBuffer()
    if (token !== audioToken) return
    const buffer = await ctx.decodeAudioData(data.slice(0))
    if (token !== audioToken) return
    await new Promise<void>((resolve, reject) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      activeSource = source
      source.onended = () => {
        if (activeSource === source) activeSource = null
        resolve()
      }
      try {
        source.start()
      } catch (reason) {
        reject(reason instanceof Error ? reason : new Error('audio-tts-failed'))
        return
      }
      window.setTimeout(() => {
        if (token !== audioToken) return
        if (activeSource === source) resolve()
      }, Math.ceil(buffer.duration * 1000) + 800)
    })
    return
  }

  const audio = getSharedAudio()
  if (!audio) throw new Error('audio-unavailable')
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = URL.createObjectURL(blob)
  audio.muted = false
  audio.src = blobUrl
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      resolve()
    }
    const fail = (reason: string) => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      reject(new Error(reason))
    }
    audio.onended = finish
    audio.onerror = () => fail('audio-tts-failed')
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => fail('audio-tts-blocked'))
    }
    window.setTimeout(() => {
      if (token !== audioToken) return
      if (audio.paused && audio.currentTime === 0) fail('audio-tts-timeout')
    }, 12_000)
  })
}

async function speakWithAudioFallback(text: string, options: {
  onStart?: () => void
  onEnd?: () => void
} = {}) {
  const parts = chunkJapaneseForTts(text)
  if (!parts.length) {
    options.onEnd?.()
    return
  }
  primeSharedAudio()
  const token = ++audioToken
  options.onStart?.()
  try {
    for (const part of parts) {
      if (token !== audioToken) return
      await playSharedBlob(await fetchTtsBlob(part), token)
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
