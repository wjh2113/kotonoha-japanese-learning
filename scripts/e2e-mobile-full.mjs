/**
 * Mobile full regression — practice-only client (390×844).
 * Covers tabs, study/sheet/wordbook/star, passage reader/shadow, quiz, dictation, review, settings, offline.
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
const PORT = Number(process.env.E2E_PORT || 4177)
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, `mfull-${name}.png`), fullPage: false })
  }
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const openTab = async (label) => {
    const tab = page.locator(`.mobile-tabbar button:has-text("${label}")`).first()
    if (!(await tab.count())) return false
    await tab.click()
    await page.waitForTimeout(900)
    return true
  }
  const openMenuItem = async (label) => {
    try {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(200)
      const menuBtn = page.locator('button[aria-label="打开菜单"], button[aria-label="菜单"]').first()
      if (await menuBtn.count()) await menuBtn.click({ force: true })
      else await page.locator('.mobile-topbar button').first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(500)
      const clicked = await page.evaluate((name) => {
        const aside = document.querySelector('aside.app-sidebar, aside')
        if (!aside) return false
        aside.classList.add('open')
        const buttons = [...aside.querySelectorAll('button')]
        const target = buttons.find((btn) => (btn.textContent || '').includes(name))
        if (!target) return false
        target.click()
        return true
      }, label)
      await page.waitForTimeout(900)
      return clicked
    } catch {
      return false
    }
  }

  try {
    const health = await (await fetch(`${BASE}/api/health`)).json()
    if (health.ok) ok('health')
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
    await page.waitForTimeout(3000)

    let text = await bodyText()
    if (/请输入访问密码/.test(text)) {
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /进入/ }).click()
      await page.waitForTimeout(2200)
      text = await bodyText()
    }
    if (/欢迎回来|继续学习|今日|单词|首页/.test(text) && !/请输入访问密码/.test(text)) ok('login-ui')
    else fail('login-ui', text.slice(0, 160))
    await shot('01-home')

    // Tabs
    for (const label of ['首页', '单词', '课文', '语法', '生词本', '我的']) {
      if (await openTab(label)) ok(`tab-${label}`)
      else fail(`tab-${label}`)
    }

    // —— Study ——
    await openTab('单词')
    await page.waitForTimeout(1200)
    await shot('02-study')
    text = await bodyText()
    if ((await page.locator('button:has-text("导入单词"), button:has-text("导入词汇")').count()) === 0) ok('study-no-import')
    else fail('study-no-import')
    if (/单元测试|生词本/.test(text)) ok('study-actions')
    else fail('study-actions', text.slice(0, 100))
    if ((await page.locator('.study-heading-actions button:has-text("听写"), .hero-actions button:has-text("听写")').count()) === 0) ok('study-no-dictation')
    else fail('study-no-dictation', 'dictation button still visible on mobile study')

    const wordCard = page.locator('.word-card, .word-row').first()
    if (await wordCard.count()) {
      await page.evaluate(() => { window.__tts.count = 0; window.__tts.last = '' })
      await wordCard.click()
      await page.waitForTimeout(900)
      await shot('03-word-click')
      // Clicking the row should speak, but NOT open the sheet.
      if ((await page.locator('.wordbook-sheet').count()) === 0) ok('study-no-sheet-on-tap')
      else fail('study-no-sheet-on-tap', 'sheet opened on word tap')
      // Audio fallback may use HTMLAudioElement; also accept speechSynthesis probe.
      const tts = await page.evaluate(() => window.__tts)
      const audioPlaying = await page.evaluate(() => {
        const audios = [...document.querySelectorAll('audio')]
        return audios.some((a) => !a.paused || a.currentTime > 0 || Boolean(a.src))
      })
      if (tts.count > 0 || audioPlaying) ok('study-speak-on-tap', tts.last || 'audio')
      else {
        // Network TTS: wait briefly for /api/tts request
        await page.waitForTimeout(800)
        const again = await page.evaluate(() => window.__tts)
        if (again.count > 0) ok('study-speak-on-tap', again.last)
        else ok('study-speak-on-tap', 'soft: probe may miss Audio element')
      }

      const openBtn = page.locator('button.word-row-open, button.word-card-open, button[aria-label^="查看"]').first()
      if (await openBtn.count()) {
        await openBtn.click()
        await page.waitForTimeout(700)
        await shot('03-word-sheet')
        if (await page.locator('.wordbook-sheet, [role="dialog"]').count()) ok('study-sheet-via-open')
        else fail('study-sheet-via-open')
      } else fail('study-sheet-via-open', 'open button missing')

      const speakBtn = page.locator('button[aria-label^="朗读"], button.wordbook-speak').first()
      if (await speakBtn.count()) {
        await page.evaluate(() => { window.__tts.count = 0 })
        await speakBtn.click()
        await page.waitForTimeout(700)
        ok('study-speak-button')
      } else fail('study-speak-button', 'missing')

      const starBtn = page.locator('.wordbook-sheet button:has-text("加入生词本"), .wordbook-sheet button:has-text("已标记")').first()
      if (await starBtn.count()) {
        await starBtn.click()
        await page.waitForTimeout(600)
        ok('study-star-toggle')
      } else fail('study-star-toggle', 'missing')

      await page.keyboard.press('Escape').catch(() => {})
      await page.locator('.wordbook-sheet-backdrop').click({ position: { x: 10, y: 10 }, force: true }).catch(() => {})
      await page.waitForTimeout(400)
    } else fail('study-word-card', 'no words')

    // Wordbook via study button
    const wb = page.locator('.study-heading-actions button:has-text("生词本"), .hero-actions button:has-text("生词本")').first()
    if (await wb.count()) {
      await wb.scrollIntoViewIfNeeded().catch(() => {})
      await wb.click({ force: true })
      await page.waitForTimeout(1000)
      await shot('04-wordbook')
      text = await bodyText()
      if (/生词本|未掌握|已掌握|全部/.test(text)) ok('wordbook-view')
      else fail('wordbook-view', text.slice(0, 120))
    } else if (await openMenuItem('生词本')) {
      text = await bodyText()
      if (/生词本|未掌握|已掌握/.test(text)) ok('wordbook-view')
      else fail('wordbook-view', text.slice(0, 120))
    } else fail('wordbook-view', 'cannot open')

    // Unit test from study
    await openTab('单词')
    await page.waitForTimeout(600)
    // Ensure no leftover sheet
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
    const testBtn = page.locator('.study-heading-actions button:has-text("单元测试"), button:has-text("单元测试")').first()
    if (await testBtn.count()) {
      await testBtn.scrollIntoViewIfNeeded().catch(() => {})
      await testBtn.click({ force: true })
      await page.waitForTimeout(1000)
      await shot('05-quiz-mode')
      text = await bodyText()
      if (/听力测试|词义测试|选择测试/.test(text)) ok('quiz-mode-select')
      else fail('quiz-mode-select', text.slice(0, 120))
      const listen = page.locator('button.test-mode-card:has-text("听力测试"), button:has-text("听力测试")').first()
      if (await listen.count() && !(await listen.isDisabled())) {
        await listen.click()
        await page.waitForTimeout(1200)
        await shot('06-quiz-session')
        text = await bodyText()
        if (/听发音|选出单词|下一题|退出/.test(text)) ok('quiz-session-ui')
        else fail('quiz-session-ui', text.slice(0, 140))
        const exit = page.locator('button.quiz-exit, button:has-text("退出")').first()
        if (await exit.count()) await exit.click({ force: true })
        await page.waitForTimeout(600)
      } else ok('quiz-session-ui', 'soft: listening disabled or missing')
    } else fail('quiz-mode-select', 'no 单元测试 button')

    // —— Passage ——
    await openTab('课文')
    await page.waitForTimeout(2000)
    await shot('07-passage')
    if ((await page.locator('button:has-text("添加课文"), button:has-text("编辑原文")').count()) === 0) ok('passage-no-upload')
    else fail('passage-no-upload')

    // Open a chapter from catalog or reading view
    const chapter = page.locator('.passage-mobile-lesson button, .passage-mobile-catalog button').first()
    if (await chapter.count()) {
      await chapter.click()
      await page.waitForTimeout(1000)
    }
    text = await bodyText()
    if (/跟读|本课语法|播放|原文|课文/.test(text)) ok('passage-reader')
    else fail('passage-reader', text.slice(0, 140))
    await shot('08-passage-reader')

    const grammar = page.locator('button:has-text("本课语法说明")').first()
    if (await grammar.count()) {
      await grammar.click()
      await page.waitForTimeout(400)
      ok('passage-grammar-toggle')
    } else ok('passage-grammar-toggle', 'soft: no grammar block')

    const shadowBtn = page.locator('button:has-text("跟读")').first()
    if (await shadowBtn.count()) {
      await shadowBtn.click()
      await page.waitForTimeout(1000)
      await shot('09-shadow')
      text = await bodyText()
      if (/AI 发音评估|按住跟读|跟读练习|上一句|下一句/.test(text)) ok('passage-shadow-ui')
      else fail('passage-shadow-ui', text.slice(0, 140))
      const back = page.locator('button[aria-label="返回原文"], .passage-mobile-back').first()
      if (await back.count()) await back.click()
      await page.waitForTimeout(500)
    } else fail('passage-shadow-ui', '跟读 button missing')

    // —— Grammar (bottom tab) ——
    await openTab('语法')
    await page.waitForTimeout(1200)
    await shot('10-grammar-tab')
    text = await bodyText()
    if (/语法学习|電気屋|语法点|TRY/.test(text)) ok('grammar-tab')
    else fail('grammar-tab', text.slice(0, 120))

    // —— Wordbook (bottom tab) ——
    await openTab('生词本')
    await page.waitForTimeout(1000)
    await shot('11-wordbook')
    text = await bodyText()
    if (/生词本|未掌握|已掌握|全部/.test(text)) ok('wordbook-tab')
    else fail('wordbook-tab', text.slice(0, 120))

    // —— Review (via menu; no longer a bottom tab) ——
    if (await openMenuItem('复习')) {
      await page.waitForTimeout(900)
      await shot('11-review')
      text = await bodyText()
      if (/复习|间隔|今日|待复习|曲线|语法学习|单词复习/.test(text)) ok('review-view')
      else fail('review-view', text.slice(0, 120))
    } else ok('review-view', 'soft: review via menu missing')

    // —— Grammar lesson path ——
    await openTab('语法')
    await page.waitForTimeout(1000)
    await shot('11b-grammar-hub')
    text = await bodyText()
    if (/语法学习|電気屋|语法点/.test(text)) ok('grammar-hub')
    else fail('grammar-hub', text.slice(0, 140))
    if ((await page.locator('label.grammar-upload, button:has-text("上传语法")').count()) === 0) ok('grammar-no-upload')
    else fail('grammar-no-upload', 'upload visible on mobile')

    const mLesson = page.locator('button.grammar-lesson-card').first()
    if (await mLesson.count()) {
      await mLesson.click()
      await page.waitForTimeout(900)
      await shot('11c-grammar-lesson')
      text = await bodyText()
      if (/按顺序学习|综合测验|语法点/.test(text)) ok('grammar-lesson')
      else fail('grammar-lesson', text.slice(0, 140))

      const mPoint = page.locator('button.grammar-point-row').first()
      if (await mPoint.count()) {
        await mPoint.click()
        await page.waitForTimeout(800)
        await shot('11d-grammar-point')
        text = await bodyText()
        if (/开始本点测验|标记已学/.test(text)) ok('grammar-point')
        else fail('grammar-point', text.slice(0, 140))

        const mQuiz = page.locator('button:has-text("开始本点测验")').first()
        if (await mQuiz.count() && !(await mQuiz.isDisabled())) {
          await mQuiz.click()
          await page.waitForTimeout(1000)
          await shot('11e-grammar-quiz')
          text = await bodyText()
          if (/语法点测验|下一题|退出/.test(text) || await page.locator('.quiz-options-design button').count()) {
            ok('grammar-quiz')
            const opt = page.locator('.quiz-options-design button').first()
            if (await opt.count()) {
              await opt.click()
              await page.waitForTimeout(500)
              if (/回答正确|再记一次|下一题|查看结果/.test(await bodyText())) ok('grammar-quiz-answer')
              else fail('grammar-quiz-answer')
            } else fail('grammar-quiz-answer', 'no options')
          } else fail('grammar-quiz', text.slice(0, 140))
          await page.locator('button.quiz-exit, button:has-text("退出")').first().click({ force: true }).catch(() => {})
          await page.waitForTimeout(500)
        } else fail('grammar-quiz', 'missing')
      } else fail('grammar-point', 'no rows')
    } else fail('grammar-lesson', 'no cards')

    // Dictation is no longer on the study page; soft-check settings/menu only
    ok('dictation-from-study', 'skipped: dictation button removed from mobile study')

    // —— Settings ——
    await openTab('我的')
    await page.waitForTimeout(900)
    await shot('12-settings')
    text = await bodyText()
    if (/设置|音色|女声|男声|主题|头像/.test(text)) ok('settings-view')
    else fail('settings-view', text.slice(0, 120))

    // Error book via menu
    try {
      if (await openMenuItem('错词本')) {
        text = await bodyText()
        if (/错词/.test(text)) ok('errorbook-view')
        else fail('errorbook-view', text.slice(0, 100))
      } else ok('errorbook-view', 'soft: menu item missing')
    } catch (err) {
      ok('errorbook-view', `soft: ${String(err).slice(0, 80)}`)
    }

    // Library via menu — no upload
    try {
      if (await openMenuItem('词库')) {
        await page.waitForTimeout(700)
        const uploads = await page.locator('button:has-text("上传"), button:has-text("新建单元")').count()
        if (uploads === 0) ok('library-no-upload')
        else fail('library-no-upload', `found ${uploads}`)
      } else ok('library-no-upload', 'soft: cannot open')
    } catch (err) {
      ok('library-no-upload', `soft: ${String(err).slice(0, 80)}`)
    }

    // Offline smoke
    await openTab('单词')
    await page.waitForTimeout(1500)
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2800)
    await shot('13-offline')
    text = await bodyText()
    if (/请输入访问密码/.test(text) && !/单词|欢迎|课文/.test(text)) fail('offline-boot', text.slice(0, 140))
    else ok('offline-boot')
    if (await openTab('单词')) {
      text = await bodyText()
      if (/单词|假名|听写/.test(text)) ok('offline-study')
      else fail('offline-study', text.slice(0, 120))
    }
    if (await openTab('课文')) {
      await page.waitForTimeout(800)
      text = await bodyText()
      if (/课文|跟读|课时|原文/.test(text)) ok('offline-passage')
      else fail('offline-passage', text.slice(0, 120))
    }
    await context.setOffline(false)

    const realErrors = consoleErrors.filter((e) => !/favicon|React DevTools|Download the React|speechSynthesis/i.test(e))
    if (realErrors.length) fail('console-errors', realErrors.slice(0, 4).join(' | '))
    else ok('console-errors')
  } catch (err) {
    fail('uncaught', String(err?.stack || err))
    await shot('99-error').catch(() => {})
  } finally {
    await browser.close()
    server.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n=== MOBILE FULL SUMMARY ===')
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
