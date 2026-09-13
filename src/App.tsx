import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, PanelLeft, PanelLeftClose } from 'lucide-react'
import { apiFetch, apiUrl, AUTH_REQUIRED_EVENT, getAccessToken, setAccessToken } from './api'
import { initialUnits } from './data'
import { HomeView } from './HomeView'
import { SettingsContext, DEFAULT_SETTINGS } from './settings-context'
import type { AppSettings, Unit, View, Word } from './types'
import { DEFAULT_UNIT_THEME, fallbackUnitTheme, isPlaceholderTheme } from './theme'
import { recordQuizAnswer } from './quiz'
import { isCoreLexiconIncomplete } from './lexeme'
import {
  AccessGate, AppHeader, ConfirmDeleteUnitModal, DesktopTopBar, ImportModal,
  LibraryView, MobileTabBar, MobileTopBar, NewUnitModal, ReviewView, SettingsView, StudyView,
  TestView, WordbookView,
} from './app-views'
import { getReviewState, scheduleReview, touchStudyStreak, uid } from './utils'
import type { DictationMode } from './DictationView'

const PassageView = lazy(() => import('./PassageView').then((module) => ({ default: module.PassageView })))
const DictationView = lazy(() => import('./DictationView').then((module) => ({ default: module.DictationView })))
const ErrorBookView = lazy(() => import('./ErrorBookView').then((module) => ({ default: module.ErrorBookView })))

const STORAGE_KEY = 'kotonoha-units-v1'
const SETTINGS_KEY = 'kotonoha-settings-v1'
const SIDEBAR_COLLAPSED_KEY = 'kotonoha-sidebar-collapsed'
const COLORS = ['#dd5b43', '#668b87', '#d39a43', '#786f95', '#6d8d55']

function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
}

function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  const next = { ...DEFAULT_SETTINGS, ...raw }
  const theme = next.theme
  if (theme !== 'aka' && theme !== 'ai' && theme !== 'matcha') next.theme = 'matcha'
  return next
}

