import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}))

vi.mock('./api', () => ({
  apiUrl: (path: string) => path,
}))

type FakeVoice = { lang: string; name: string; voiceURI: string }

function installSpeechMock(voices: FakeVoice[] = [{ lang: 'ja-JP', name: 'Kyoko', voiceURI: 'kyoko' }]) {
  const spoken: SpeechSynthesisUtterance[] = []
  const speechSynthesis = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: vi.fn(() => voices as unknown as SpeechSynthesisVoice[]),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
      spoken.push(utterance)
      speechSynthesis.speaking = true
      queueMicrotask(() => {
        speechSynthesis.speaking = false
        utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)
        queueMicrotask(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent))
      })
    }),
    cancel: vi.fn(() => {
      speechSynthesis.speaking = false
    }),
    resume: vi.fn(),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      speechSynthesis,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      Audio: class {
        preload = ''
        currentTime = 0
        paused = true
        volume = 1
        muted = false
        onended: (() => void) | null = null
        onerror: (() => void) | null = null
        src = ''
        setAttribute() {}
        play() {
          this.paused = false
          queueMicrotask(() => this.onended?.())
          return Promise.resolve()
        }
        pause() { this.paused = true }
        load() {}
        removeAttribute() {}
      },
    },
    configurable: true,
  })
  // @ts-expect-error test shim
  globalThis.Audio = window.Audio
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: speechSynthesis,
    configurable: true,
  })
  // @ts-expect-error test shim
  globalThis.SpeechSynthesisUtterance = class {
    text = ''
    lang = ''
    rate = 1
    pitch = 1
    voice: SpeechSynthesisVoice | null = null
    onstart: ((ev: SpeechSynthesisEvent) => void) | null = null
    onend: ((ev: SpeechSynthesisEvent) => void) | null = null
    onerror: ((ev: SpeechSynthesisEvent) => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  return { speechSynthesis, spoken }
}

describe('speakJapanese mobile gesture safety', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls speechSynthesis.speak before awaiting voice loading', async () => {
    const { speechSynthesis, spoken } = installSpeechMock([])
    speechSynthesis.getVoices.mockImplementation(() => [])
    speechSynthesis.addEventListener.mockImplementation((event: string, handler: () => void) => {
      if (event === 'voiceschanged') {
        setTimeout(() => {
          speechSynthesis.getVoices.mockImplementation(() => [
            { lang: 'ja-JP', name: 'Kyoko', voiceURI: 'kyoko' },
          ] as unknown as SpeechSynthesisVoice[])
          handler()
        }, 50)
      }
    })

    const { speakJapanese } = await import('./speech')
    let spokeBeforeAwait = false
    const pending = speakJapanese('学校', 'female')
    spokeBeforeAwait = speechSynthesis.speak.mock.calls.length > 0
    await pending

    expect(spokeBeforeAwait).toBe(true)
    expect(spoken[0]?.text).toBe('学校')
    expect(spoken[0]?.lang).toBe('ja-JP')
  })

  it('chunks Japanese sentences on particle boundaries', async () => {
    const { chunkJapaneseForTts } = await import('./speech')
    const parts = chunkJapaneseForTts('わたしは毎日日本語を勉強します。', 12)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe('わたしは毎日日本語を勉強します。')
    expect(parts.every((part) => part.length <= 12)).toBe(true)
  })

  it('uses audio TTS fetch on mobile instead of speechSynthesis', async () => {
    const { speechSynthesis } = installSpeechMock()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined })
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(512), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tts')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const { speakJapanese } = await import('./speech')
    await speakJapanese('これは本です。', 'female', { sentence: true })

    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('/api/tts')
    expect(speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('speaks immediately when voices are already cached', async () => {
    const { speechSynthesis, spoken } = installSpeechMock()
    const { speakJapanese } = await import('./speech')
    const pending = speakJapanese('花', 'female')
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1)
    await pending
    expect(spoken[0]?.text).toBe('花')
  })
})
