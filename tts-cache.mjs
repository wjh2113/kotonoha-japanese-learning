/**
 * TTS disk cache (same idea as childstudy):
 * one CosyVoice call per text + voice + speed, then replay the mp3 file.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Align with the reader speed menu after CosyVoice 1.25 mapping. */
export const TTS_SPEED_STEPS = [0.94, 1.25, 1.56, 1.88]

export function snapTtsSpeed(speed) {
  const n = Number(speed)
  if (!Number.isFinite(n) || n <= 0 || Math.abs(n - 1) < 0.02) return 1.25
  return TTS_SPEED_STEPS.reduce((best, step) => (Math.abs(step - n) < Math.abs(best - n) ? step : best))
}

export function normalizeTtsText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export function ttsCacheKey({ text, gender, speed, voice }) {
  const raw = [
    voice || '',
    gender === 'male' ? 'male' : 'female',
    snapTtsSpeed(speed).toFixed(2),
    normalizeTtsText(text),
  ].join('|')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

function cachePath(dir, key) {
  return path.join(dir, key.slice(0, 2), `${key}.mp3`)
}

function readCachedFile(file) {
  try {
    const buf = fs.readFileSync(file)
    if (!buf.length) return null
    try { fs.utimesSync(file, new Date(), new Date()) } catch { /* ignore */ }
    return buf
  } catch {
    return null
  }
}

function writeFileAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file)
}

export function createTtsCache({ dir, days = 90, synthesize }) {
  const inflight = new Map()

  async function getOrCreate({ text, gender, speed, voice }) {
    const clean = normalizeTtsText(text)
    const snapped = snapTtsSpeed(speed)
    const sex = gender === 'male' ? 'male' : 'female'
    const key = ttsCacheKey({ text: clean, gender: sex, speed: snapped, voice })
    const file = cachePath(dir, key)
    const hit = readCachedFile(file)
    if (hit) return { buf: hit, hit: true, speed: snapped }

    let pending = inflight.get(key)
    if (!pending) {
      pending = (async () => {
        const again = readCachedFile(file)
        if (again) return again
        const buf = await synthesize({ text: clean, gender: sex, speed: snapped })
        if (buf && buf.length >= 400) {
          try { writeFileAtomic(file, buf) } catch (error) {
            console.warn('tts cache write failed:', error.message)
          }
        }
        return buf
      })().finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    const buf = await pending
    return { buf, hit: false, speed: snapped }
  }

  function cleanup(maxAgeDays = days) {
    if (maxAgeDays <= 0 || !fs.existsSync(dir)) return 0
    const cutoff = Date.now() - maxAgeDays * 86400_000
    const hourAgo = Date.now() - 3600_000
    let removed = 0
    let shards
    try { shards = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
    for (const shard of shards) {
      if (!shard.isDirectory()) continue
      const folder = path.join(dir, shard.name)
      let files
      try { files = fs.readdirSync(folder) } catch { continue }
      for (const name of files) {
        const file = path.join(folder, name)
        try {
          const stat = fs.statSync(file)
          const stale = stat.mtimeMs < cutoff
          const strayTmp = name.endsWith('.tmp') && stat.mtimeMs < hourAgo
          if (stale || strayTmp) {
            fs.unlinkSync(file)
            removed += 1
          }
        } catch { /* ignore */ }
      }
    }
    return removed
  }

  return { getOrCreate, cleanup, dir }
}
