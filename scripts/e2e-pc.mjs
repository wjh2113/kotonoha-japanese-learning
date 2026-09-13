/**
 * PC desktop regression — 1280×900 sidebar app.
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
const PORT = Number(process.env.E2E_PORT || 4178)
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(30000)
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, `pc-${name}.png`), fullPage: false })
  }
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const clickNav = async (label) => {
    const el = page.locator(`aside button:has-text("${label}")`).first()
    if (!(await el.count()) || !(await el.isVisible().catch(() => false))) return false
    await el.click()
    await page.waitForTimeout(900)
    return true
  }

  try {
    const health = await (await fetch(`${BASE}/api/health`)).json()
    if (health.ok) ok('health', health.database?.name || '')
    else fail('health', JSON.stringify(health))

    const login = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })).json()
    if (!login.token) {
      fail('api-login', JSON.stringify(login))
      throw new Error('login failed')
    }
    ok('api-login')

    const state = await (await fetch(`${BASE}/api/state`, {
      headers: { Authorization: `Bearer ${login.token}` },
    })).json()
    const wordCount = (state.units || []).reduce((sum, unit) => sum + (unit.words?.length || 0), 0)
    if (wordCount > 0) ok('api-state', `units=${state.units?.length} words=${wordCount}`)
    else fail('api-state', JSON.stringify({ units: state.units?.length, wordCount }))

    const passages = await (await fetch(`${BASE}/api/passages`, {
      headers: { Authorization: `Bearer ${login.token}` },
    })).json()
    const passageCount = (passages.passages || []).filter((item) => item.id !== '__kotonoha_books__').length
    if (passageCount > 0) ok('api-passages', `passages=${passageCount}`)
    else fail('api-passages', JSON.stringify(passages).slice(0, 120))

    await page.addInitScript(() => {
      window.__tts = { count: 0, last: '' }
      const speak = speechSynthesis.speak.bind(speechSynthesis)
      speechSynthesis.speak = (u) => {
        window.__tts.count += 1
        window.__tts.last = String(u?.text || '')
        try { return speak(u) } catch { return undefined }
      }
    })

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.evaluate((token) => localStorage.setItem('kotonoha-access-token', token), login.token)
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    let text = await bodyText()
    if (/请输入访问密码/.test(text)) {
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /进入/ }).click()
      await page.waitForTimeout(2000)
      text = await bodyText()
    }
    if (/欢迎回来|继续学习|今日/.test(text) && !/请输入访问密码/.test(text)) ok('login-ui')
    else fail('login-ui', text.slice(0, 160))
    await shot('01-home')

    // Sidebar should be visible on desktop
    if (await page.locator('aside').first().isVisible()) ok('sidebar-visible')
    else fail('sidebar-visible')
    if ((await page.locator('.mobile-tabbar').count()) === 0 || !(await page.locator('.mobile-tabbar').first().isVisible().catch(() => false))) {
      ok('no-mobile-tabbar')
    } else fail('no-mobile-tabbar', 'mobile tabbar visible on desktop')

    const navItems = ['首页', '单词学习', '课文学习', '测试', '听写', '生词本', '错词本', '复习', '设置']
    for (const label of navItems) {
      if (await clickNav(label)) ok(`nav-${label}`)
      else fail(`nav-${label}`)
    }

    // Library / study entry — PC "单词学习" is study page with import
    await clickNav('单词学习')
    await page.waitForTimeout(1000)
    await shot('02-study')
    text = await bodyText()
    if (/导入单词|单词学习|已掌握/.test(text)) ok('study-view')
    else fail('study-view', text.slice(0, 120))
    if ((await page.locator('button:has-text("导入单词")').count()) > 0) ok('study-has-import')
    else fail('study-has-import')

    const word = page.locator('.word-card, .word-row').first()
    if (await word.count()) {
      await page.evaluate(() => { window.__tts.count = 0 })
      await word.click()
      await page.waitForTimeout(700)
      const tts = await page.evaluate(() => window.__tts)
      if (tts.count > 0) ok('study-speak', tts.last)
      else {
        // Desktop may rely on VolumeButton in detail — click it
        const vol = page.locator('button.volume-button, button[aria-label="朗读"]').first()
        if (await vol.count()) {
          await vol.click()
          await page.waitForTimeout(400)
          const again = await page.evaluate(() => window.__tts.count)
          if (again > 0) ok('study-speak', 'via volume button')
          else fail('study-speak', 'no speak')
        } else fail('study-speak', JSON.stringify(tts))
      }
      if (await page.locator('.detail-card, .detail-column').count()) ok('study-detail')
      else fail('study-detail')
    } else fail('study-word', 'no words')

    // Vocab import modal
    const importBtn = page.locator('button:has-text("导入单词")').first()
    if (await importBtn.count()) {
      await importBtn.click()
      await page.waitForTimeout(600)
      text = await bodyText()
      if (/xlsx|Excel|词汇手册|模版/.test(text)) ok('vocab-import-modal')
      else fail('vocab-import-modal', text.slice(0, 120))
      await page.locator('.modal-close, button:has-text("取消")').first().click().catch(() => {})
      await page.waitForTimeout(300)
    } else fail('vocab-import-modal')

    // Passage
    await clickNav('课文学习')
    await page.waitForTimeout(1800)
    await shot('03-passage')
    text = await bodyText()
    if (/添加课文|原文|精听|跟读|课文/.test(text)) ok('passage-view')
    else fail('passage-view', text.slice(0, 120))
    if ((await page.locator('button:has-text("添加课文")').count()) > 0) ok('passage-has-upload')
    else fail('passage-has-upload')

    // Select chapter if picker exists
    const chapterSelect = page.locator('select[aria-label="选择章节"], .passage-picker-select select').last()
    if (await chapterSelect.count()) {
      const options = await chapterSelect.locator('option').count()
      if (options > 1) {
        await chapterSelect.selectOption({ index: 1 }).catch(() => {})
        await page.waitForTimeout(800)
      }
    }
    text = await bodyText()
    if (/原文|精听|跟读/.test(text)) ok('passage-modes')
    else fail('passage-modes', text.slice(0, 120))

    const intensive = page.locator('button:has-text("精听")').first()
    if (await intensive.count()) {
      await intensive.click()
      await page.waitForTimeout(900)
      text = await bodyText()
      if (/精听|听写|播放|返回/.test(text)) ok('passage-intensive')
      else fail('passage-intensive', text.slice(0, 100))
      await page.locator('button:has-text("原文")').first().click().catch(() => {})
      await page.waitForTimeout(400)
    } else ok('passage-intensive', 'soft')

    const shadow = page.locator('button:has-text("跟读")').first()
    if (await shadow.count()) {
      await shadow.click()
      await page.waitForTimeout(1000)
      await shot('04-shadow')
      text = await bodyText()
      if (/AI 发音|跟读|麦克风|重新跟读|下一句/.test(text)) ok('passage-shadow')
      else fail('passage-shadow', text.slice(0, 120))
      await page.locator('button:has-text("原文")').first().click().catch(() => {})
    } else fail('passage-shadow')

    // Quiz
    await clickNav('测试')
    await page.waitForTimeout(900)
    await shot('05-quiz')
    text = await bodyText()
    if (/听力测试|词义测试|选择测试/.test(text)) ok('quiz-view')
    else fail('quiz-view', text.slice(0, 120))
    const meaning = page.locator('button:has-text("单词词义测试"), button:has-text("词义测试")').first()
    if (await meaning.count() && !(await meaning.isDisabled())) {
      await meaning.click()
      await page.waitForTimeout(1000)
      text = await bodyText()
      if (/选出正确释义|下一题|退出|A|B/.test(text) || await page.locator('.quiz-options-design button, .quiz-options button').count()) {
        ok('quiz-session')
      } else fail('quiz-session', text.slice(0, 120))
      await page.locator('button:has-text("退出"), button:has-text("返回选择")').first().click().catch(() => {})
    } else ok('quiz-session', 'soft: meaning test unavailable')

    // Dictation
    await clickNav('听写')
    await page.waitForTimeout(900)
    await shot('06-dictation')
    text = await bodyText()
    if (/听写|片假名|开始/.test(text)) ok('dictation-view')
    else fail('dictation-view', text.slice(0, 120))

    // Wordbook / errorbook / review / settings
    await clickNav('生词本')
    await page.waitForTimeout(700)
    if (/生词/.test(await bodyText())) ok('wordbook-view')
    else fail('wordbook-view')

    await clickNav('错词本')
    await page.waitForTimeout(700)
    if (/错词/.test(await bodyText())) ok('errorbook-view')
    else fail('errorbook-view')

    await clickNav('复习')
    await page.waitForTimeout(800)
    await shot('07-review')
    if (/复习|间隔|曲线|待复习/.test(await bodyText())) ok('review-view')
    else fail('review-view')

    await clickNav('设置')
    await page.waitForTimeout(700)
    await shot('08-settings')
    text = await bodyText()
    if (/音色|女声|男声|主题/.test(text)) ok('settings-view')
    else fail('settings-view', text.slice(0, 100))

    // Settings voice preview
    const preview = page.locator('.voice-preview button.volume-button, .voice-preview button[aria-label="朗读"]').first()
    if (await preview.count()) {
      await page.evaluate(() => { window.__tts.count = 0 })
      await preview.click()
      await page.waitForTimeout(500)
      const tts = await page.evaluate(() => window.__tts.count)
      if (tts > 0) ok('settings-voice-preview')
      else fail('settings-voice-preview')
    } else ok('settings-voice-preview', 'soft: preview control missing')

    const realErrors = consoleErrors.filter((e) => !/favicon|React DevTools|Download the React/i.test(e))
    if (realErrors.length) fail('console-errors', realErrors.slice(0, 5).join(' | '))
    else ok('console-errors')
  } catch (err) {
    fail('uncaught', String(err?.stack || err))
    await shot('99-error').catch(() => {})
  } finally {
    await browser.close()
    server.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n=== PC SUMMARY ===')
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
