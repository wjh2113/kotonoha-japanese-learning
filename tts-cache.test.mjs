import { mkdtempSync, utimesSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTtsCache, normalizeTtsText, snapTtsSpeed, ttsCacheKey } from './tts-cache.mjs'

describe('tts cache', () => {
  it('snaps speeds onto lesson steps', () => {
    expect(snapTtsSpeed(1)).toBe(1.25)
    expect(snapTtsSpeed(1.25)).toBe(1.25)
    expect(snapTtsSpeed(1.3)).toBe(1.25)
    expect(snapTtsSpeed(1.5)).toBe(1.56)
  })

  it('normalizes whitespace so the same sentence hits', () => {
    expect(normalizeTtsText('  今日は  いい天気ですね。 ')).toBe('今日は いい天気ですね。')
  })

  it('changes key with voice, gender, or speed', () => {
    const base = ttsCacheKey({ text: 'こんにちは', gender: 'female', speed: 1.25, voice: 'anna' })
    expect(base).not.toBe(ttsCacheKey({ text: 'こんにちは', gender: 'male', speed: 1.25, voice: 'anna' }))
    expect(base).not.toBe(ttsCacheKey({ text: 'こんにちは', gender: 'female', speed: 1.56, voice: 'anna' }))
    expect(base).not.toBe(ttsCacheKey({ text: 'こんにちは', gender: 'female', speed: 1.25, voice: 'alex' }))
  })

  it('synthesizes once then reads the stored mp3', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'koto-tts-'))
    let calls = 0
    const cache = createTtsCache({
      dir,
      synthesize: async ({ text, speed }) => {
        calls += 1
        return Buffer.alloc(500, `${text}:${speed}`)
      },
    })
    const first = await cache.getOrCreate({ text: '学校', gender: 'female', speed: 1.25, voice: 'anna' })
    const second = await cache.getOrCreate({ text: ' 学校 ', gender: 'female', speed: 1.22, voice: 'anna' })
    expect(first.hit).toBe(false)
    expect(second.hit).toBe(true)
    expect(first.buf.equals(second.buf)).toBe(true)
    expect(calls).toBe(1)
  })

  it('coalesces concurrent first plays', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'koto-tts-'))
    let calls = 0
    const cache = createTtsCache({
      dir,
      synthesize: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 40))
        return Buffer.alloc(500, 7)
      },
    })
    const results = await Promise.all(Array.from({ length: 5 }, () => (
      cache.getOrCreate({ text: '同じ文', gender: 'female', speed: 1.25, voice: 'anna' })
    )))
    expect(calls).toBe(1)
    expect(new Set(results.map((item) => item.buf.length))).toEqual(new Set([500]))
  })

  it('cleanup removes stale clips', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'koto-tts-'))
    const cache = createTtsCache({
      dir,
      days: 30,
      synthesize: async ({ text }) => Buffer.alloc(500, text),
    })
    await cache.getOrCreate({ text: '古い', gender: 'female', speed: 1.25, voice: 'anna' })
    await cache.getOrCreate({ text: '新しい', gender: 'female', speed: 1.25, voice: 'anna' })
    const oldKey = ttsCacheKey({ text: '古い', gender: 'female', speed: 1.25, voice: 'anna' })
    const oldFile = path.join(dir, oldKey.slice(0, 2), `${oldKey}.mp3`)
    const past = new Date(Date.now() - 40 * 86400_000)
    utimesSync(oldFile, past, past)
    expect(cache.cleanup()).toBe(1)
  })
})