function App() {
  const [auth, setAuth] = useState<'checking' | 'needed' | 'ok'>('checking')
  const [units, setUnits] = useState<Unit[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '') } catch { return initialUnits }
  })
  const [unitId, setUnitId] = useState(units[0]?.id || '')
  const [view, setView] = useState<View>('home')
  const [dictationMode, setDictationMode] = useState<DictationMode>('plan')
  const [dictationSeed, setDictationSeed] = useState<Word[]>([])
  const [selectedId, setSelectedId] = useState(units[0]?.words[0]?.id || '')
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importUnitId, setImportUnitId] = useState(unitId)
  const [newUnitOpen, setNewUnitOpen] = useState(false)
  const [pendingDeleteUnit, setPendingDeleteUnit] = useState<Unit | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [toast, setToast] = useState('')
  const [databaseReady, setDatabaseReady] = useState(false)
  const databaseErrorShown = useRef(false)
  const persistPaused = useRef(true)
  const persistBusy = useRef(false)
  const skipNextUnitsPersist = useRef(false)
  const pendingPersist = useRef<{ units: Unit[]; settings: AppSettings } | null>(null)
  const themeRequested = useRef(new Set<string>())
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || ''))
    } catch {
      return DEFAULT_SETTINGS
    }
  })

  useEffect(() => {
    const theme = settings.theme || 'matcha'
    document.documentElement.dataset.theme = theme
    const colors: Record<string, string> = { aka: '#d85b45', ai: '#4b6a9e', matcha: '#7d9159' }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme] || colors.matcha)
  }, [settings.theme])

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const headers: HeadersInit = {}
        const token = getAccessToken()
        if (token) headers.Authorization = `Bearer ${token}`
        const response = await fetch(apiUrl('/api/auth/check'), { headers })
        const data = await response.json()
        if (cancelled) return
        setAuth(!data.required || data.ok ? 'ok' : 'needed')
      } catch {
        if (!cancelled) setAuth('needed')
      }
    }
    check()
    const onNeed = () => setAuth('needed')
    window.addEventListener(AUTH_REQUIRED_EVENT, onNeed)
    return () => {
      cancelled = true
      window.removeEventListener(AUTH_REQUIRED_EVENT, onNeed)
    }
  }, [])

  useEffect(() => {
    if (auth !== 'ok') return
    let cancelled = false
    const hydrate = async () => {
      try {
        const response = await apiFetch('/api/state')
        if (!response.ok) throw new Error('DATABASE_READ_FAILED')
        const stored = await response.json()
        if (cancelled) return
        if (Array.isArray(stored.units) && stored.units.length) {
          setUnits(stored.units)
          setSettings(normalizeSettings(stored.settings))
        } else {
          const seed = await apiFetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units, settings }) })
          if (!seed.ok) throw new Error('DATABASE_SEED_FAILED')
        }
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(SETTINGS_KEY)
        persistPaused.current = true
        setDatabaseReady(true)
        try {
          const hasIncompleteCore = (Array.isArray(stored.units) ? stored.units : units)
            .some((item: { words?: Word[] }) => (item.words || []).some((word) => isCoreLexiconIncomplete(word)))
          if (hasIncompleteCore) {
            for (let step = 0; step < 6; step += 1) {
              const response = await apiFetch('/api/enrich-missing', { method: 'POST' })
              const data = await response.json()
              if (cancelled) return
              if (Array.isArray(data.words) && data.words.length) {
                const byId = new Map((data.words as Word[]).map((word) => [word.id, word]))
                setUnits((current) => current.map((unit) => ({
                  ...unit,
                  words: unit.words.map((word) => {
                    const updated = byId.get(word.id)
                    return updated ? { ...word, ...updated } : word
                  }),
                })))
              }
              if (!response.ok) break
              if (!data.remaining) break
              if (!data.filled && data.remaining > 0) break
            }
          }
        } catch { /* keep whatever the database already has */ }
        if (!cancelled) {
          persistPaused.current = false
          setUnits((current) => current.map((item) => ({ ...item, words: [...item.words] })))
        }
      } catch {
        if (!cancelled) setToast('PostgreSQL 暂时无法连接，本次修改不会被持久化')
      }
    }
    hydrate()
    return () => { cancelled = true }
  }, [auth]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (auth !== 'ok' || !databaseReady) return
    if (persistPaused.current) return
    if (skipNextUnitsPersist.current) {
      skipNextUnitsPersist.current = false
      return
    }
    pendingPersist.current = { units, settings }
    const timer = window.setTimeout(() => {
      const flush = async () => {
        if (persistBusy.current || persistPaused.current) return
        const payload = pendingPersist.current
        if (!payload) return
        pendingPersist.current = null
        persistBusy.current = true
        try {
          // Units sync uses upsert (no full wipe). Settings go with the same snapshot for consistency on structural saves.
          const response = await apiFetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) throw new Error('DATABASE_WRITE_FAILED')
          const stored = await response.json()
          databaseErrorShown.current = false
          if (Number(stored.droppedCount) > 0) {
            setToast(`有 ${stored.droppedCount} 个词未保存（无效或重复）`)
          }
          if (!pendingPersist.current && Array.isArray(stored.units)) {
            persistPaused.current = true
            setUnits(stored.units)
            window.setTimeout(() => { persistPaused.current = false }, 0)
          }
        } catch {
          if (!databaseErrorShown.current) {
            databaseErrorShown.current = true
            setToast('数据写入 PostgreSQL 失败，请检查服务状态')
          }
        } finally {
          persistBusy.current = false
          if (pendingPersist.current) void flush()
        }
      }
      void flush()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [units, databaseReady, auth])

  useEffect(() => {
    if (auth !== 'ok' || !databaseReady || persistPaused.current) return
    const timer = window.setTimeout(() => {
      void apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      }).catch(() => undefined)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [settings, databaseReady, auth])

  const wordPatchTimers = useRef(new Map<string, number>())
  const queueWordPatch = (wordId: string, changes: Partial<Word>) => {
    const previous = wordPatchTimers.current.get(wordId)
    if (previous) window.clearTimeout(previous)
    const timer = window.setTimeout(() => {
      wordPatchTimers.current.delete(wordId)
      void apiFetch(`/api/words/${encodeURIComponent(wordId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      }).catch(() => undefined)
    }, 200)
    wordPatchTimers.current.set(wordId, timer)
  }
  useEffect(() => {
    const unit = units.find((item) => item.id === unitId)
    if (unit && !unit.words.some((word) => word.id === selectedId)) setSelectedId(unit.words[0]?.id || '')
  }, [unitId, units, selectedId])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (auth !== 'ok' || !databaseReady) return
    const pending = units.filter((item) => (
      item.words.length > 0
      && isPlaceholderTheme(item.description)
      && !themeRequested.current.has(item.id)
    ))
    if (!pending.length) return
    pending.forEach((item) => themeRequested.current.add(item.id))
    setUnits((current) => current.map((unit) => {
      if (!pending.some((item) => item.id === unit.id) || !isPlaceholderTheme(unit.description)) return unit
      return { ...unit, description: fallbackUnitTheme(unit.name, unit.words) }
    }))
  }, [auth, databaseReady, units])

  const unit = units.find((item) => item.id === unitId) || units[0]
  const selectedWord = unit?.words.find((word) => word.id === selectedId) || unit?.words[0]
  const starredCount = units.reduce((sum, item) => sum + item.words.filter((word) => word.starred).length, 0)
  const errorBookCount = units.reduce((sum, item) => sum + item.words.filter((word) => word.wrongBook && !word.mastered).length, 0)
  const reviewCount = units.reduce((sum, item) => sum + item.words.filter((word) => getReviewState(word).due).length, 0)
  const missingCoreFields = units.reduce((sum, item) => sum + item.words.filter((word) => isCoreLexiconIncomplete(word)).length, 0)

  const bumpStreak = () => {
    setSettings((current) => {
      const next = touchStudyStreak(current)
      if (
        (next.streakDays || 0) === (current.streakDays || 0)
        && (next.lastStudyDate || '') === (current.lastStudyDate || '')
      ) {
        return current
      }
      return { ...current, ...next }
    })
  }

  const updateWord = (wordId: string, changes: Partial<Word>, targetUnitId = unitId) => {
    skipNextUnitsPersist.current = true
    setUnits((current) => current.map((item) => item.id === targetUnitId
      ? { ...item, words: item.words.map((word) => word.id === wordId ? { ...word, ...changes } : word) }
      : item))
    queueWordPatch(wordId, changes)
    bumpStreak()
  }

  const updateWordById = (wordId: string, updater: (word: Word) => Partial<Word>) => {
    skipNextUnitsPersist.current = true
    setUnits((current) => current.map((item) => ({
      ...item,
      words: item.words.map((word) => {
        if (word.id !== wordId) return word
        const changes = updater(word)
        queueWordPatch(wordId, changes)
        return { ...word, ...changes }
      }),
    })))
  }

  const addUnit = (name: string) => {
    const newUnit: Unit = { id: uid(), name, description: DEFAULT_UNIT_THEME, color: COLORS[units.length % COLORS.length], words: [] }
    void (async () => {
      try {
        const response = await apiFetch('/api/units', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newUnit.id,
            name: newUnit.name,
            description: newUnit.description,
            color: newUnit.color,
            sortOrder: units.length,
          }),
        })
        if (!response.ok) throw new Error('CREATE_UNIT_FAILED')
        skipNextUnitsPersist.current = true
        setUnits((current) => [...current, newUnit])
        setUnitId(newUnit.id)
        setImportUnitId(newUnit.id)
        setNewUnitOpen(false)
        setImportOpen(true)
        setToast('单元已创建，请上传词汇')
      } catch {
        setToast('创建单元失败，请稍后重试')
      }
    })()
  }

  const requestDeleteUnit = (target: Unit) => {
    if (units.length <= 1) {
      setToast('至少需要保留一个单元，无法删除')
      return
    }
    setPendingDeleteUnit(target)
  }

  const deleteUnit = (target: Unit) => {
    if (units.length <= 1) {
      setToast('至少需要保留一个单元，无法删除')
      setPendingDeleteUnit(null)
      return
    }
    void (async () => {
      try {
        const response = await apiFetch(`/api/units/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
        if (!response.ok) throw new Error('DELETE_UNIT_FAILED')
        const remaining = units.filter((item) => item.id !== target.id)
        const nextId = remaining[0]?.id || ''
        skipNextUnitsPersist.current = true
        setUnits(remaining)
        if (unitId === target.id) setUnitId(nextId)
        if (importUnitId === target.id) setImportUnitId(nextId)
        setPendingDeleteUnit(null)
        setToast(`已删除单元「${target.name}」及其中 ${target.words.length} 个单词`)
      } catch {
        setToast('删除单元失败，请稍后重试')
        setPendingDeleteUnit(null)
      }
    })()
  }

  const nav = (next: View) => {
    if (next === 'dictation') {
      setDictationMode('plan')
      setDictationSeed([])
    }
    setView(next)
    setMobileNav(false)
  }

  const openDictation = (mode: DictationMode = 'plan', seed: Word[] = []) => {
    setDictationMode(mode)
    setDictationSeed(seed)
    setView('dictation')
    setMobileNav(false)
  }

  const toggleMastered = (word: Word) => updateWord(word.id, word.mastered
    ? { mastered: false }
    : { mastered: true, ...scheduleReview(word, true) })

  const addImportedWords = (targetUnit: Unit, words: Word[], description?: string) => {
    const nextDescription = description?.trim()
    void (async () => {
      try {
        const response = await apiFetch(`/api/units/${encodeURIComponent(targetUnit.id)}/words`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words, ...(nextDescription ? { description: nextDescription } : {}) }),
        })
        if (!response.ok) throw new Error('APPEND_WORDS_FAILED')
        const data = await response.json() as { words?: Word[]; droppedCount?: number }
        const saved = Array.isArray(data.words) ? data.words : words
        skipNextUnitsPersist.current = true
        setUnits((current) => current.map((item) => item.id === targetUnit.id ? {
          ...item,
          description: nextDescription || item.description,
          words: [...item.words, ...saved],
        } : item))
        if (nextDescription) themeRequested.current.add(targetUnit.id)
        else themeRequested.current.delete(targetUnit.id)
        if (saved[0]) setSelectedId(saved[0].id)
        setImportOpen(false)
        const dropped = Number(data.droppedCount) || 0
        setToast(dropped > 0
          ? `已导入 ${saved.length} 个单词到「${targetUnit.name}」（跳过 ${dropped} 个）`
          : `已导入 ${saved.length} 个单词到「${targetUnit.name}」`)
        // Only backfill missing core fields; optional columns stay empty.
        if (saved.some((word) => isCoreLexiconIncomplete(word))) {
          for (let step = 0; step < 6; step += 1) {
            const enrich = await apiFetch('/api/enrich-missing', { method: 'POST' })
            const payload = await enrich.json()
            if (Array.isArray(payload.words) && payload.words.length) {
              const byId = new Map((payload.words as Word[]).map((word) => [word.id, word]))
              setUnits((current) => current.map((unit) => ({
                ...unit,
                words: unit.words.map((word) => {
                  const updated = byId.get(word.id)
                  return updated ? { ...word, ...updated } : word
                }),
              })))
            }
            if (!enrich.ok || !payload.remaining || (!payload.filled && payload.remaining > 0)) break
          }
        }
      } catch {
        setToast('导入单词失败，请稍后重试')
      }
    })()
  }

  const renameUnit = (targetId: string, name: string) => {
    const next = name.trim()
    if (!next) {
      setToast('单元名称不能为空')
      return
    }
    void (async () => {
      try {
        const response = await apiFetch(`/api/units/${encodeURIComponent(targetId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: next }),
        })
        if (!response.ok) throw new Error('RENAME_UNIT_FAILED')
        skipNextUnitsPersist.current = true
        setUnits((current) => current.map((item) => item.id === targetId ? { ...item, name: next } : item))
        setToast(`单元已重命名为「${next}」`)
      } catch {
        setToast('重命名失败，请稍后重试')
      }
    })()
  }

  const openImport = (targetUnitId = unitId) => {
    setImportUnitId(targetUnitId)
    setImportOpen(true)
  }

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((current) => {
      const next = !current
      writeSidebarCollapsed(next)
      return next
    })
  }

  const importUnit = units.find((item) => item.id === importUnitId) || unit

  if (auth === 'checking') {
    return <div className="access-boot"><span>語</span><p>正在连接言の葉…</p></div>
  }
  if (auth === 'needed') {
    return <AccessGate onUnlock={() => setAuth('ok')} />
  }

  return (
    <SettingsContext.Provider value={settings}>
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <AppHeader
        open={mobileNav} view={view}
        starredCount={starredCount} errorBookCount={errorBookCount} reviewCount={reviewCount}
        onMenu={() => setMobileNav((current) => !current)} onView={nav}
        onCollapse={toggleSidebarCollapsed}
      />
      <div className="workspace">
        <DesktopTopBar
          settings={settings} onView={nav} onSettingsChange={setSettings}
          sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebarCollapsed}
          reviewCount={reviewCount}
        />
        <MobileTopBar view={view} settings={settings} onView={nav} onSettingsChange={setSettings} onMenu={() => setMobileNav((current) => !current)} reviewCount={reviewCount} />
        {missingCoreFields > 0 && (
          <div className="enrich-banner">正在补全核心字段（假名 / 罗马音 / 中文释义 / 例句），还剩 {missingCoreFields} 个。同义词与记忆技巧等可选列不会自动补全。</div>
        )}
        <main className="main">
          {view === 'home' && <HomeView units={units} unit={unit} settings={settings} onView={nav} />}
          {view === 'library' && <LibraryView units={units} unitId={unitId} onUnit={setUnitId} onImport={openImport} onNewUnit={() => setNewUnitOpen(true)} onRenameUnit={renameUnit} onDeleteUnit={requestDeleteUnit} />}
          {view === 'study' && unit && (
            <StudyView
              unit={unit} units={units} selectedWord={selectedWord} onUnit={setUnitId}
              onSelect={setSelectedId} onImport={() => openImport()}
              onToggleMastered={toggleMastered}
              onEdit={(word, changes) => updateWord(word.id, changes)}
              onToggleStar={(word) => { updateWord(word.id, { starred: !word.starred }); setToast(word.starred ? '已移出生词本' : '已加入生词本') }}
              search={search} onSearch={setSearch}
              onTest={() => setView('test')}
              onDictation={() => openDictation('plan')}
            />
          )}
          {view === 'test' && unit && <TestView unit={unit} units={units} onUnit={setUnitId} onBack={() => setView('study')} onAnswer={(word, kind, correct) => updateWord(word.id, recordQuizAnswer(word, kind, correct))} />}
          {view === 'dictation' && unit && (
            <Suspense fallback={<div className="wide-empty compact"><b>加载中…</b></div>}>
              <DictationView
                key={`${dictationMode}-${dictationSeed.length}-${dictationSeed[0]?.id || unit.id}`}
                unit={unit} units={units} mode={dictationMode} seedWords={dictationSeed}
                autoStart={dictationMode === 'errors' && dictationSeed.length > 0}
                onUnit={setUnitId}
                onBack={() => setView(dictationMode === 'errors' ? 'errorbook' : 'study')}
                onCorrect={(word) => updateWordById(word.id, (live) => ({
                  ...recordQuizAnswer(live, 'listening', true),
                  mastered: live.mastered,
                  ...(dictationMode === 'errors' ? { errorReviewed: true } : {}),
                }))}
                onMiss={(word) => updateWordById(word.id, (live) => ({
                  ...recordQuizAnswer(live, 'listening', false),
                  wrongBook: true,
                  dictationMisses: Math.min(99, (live.dictationMisses || 0) + 1),
                  ...(dictationMode === 'errors' ? { errorReviewed: true } : {}),
                }))}
                onMaster={(word) => updateWordById(word.id, (live) => ({ mastered: true, ...scheduleReview(live, true) }))}
                onOpenErrorBook={() => nav('errorbook')}
                onOpenTest={() => nav('test')}
                onOpenStudy={() => nav('study')}
              />
            </Suspense>
          )}
          {view === 'wordbook' && <WordbookView units={units} onRemove={(wordId, targetUnitId) => { updateWord(wordId, { starred: false }, targetUnitId); setToast('已移出生词本') }} />}
          {view === 'errorbook' && (
            <Suspense fallback={<div className="wide-empty compact"><b>加载中…</b></div>}>
              <ErrorBookView
                units={units}
                onBack={() => nav('study')}
                onStart={(words) => openDictation('errors', words)}
                onRemove={(wordId, targetUnitId) => { updateWord(wordId, { wrongBook: false, dictationMisses: 0, errorReviewed: false }, targetUnitId); setToast('已移出错词本') }}
                onMaster={(word, targetUnitId) => { updateWord(word.id, { mastered: true, ...scheduleReview(word, true) }, targetUnitId); setToast('已标记掌握') }}
              />
            </Suspense>
          )}
          {view === 'review' && <ReviewView units={units} onReview={(word, targetUnitId, remembered) => { updateWord(word.id, { mastered: remembered || word.mastered, ...scheduleReview(word, remembered) }, targetUnitId); setToast(remembered ? '已安排下一次复习' : '10 分钟后会再次提醒') }} />}
          {view === 'passage' && (
            <Suspense fallback={<div className="wide-empty compact"><b>加载中…</b></div>}>
              <PassageView />
            </Suspense>
          )}
          {view === 'settings' && <SettingsView settings={settings} onChange={setSettings} starredCount={starredCount} errorBookCount={errorBookCount} onView={nav} />}
        </main>
      </div>
      <MobileTabBar view={view} reviewCount={reviewCount} onView={nav} />

      {importOpen && importUnit && <ImportModal unit={importUnit} onClose={() => setImportOpen(false)} onImported={(words, description) => addImportedWords(importUnit, words, description)} />}
      {newUnitOpen && <NewUnitModal onClose={() => setNewUnitOpen(false)} onCreate={addUnit} />}
      {pendingDeleteUnit && <ConfirmDeleteUnitModal unit={pendingDeleteUnit} onlyUnit={units.length <= 1} onClose={() => setPendingDeleteUnit(null)} onConfirm={() => deleteUnit(pendingDeleteUnit)} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单" />}
    </div>
    </SettingsContext.Provider>
  )
}

export default App

