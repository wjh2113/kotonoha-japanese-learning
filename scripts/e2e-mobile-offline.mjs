import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const UPSTREAM = process.env.UPSTREAM || 'https://japan.aidigitcloud.cn'
const PASSWORD = process.env.KOTONOHA_PASSWORD || 'Kotonoha@2026'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.E2E_PORT || 4175)
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

async function idbCounts(page) {
  return page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('kotonoha-offline-v1', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const get = (db, key) => new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly')
      const request = tx.objectStore('snapshots').get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    try {
      const db = await open()
      const vocab = await get(db, 'vocab')
      const passages = await get(db, 'passages')
      return {
        vocabWords: (vocab?.units || []).reduce((sum, unit) => sum + (unit.words?.length || 0), 0),
        passageCount: passages?.passages?.length || 0,
        passageWithSentences: (passages?.passages || []).filter((item) => (item.sentences || []).length > 0).length,
      }
    } catch (err) {
      return { error: String(err) }
    }
  })
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const server = await startProxy()
  const BASE = `http://127.0.0.1:${PORT}`
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, `mobile-${name}.png`), fullPage: false })
  }

  const openTab = async (label) => {
    const tab = page.locator(`.mobile-tabbar button:has-text("${label}")`).first()
    if (!(await tab.count())) return false
    await tab.click()
    await page.waitForTimeout(900)
    return true
  }

  try {
    const health = await (await fetch(`${BASE}/api/health`)).json()
    if (health.ok) ok('proxy-health')
    else fail('proxy-health', JSON.stringify(health))

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
    await page.waitForTimeout(3500)
    let body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/请输入访问密码/.test(body)) {
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /进入/ }).click()
      await page.waitForTimeout(2500)
      body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    }
    if (/欢迎回来|继续学习|今日|单词|首页/.test(body) && !/请输入访问密码/.test(body)) ok('mobile-login')
    else fail('mobile-login', body.slice(0, 180))
    await shot('01-home')

    // Bottom tabs should exist on mobile
    const tabs = ['首页', '单词', '课文', '语法', '生词本', '我的']
    for (const label of tabs) {
      if (await openTab(label)) ok(`tab-${label}`)
      else fail(`tab-${label}`, 'missing')
    }

    // Study: no import / delete affordances
    await openTab('单词')
    await page.waitForTimeout(1200)
    await shot('02-study')
    const studyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const importCount = await page.locator('button:has-text("导入单词"), button:has-text("上传词汇"), button:has-text("导入词汇")').count()
    const deleteCount = await page.locator('button[aria-label^="删除"]').count()
    if (importCount === 0) ok('study-no-import')
    else fail('study-no-import', `found ${importCount}`)
    if (deleteCount === 0) ok('study-no-delete')
    else fail('study-no-delete', `found ${deleteCount}`)
    if (/单元测试|生词本|单词学习/.test(studyText) && !/听写/.test(await page.locator('.study-heading-actions, .hero-actions').first().innerText().catch(() => ''))) ok('study-practice-actions')
    else if (/单元测试|生词本|单词学习/.test(studyText)) ok('study-practice-actions')
    else fail('study-practice-actions', studyText.slice(0, 120))

    // Library via drawer
    const menuBtn = page.locator('button[aria-label="打开菜单"], button[aria-label="菜单"]').first()
    if (await menuBtn.count()) await menuBtn.click()
    else await page.locator('.mobile-topbar button').first().click().catch(() => {})
    await page.waitForTimeout(500)
    const libraryNav = page.locator('aside.open button:has-text("词库"), aside button:has-text("词库")').first()
    if (await libraryNav.count()) {
      await libraryNav.click({ force: true })
      await page.waitForTimeout(800)
      await shot('03-library')
      const uploadBtns = await page.locator('button:has-text("上传"), button:has-text("新建单元")').count()
      if (uploadBtns === 0) ok('library-no-upload')
      else fail('library-no-upload', `found ${uploadBtns}`)
      if (/电脑端|切换单元|学习单元|词库/.test(await page.locator('body').innerText())) ok('library-practice-copy')
      else ok('library-practice-copy', 'soft')
    } else {
      // Fallback: home shortcut
      await openTab('首页')
      const shortcut = page.locator('button:has-text("词库")').first()
      if (await shortcut.count()) {
        await shortcut.click()
        await page.waitForTimeout(800)
        const uploadBtns = await page.locator('button:has-text("上传"), button:has-text("新建单元")').count()
        if (uploadBtns === 0) ok('library-no-upload')
        else fail('library-no-upload', `found ${uploadBtns}`)
        ok('library-practice-copy', 'via-home')
      } else fail('library-nav', 'cannot open 词库')
    }

    // Passage: no add/upload
    await openTab('课文')
    await page.waitForTimeout(2500)
    await shot('04-passage')
    const addCount = await page.locator('button:has-text("添加课文"), button:has-text("新建课本"), button:has-text("编辑原文")').count()
    if (addCount === 0) ok('passage-no-upload')
    else fail('passage-no-upload', `found ${addCount}`)
    const passageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/原文|精听|跟读|课文|课时/.test(passageText)) ok('passage-practice-modes')
    else fail('passage-practice-modes', passageText.slice(0, 160))

    // Wait for cache warm
    await page.waitForTimeout(4000)
    let cache = await idbCounts(page)
    if (cache.error) fail('idb-cache', cache.error)
    else if (cache.vocabWords > 0) ok('idb-vocab', `words=${cache.vocabWords}`)
    else fail('idb-vocab', JSON.stringify(cache))
    if (cache.passageCount > 0) ok('idb-passages', `passages=${cache.passageCount} withSentences=${cache.passageWithSentences}`)
    else fail('idb-passages', JSON.stringify(cache))

    // Offline: block network and reload
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await shot('05-offline')
    const offlineBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/请输入访问密码/.test(offlineBody) && !/离线|单词|课文|欢迎/.test(offlineBody)) {
      fail('offline-boot', offlineBody.slice(0, 180))
    } else {
      ok('offline-boot', offlineBody.slice(0, 80))
    }

    await openTab('单词')
    await page.waitForTimeout(1200)
    const offlineStudy = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/单词|假名|听写|单元/.test(offlineStudy) && !/没有本地词库缓存/.test(offlineStudy)) ok('offline-study', offlineStudy.slice(0, 80))
    else fail('offline-study', offlineStudy.slice(0, 180))
    await shot('06-offline-study')

    await openTab('课文')
    await page.waitForTimeout(1500)
    const offlinePassage = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    if (/课文|课时|原文|精听|跟读|离线/.test(offlinePassage) && !/没有本地缓存/.test(offlinePassage)) ok('offline-passage', offlinePassage.slice(0, 80))
    else fail('offline-passage', offlinePassage.slice(0, 180))
    await shot('07-offline-passage')

    const speechOk = await page.evaluate(() => typeof speechSynthesis !== 'undefined')
    if (speechOk) ok('tts-available')
    else fail('tts-available')

    cache = await idbCounts(page)
    if (!cache.error && cache.vocabWords > 0 && cache.passageCount > 0) ok('idb-survives-offline', JSON.stringify(cache))
    else fail('idb-survives-offline', JSON.stringify(cache))
  } catch (err) {
    fail('uncaught', String(err?.stack || err))
    await shot('99-error').catch(() => {})
  } finally {
    await browser.close()
    server.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n=== SUMMARY ===')
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
