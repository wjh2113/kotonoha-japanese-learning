import { Capacitor } from '@capacitor/core'
import { apiUrl } from './api'
import type { VoiceGender } from './types'
import { expandFuriganaForTts } from './tts-text'

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
let activeGain: GainNode | null = null
const blobMemo = new Map<string, Promise<Blob>>()
const BLOB_MEMO_MAX = 80

/** CosyVoice 1.0 is leisurely; 1x in the reader maps to a slightly quicker lesson pace. */
export function resolveGatewayTtsSpeed(userSpeed = 1) {
  const n = Number(userSpeed)
  const base = Number.isFinite(n) && n > 0 ? n : 1
  return Math.min(2, Math.max(0.5, Math.round(base * 1.25 * 100) / 100))
}

/** Find the last frame that still has speech energy. */
export function speechEndIndex(samples: Float32Array, sampleRate: number) {
  const window = Math.max(32, Math.floor(sampleRate * 0.02))
  let end = samples.length
  while (end > window) {
    let sum = 0
    for (let i = end - window; i < end; i += 1) sum += samples[i] * samples[i]
    if (Math.sqrt(sum / window) > 0.016) break
    end -= Math.floor(window / 2)
  }
  return Math.min(samples.length, end + Math.floor(sampleRate * 0.02))
}

export function applySpeechEdges(samples: Float32Array, sampleRate: number, endIndex: number) {
  const fadeIn = Math.min(endIndex, Math.floor(sampleRate * 0.008))
  const fadeOut = Math.min(endIndex, Math.floor(sampleRate * 0.03))
  for (let i = 0; i < fadeIn; i += 1) samples[i] *= i / fadeIn
  const fadeStart = Math.max(0, endIndex - fadeOut)
  for (let i = fadeStart; i < endIndex; i += 1) {
    samples[i] *= (endIndex - 1 - i) / Math.max(1, fadeOut)
  }
  for (let i = endIndex; i < samples.length; i += 1) samples[i] = 0
}

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
  stopActiveSource()
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

/** Split Japanese for TTS. Gateway CosyVoice handles longer clips; scrapers truncate server-side. */
export function chunkJapaneseForTts(text: string, max = 40) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.length <= max) return [raw]
  const parts: string[] = []
  let buffer = ''
  for (const ch of raw) {
    buffer += ch
    const boundary = /[。．.!！?？、，,\s]|[はがをにでとはもへのねよ]/u.test(ch)
    if ((boundary && buffer.length >= Math.min(8, max)) || buffer.length >= max) {
      const piece = buffer.trim()
      if (piece) parts.push(piece)
      buffer = ''
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts.length ? parts : [raw]
}

function ttsAudioUrl(text: string, voiceGender: VoiceGender = 'female', speed = 1) {
  const params = new URLSearchParams({
    q: text,
    gender: voiceGender === 'male' ? 'male' : 'female',
    speed: String(resolveGatewayTtsSpeed(speed)),
  })
  return apiUrl(`/api/tts?${params.toString()}`)
}

async function fetchTtsBlob(text: string, voiceGender: VoiceGender = 'female', speed = 1) {
  const url = ttsAudioUrl(text, voiceGender, speed)
  const cached = blobMemo.get(url)
  if (cached) return cached
  const pending = (async () => {
    const response = await fetch(url)
    const type = String(response.headers.get('content-type') || '')
    if (!response.ok || type.includes('json') || type.includes('html')) {
      throw new Error('tts-http')
    }
    const blob = await response.blob()
    if (blob.size < 400) throw new Error('tts-empty')
    return blob
  })()
  blobMemo.set(url, pending)
  pending.catch(() => {
    if (blobMemo.get(url) === pending) blobMemo.delete(url)
  })
  while (blobMemo.size > BLOB_MEMO_MAX) {
    const oldest = blobMemo.keys().next().value
    if (oldest === undefined) break
    blobMemo.delete(oldest)
  }
  return pending
}

function stopActiveSource() {
  const ctx = audioContext
  const gain = activeGain
  const source = activeSource
  activeGain = null
  activeSource = null
  if (gain && ctx) {
    try {
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now)
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.02)
    } catch { /* ignore */ }
  }
  if (source) {
    try { source.stop() } catch { /* ignore */ }
  }
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
    let endIndex = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      endIndex = Math.max(endIndex, speechEndIndex(buffer.getChannelData(channel), buffer.sampleRate))
    }
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      applySpeechEdges(buffer.getChannelData(channel), buffer.sampleRate, endIndex)
    }
    const playSeconds = Math.max(0.05, endIndex / buffer.sampleRate)
    stopActiveSource()
    await new Promise<void>((resolve, reject) => {
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      source.connect(gain)
      gain.connect(ctx.destination)
      activeSource = source
      activeGain = gain
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (activeSource === source) {
          activeSource = null
          activeGain = null
        }
        resolve()
      }
      source.onended = finish
      try {
        source.start(0, 0, playSeconds)
      } catch (reason) {
        reject(reason instanceof Error ? reason : new Error('audio-tts-failed'))
        return
      }
      window.setTimeout(() => {
        if (token !== audioToken || activeSource !== source) {
          finish()
          return
        }
        finish()
      }, Math.ceil(playSeconds * 1000) + 250)
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

async function speakWithAudioFallback(text: string, voiceGender: VoiceGender, options: {
  onStart?: () => void
  onEnd?: () => void
  speed?: number
  sentence?: boolean
} = {}) {
  // Longer clips for CosyVoice (fewer round-trips); still split very long paragraphs.
  const parts = chunkJapaneseForTts(text, options.sentence ? 120 : 40)
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
      await playSharedBlob(await fetchTtsBlob(part, voiceGender, options.speed ?? 1), token)
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
      if (!started) {
        try { window.speechSynthesis.cancel() } catch { /* ignore */ }
        finish('error')
      }
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
  const value = expandFuriganaForTts(String(text || '').trim())
  if (!value) {
    options.onEnd?.()
    return
  }

  if (options.restart !== false) stopSpeaking()
  void loadSpeechVoices()
  unlockSpeech()

  // 课文句子 / 手机端：优先走服务端 gateway CosyVoice（经 /api/tts），浏览器自带音色太差。
  const preferAudio = Boolean(options.sentence) || preferAudioTtsFallback()
  if (preferAudio) {
    try {
      await speakWithAudioFallback(value, voiceGender, options)
      return
    } catch {
      stopAudioPlayback()
    }
  }

  if (!speechAvailable()) {
    try {
      await speakWithAudioFallback(value, voiceGender, options)
    } catch {
      options.onEnd?.()
    }
    return
  }

  const result = await speakWithBrowser(value, voiceGender, options)
  if (result === 'ok') return

  stopSpeaking()
  try {
    await speakWithAudioFallback(value, voiceGender, options)
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
  shouldContinue?: () => boolean
} = {}) {
  const lines = texts.map((item) => String(item || '').trim()).filter(Boolean)
  if (!lines.length) return
  stopSpeaking()
  for (let index = 0; index < lines.length; index += 1) {
    if (options.shouldContinue && !options.shouldContinue()) return
    options.onIndex?.(index)
    if (index + 1 < lines.length) {
      void fetchTtsBlob(lines[index + 1], voiceGender, options.speed ?? 1).catch(() => {})
    }
    await speakJapanese(lines[index], voiceGender, {
      sentence: options.sentence,
      speed: options.speed,
      restart: false,
    })
  }
  if (options.shouldContinue && !options.shouldContinue()) return
  options.onAllEnd?.()
}
