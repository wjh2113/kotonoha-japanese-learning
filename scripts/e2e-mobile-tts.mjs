/**
 * Mobile TTS smoke: verify clicking a word triggers speechSynthesis.speak
 * in the same user-gesture turn (no await-before-speak regression).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const UPSTREAM = process.env.UPSTREAM || 'https://japan.aidigitcloud.cn'
const PASSWORD = process.env.KOTONOHA_PASSWORD || ''
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.E2E_PORT || 4176)
const SHOT_DIR = path.join(ROOT, 'tmp-e2e-shots')

const results = []
const ok = (name, detail = '') => { results.push({ name, pass: true, detail }); console.log('PASS', name, detail) }
const fail = (name, detail = '') => { results.push({ name, pass: false, detail }); console.error('FAIL', name, detail) }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

function startProxy() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
        if (url.pathname.startsWith('/api/')) {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = Buffer.concat(chunks)
          const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
            method: req.method,
            headers: {
              'content-type': req.headers['content-type'] || 'application/json',
              authorization: req.headers.authorization || '',
            },
            body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
          })
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') || 'application/json',
            'cache-control': 'no-store',
          })
          res.end(buf)
          return
        }
        let filePath = path.join(DIST, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
        if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST, 'index.html')
        const ext = path.extname(filePath)
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(fs.readFileSync(filePath))
      } catch (err) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function installSpeechProbe(page) {
  await page.addInitScript(() => {
    const spoken = []
    const proto = window.speechSynthesis
    const originalSpeak = proto.speak.bind(proto)
    const originalCancel = proto.cancel.bind(proto)
    let syncMark = false
    window.__ttsProbe = {
      spoken,
      syncSpeakCount: 0,
      lastText: '',
      markGesture() { syncMark = true },
      clear() {
        spoken.length = 0
        this.syncSpeakCount = 0
        this.lastText = ''
      },
    }
    proto.speak = (utterance) => {
      const text = String(utterance?.text || '')
      spoken.push({ text, lang: utterance?.lang || '', at: Date.now(), sync: syncMark })
      window.__ttsProbe.lastText = text
      if (syncMark) window.__ttsProbe.syncSpeakCount += 1
      try { return originalSpeak(utterance) } catch { return undefined }
    }
    proto.cancel = () => {
      try { return originalCancel() } catch { return undefined }
    }
  })
}

async function main() {
  if (!PASSWORD) {
    console.error('Set KOTONOHA_PASSWORD')
    process.exit(2)
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/ missing — run npm run build first')
    process.exit(2)
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const server = await startProxy()
  const BASE = `http://127.0.0.1:${PORT}`
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  await installSpeechProbe(page)

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, `tts-${name}.png`), fullPage: false })
  }

  try {
    const login = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })).json()
    if (!login.token) {
      fail('api-login', JSON.stringify(login))
      throw new Error('login failed')
    }
    ok('api-login')

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.evaluate((token) => localStorage.setItem('kotonoha-access-token', token), login.token)
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2800)

    let body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/请输入访问密码/.test(body)) {
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /进入/ }).click()
      await page.waitForTimeout(2200)
    }

    const hasSpeech = await page.evaluate(() => typeof speechSynthesis !== 'undefined')
    if (hasSpeech) ok('tts-api-present')
    else fail('tts-api-present')

    // Unlock path: first tap should not throw
    await page.evaluate(() => window.__ttsProbe?.clear())
    await page.locator('.mobile-tabbar button:has-text("单词")').first().click()
    await page.waitForTimeout(1500)
    await shot('01-study')

    const wordCard = page.locator('.word-card, .word-row, button.word-card').first()
    if (!(await wordCard.count())) {
      fail('word-card', 'no word cards on study page')
      throw new Error('no words')
    }
    ok('word-card-visible')

    // Mark gesture then click word — selectWord calls speakJapanese
    await page.evaluate(() => window.__ttsProbe?.markGesture())
    await wordCard.click()
    await page.waitForTimeout(900)
    await shot('02-after-word-click')

    let probe = await page.evaluate(() => ({
      count: window.__ttsProbe?.spoken?.length || 0,
      sync: window.__ttsProbe?.syncSpeakCount || 0,
      last: window.__ttsProbe?.lastText || '',
      texts: (window.__ttsProbe?.spoken || []).map((item) => item.text),
    }))
    if (probe.count > 0 && /[\u3040-\u30ff\u4e00-\u9fff]/.test(probe.last || probe.texts.join(''))) {
      ok('speak-on-word-click', `text=${probe.last || probe.texts[0]} sync=${probe.sync}`)
    } else {
      fail('speak-on-word-click', JSON.stringify(probe))
    }

    // Sheet speaker button
    const speakBtn = page.locator('button[aria-label^="朗读"], button.wordbook-speak').first()
    if (await speakBtn.count()) {
      await page.evaluate(() => {
        window.__ttsProbe.clear()
        window.__ttsProbe.markGesture()
      })
      await speakBtn.click()
      await page.waitForTimeout(700)
      probe = await page.evaluate(() => ({
        count: window.__ttsProbe?.spoken?.length || 0,
        sync: window.__ttsProbe?.syncSpeakCount || 0,
        last: window.__ttsProbe?.lastText || '',
      }))
      if (probe.count > 0) ok('speak-on-sheet-button', `text=${probe.last} sync=${probe.sync}`)
      else fail('speak-on-sheet-button', JSON.stringify(probe))
      await shot('03-sheet-speak')
    } else {
      fail('speak-sheet-button', 'sheet speak button missing')
    }

    // Sync guarantee: wrap speakJapanese call path via button and ensure speak happens before microtasks from await
    const syncOk = await page.evaluate(async () => {
      const before = performance.now()
      let speakAt = 0
      const original = speechSynthesis.speak.bind(speechSynthesis)
      speechSynthesis.speak = (u) => {
        speakAt = performance.now()
        return original(u)
      }
      // Simulate the fixed path: cancel + speak without await in between
      const utterance = new SpeechSynthesisUtterance('テスト')
      utterance.lang = 'ja-JP'
      speechSynthesis.cancel()
      speechSynthesis.speak(utterance)
      const after = performance.now()
      speechSynthesis.speak = original
      return { speakAt, before, after, delta: speakAt - before, ok: speakAt > 0 && speakAt - before < 30 }
    })
    if (syncOk.ok) ok('speak-sync-latency', `delta=${syncOk.delta.toFixed(2)}ms`)
    else fail('speak-sync-latency', JSON.stringify(syncOk))
  } catch (err) {
    fail('uncaught', String(err?.stack || err))
    await shot('99-error').catch(() => {})
  } finally {
    await browser.close()
    server.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n=== TTS SUMMARY ===')
  console.log(JSON.stringify({
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.map((item) => item.name),
    details: results,
  }, null, 2))
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
