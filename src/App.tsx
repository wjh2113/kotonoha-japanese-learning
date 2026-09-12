import { useContext, useEffect, useRef, useState } from 'react'
import {
  AudioLines, BookMarked, BookOpen, BrainCircuit, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, FileText, GraduationCap, Headphones, Import, Keyboard, LayoutGrid, LibraryBig, List, Menu,
  Mic, NotebookPen, Pause, Plus, Search, Settings, Sparkles, SquarePen,
  Trash2, Trophy, UploadCloud, UserRound, Volume2, X,
} from 'lucide-react'
import { apiFetch, AUTH_REQUIRED_EVENT, getAccessToken, setAccessToken } from './api'
import { initialUnits } from './data'
import { readVocabularyFile } from './docx'
import { PassageView } from './PassageView'
import { DictationView, type DictationMode } from './DictationView'
import { ErrorBookView } from './ErrorBookView'
import { SettingsContext, DEFAULT_SETTINGS } from './settings-context'
import { loadSpeechVoices, selectJapaneseVoice, speakJapanese } from './speech'
import type { AppSettings, ImportDraft, Unit, View, Word } from './types'
import { DEFAULT_UNIT_THEME, fallbackUnitTheme, isPlaceholderTheme } from './theme'
import { buildQuizOptions, ENRICH_BATCH_SIZE, isPlaceholderMeaning, mergeEnrichedWord, optionLabel, orderQuizByWeakness, recordQuizAnswer, sharedDistractors, usableQuizWords } from './quiz'
import { usePronunciationPractice } from './pronunciation-practice'
import { formatReviewTime, getReviewState, makeFallbackWord, matchesTypingAnswer, parseVocabulary, pronunciationScore, REVIEW_INTERVAL_DAYS, scheduleReview, splitWordList, toRomaji, uid } from './utils'

const STORAGE_KEY = 'kotonoha-units-v1'
const SETTINGS_KEY = 'kotonoha-settings-v1'
const COLORS = ['#dd5b43', '#668b87', '#d39a43', '#786f95', '#6d8d55']

function App() {
  const [auth, setAuth] = useState<'checking' | 'needed' | 'ok'>('checking')
  const [units, setUnits] = useState<Unit[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '') } catch { return initialUnits }
  })
  const [unitId, setUnitId] = useState(units[0]?.id || '')
  const [view, setView] = useState<View>('study')
  const [dictationMode, setDictationMode] = useState<DictationMode>('plan')
  const [dictationSeed, setDictationSeed] = useState<Word[]>([])
  const [selectedId, setSelectedId] = useState(units[0]?.words[0]?.id || '')
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importUnitId, setImportUnitId] = useState(unitId)
  const [newUnitOpen, setNewUnitOpen] = useState(false)
  const [pendingDeleteUnit, setPendingDeleteUnit] = useState<Unit | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [databaseReady, setDatabaseReady] = useState(false)
  const databaseErrorShown = useRef(false)
  const persistPaused = useRef(true)
  const persistBusy = useRef(false)
  const pendingPersist = useRef<{ units: Unit[]; settings: AppSettings } | null>(null)
  const themeRequested = useRef(new Set<string>())
  const [settings, setSettings] = useState<AppSettings>(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '') } } catch { return DEFAULT_SETTINGS }
  })

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const headers: HeadersInit = {}
        const token = getAccessToken()
        if (token) headers.Authorization = `Bearer ${token}`
        const response = await fetch('/api/auth/check', { headers })
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
          setSettings({ ...DEFAULT_SETTINGS, ...stored.settings })
        } else {
          const seed = await apiFetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units, settings }) })
          if (!seed.ok) throw new Error('DATABASE_SEED_FAILED')
        }
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(SETTINGS_KEY)
        persistPaused.current = true
        setDatabaseReady(true)
        try {
          const hasPlaceholders = (Array.isArray(stored.units) ? stored.units : units)
            .some((item: { words?: { meaning?: string }[] }) => (item.words || []).some((word) => isPlaceholderMeaning(word.meaning)))
          if (hasPlaceholders) {
            for (let step = 0; step < 6; step += 1) {
              const response = await apiFetch('/api/enrich-missing', { method: 'POST' })
              const data = await response.json()
              if (cancelled) return
              if (Array.isArray(data.units) && data.units.length) setUnits(data.units)
              if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings })
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
    pendingPersist.current = { units, settings }
    const timer = window.setTimeout(() => {
      const flush = async () => {
        if (persistBusy.current || persistPaused.current) return
        const payload = pendingPersist.current
        if (!payload) return
        pendingPersist.current = null
        persistBusy.current = true
        try {
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
          // Apply server-normalized snapshot only when nothing newer is queued.
          if (!pendingPersist.current && Array.isArray(stored.units)) {
            persistPaused.current = true
            setUnits(stored.units)
            if (stored.settings) setSettings({ ...DEFAULT_SETTINGS, ...stored.settings })
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
  }, [units, settings, databaseReady, auth])
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
  const missingMeanings = units.reduce((sum, item) => sum + item.words.filter((word) => isPlaceholderMeaning(word.meaning)).length, 0)

  const updateWord = (wordId: string, changes: Partial<Word>, targetUnitId = unitId) => {
    setUnits((current) => current.map((item) => item.id === targetUnitId
      ? { ...item, words: item.words.map((word) => word.id === wordId ? { ...word, ...changes } : word) }
      : item))
  }

  const updateWordById = (wordId: string, updater: (word: Word) => Partial<Word>) => {
    setUnits((current) => current.map((item) => ({
      ...item,
      words: item.words.map((word) => word.id === wordId ? { ...word, ...updater(word) } : word),
    })))
  }

  const addUnit = (name: string) => {
    const newUnit: Unit = { id: uid(), name, description: DEFAULT_UNIT_THEME, color: COLORS[units.length % COLORS.length], words: [] }
    setUnits((current) => [...current, newUnit])
    setUnitId(newUnit.id)
    setImportUnitId(newUnit.id)
    setNewUnitOpen(false)
    setImportOpen(true)
    setToast('单元已创建，请上传词汇')
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
    const remaining = units.filter((item) => item.id !== target.id)
    const nextId = remaining[0]?.id || ''
    setUnits(remaining)
    if (unitId === target.id) setUnitId(nextId)
    if (importUnitId === target.id) setImportUnitId(nextId)
    setPendingDeleteUnit(null)
    setToast(`已删除单元「${target.name}」及其中 ${target.words.length} 个单词`)
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
    setUnits((current) => current.map((item) => item.id === targetUnit.id ? {
      ...item,
      description: nextDescription || item.description,
      words: [...item.words, ...words],
    } : item))
    if (nextDescription) themeRequested.current.add(targetUnit.id)
    else themeRequested.current.delete(targetUnit.id)
    if (words[0]) setSelectedId(words[0].id)
    setImportOpen(false)
    setToast(`已导入 ${words.length} 个单词到「${targetUnit.name}」`)
  }

  const renameUnit = (targetId: string, name: string) => {
    const next = name.trim()
    if (!next) {
      setToast('单元名称不能为空')
      return
    }
    setUnits((current) => current.map((item) => item.id === targetId ? { ...item, name: next } : item))
    setToast(`单元已重命名为「${next}」`)
  }

  const openImport = (targetUnitId = unitId) => {
    setImportUnitId(targetUnitId)
    setImportOpen(true)
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
    <div className="app-shell">
      <AppHeader
        open={mobileNav} view={view} settings={settings}
        starredCount={starredCount} errorBookCount={errorBookCount} reviewCount={reviewCount}
        onMenu={() => setMobileNav((current) => !current)} onView={nav}
      />
      <MobileTopBar view={view} settings={settings} onView={nav} />
      {missingMeanings > 0 && (
        <div className="enrich-banner">正在补全全部单词释义，还剩 {missingMeanings} 个。补完后测试会覆盖整个单元。</div>
      )}
      <main className="main">
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
        )}
        {view === 'wordbook' && <WordbookView units={units} onRemove={(wordId, targetUnitId) => { updateWord(wordId, { starred: false }, targetUnitId); setToast('已移出生词本') }} />}
        {view === 'errorbook' && (
          <ErrorBookView
            units={units}
            onBack={() => nav('study')}
            onStart={(words) => openDictation('errors', words)}
            onRemove={(wordId, targetUnitId) => { updateWord(wordId, { wrongBook: false, dictationMisses: 0, errorReviewed: false }, targetUnitId); setToast('已移出错词本') }}
            onMaster={(word, targetUnitId) => { updateWord(word.id, { mastered: true, ...scheduleReview(word, true) }, targetUnitId); setToast('已标记掌握') }}
          />
        )}
        {view === 'review' && <ReviewView units={units} onReview={(word, targetUnitId, remembered) => { updateWord(word.id, { mastered: remembered || word.mastered, ...scheduleReview(word, remembered) }, targetUnitId); setToast(remembered ? '已安排下一次复习' : '10 分钟后会再次提醒') }} />}
        {view === 'passage' && <PassageView units={units} onAddWords={(targetUnitId, words) => {
          const target = units.find((item) => item.id === targetUnitId)
          if (target) addImportedWords(target, words)
        }} />}
        {view === 'settings' && <SettingsView settings={settings} onChange={setSettings} starredCount={starredCount} errorBookCount={errorBookCount} onView={nav} />}
      </main>
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

function AppHeader({ open, view, settings, starredCount, errorBookCount, reviewCount, onMenu, onView }: {
  open: boolean; view: View; settings: AppSettings; starredCount: number; errorBookCount: number; reviewCount: number
  onMenu: () => void; onView: (view: View) => void
}) {
  const items: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'library', label: '词库', icon: <LibraryBig size={17} /> },
    { id: 'passage', label: '课文', icon: <FileText size={17} /> },
    { id: 'study', label: '学习', icon: <BookOpen size={17} /> },
    { id: 'test', label: '测试', icon: <GraduationCap size={17} /> },
    { id: 'dictation', label: '听写', icon: <Keyboard size={17} /> },
    { id: 'wordbook', label: '生词本', icon: <BookMarked size={17} />, count: starredCount },
    { id: 'errorbook', label: '错词本', icon: <NotebookPen size={17} />, count: errorBookCount },
    { id: 'review', label: '待复习', icon: <Clock3 size={17} />, count: reviewCount },
    { id: 'settings', label: '设置', icon: <Settings size={17} /> },
  ]
  return (
    <header className="app-header">
      <button className="header-menu" onClick={onMenu} aria-label="打开菜单"><Menu size={21} /></button>
      <button className="header-brand" onClick={() => onView('study')}><span>語</span><b>日语单词学习</b></button>
      <nav className={`header-nav ${open ? 'open' : ''}`}>
        {items.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)}>{item.icon}<span>{item.label}</span>{Boolean(item.count) && <em>{item.count}</em>}</button>)}
      </nav>
      <button className="header-avatar" onClick={() => onView('settings')} aria-label="打开设置"><span>{settings.avatar}</span></button>
    </header>
  )
}

const VIEW_TITLES: Record<View, string> = {
  library: '词库', study: '学习', passage: '课文', test: '测试', dictation: '听写', wordbook: '生词本', errorbook: '错词本', review: '待复习', settings: '我的',
}

function MobileTopBar({ view, settings, onView }: { view: View; settings: AppSettings; onView: (view: View) => void }) {
  return (
    <header className="mobile-topbar">
      <div className="mobile-brand"><span>語</span><b>{VIEW_TITLES[view]}</b></div>
      <button className="header-avatar" onClick={() => onView('settings')} aria-label="打开我的"><span>{settings.avatar}</span></button>
    </header>
  )
}

function MobileTabBar({ view, reviewCount, onView }: { view: View; reviewCount: number; onView: (view: View) => void }) {
  const items: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'study', label: '学习', icon: <BookOpen size={21} /> },
    { id: 'dictation', label: '听写', icon: <Keyboard size={21} /> },
    { id: 'library', label: '词库', icon: <LibraryBig size={21} /> },
    { id: 'passage', label: '课文', icon: <FileText size={21} /> },
    { id: 'review', label: '复习', icon: <Clock3 size={21} />, count: reviewCount },
    { id: 'settings', label: '我的', icon: <UserRound size={21} /> },
  ]
  const active = view === 'wordbook' || view === 'errorbook' || view === 'test' ? '' : view
  return (
    <nav className="mobile-tabbar" aria-label="应用导航">
      {items.map((item) => (
        <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onView(item.id)}>
          <span className="tab-icon">{item.icon}{Boolean(item.count) && <em>{(item.count || 0) > 99 ? '99+' : item.count}</em>}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function PageUnitSelect({ units, unit, onUnit, label }: { units: Unit[]; unit: Unit; onUnit: (id: string) => void; label: string }) {
  return <label className="page-unit-select"><span>{label}</span><select aria-label={label} value={unit.id} onChange={(event) => onUnit(event.target.value)}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
}

function LibraryView({ units, unitId, onUnit, onImport, onNewUnit, onRenameUnit, onDeleteUnit }: {
  units: Unit[]; unitId: string; onUnit: (id: string) => void; onImport: (unitId?: string) => void; onNewUnit: () => void
  onRenameUnit: (unitId: string, name: string) => void; onDeleteUnit: (unit: Unit) => void
}) {
  const total = units.reduce((sum, item) => sum + item.words.length, 0)
  const mastered = units.reduce((sum, item) => sum + item.words.filter((word) => word.mastered).length, 0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const commitRename = (unit: Unit) => {
    const next = draftName.trim()
    setEditingId(null)
    if (!next || next === unit.name) return
    onRenameUnit(unit.id, next)
  }
  return (
    <div className="page hub-page">
      <section className="hub-hero">
        <div><span className="eyebrow">VOCABULARY LIBRARY</span><h1>我的词库</h1><p>按单元管理词汇，并从 Word、TXT、CSV 或 JSON 批量导入。</p></div>
        <div className="hero-actions"><button className="secondary-button" onClick={onNewUnit}><Plus size={17} />新建单元</button><button className="primary-button" onClick={() => onImport(unitId)}><UploadCloud size={17} />上传到当前单元</button></div>
      </section>
      <div className="metric-row"><div><LibraryBig /><span><b>{units.length}</b><small>学习单元</small></span></div><div><BookOpen /><span><b>{total}</b><small>全部单词</small></span></div><div><CheckCircle2 /><span><b>{mastered}</b><small>已经掌握</small></span></div></div>
      <section className="unit-cards">
        {units.map((item, index) => {
          const learned = item.words.filter((word) => word.mastered).length
          const percent = Math.round(learned / Math.max(item.words.length, 1) * 100)
          return <article key={item.id} className={`unit-card ${item.id === unitId ? 'active' : ''}`} onClick={() => onUnit(item.id)}>
            <div className="unit-card-top"><span style={{ background: item.color }}>{String(index + 1).padStart(2, '0')}</span><em>{item.id === unitId ? '当前单元' : '选择单元'}</em></div>
            <div className="unit-card-title" onClick={(event) => event.stopPropagation()}>
              {editingId === item.id ? (
                <input
                  className="unit-name-input"
                  autoFocus
                  value={draftName}
                  aria-label="单元名称"
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => commitRename(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename(item)
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditingId(null)
                    }
                  }}
                />
              ) : (
                <>
                  <h2>{item.name}</h2>
                  <button
                    type="button"
                    className="unit-rename-btn"
                    aria-label={`修改「${item.name}」名称`}
                    title="修改名称"
                    onClick={() => { setEditingId(item.id); setDraftName(item.name) }}
                  >
                    <SquarePen size={15} />
                  </button>
                </>
              )}
            </div>
            <p className={isPlaceholderTheme(item.description) ? 'unit-theme pending' : 'unit-theme'}>
              {item.words.length && isPlaceholderTheme(item.description) ? '主题归纳中…' : item.description}
            </p>
            <div className="unit-card-meta"><span>{item.words.length} 个单词</span><span>{learned} 个已掌握</span></div>
            <div className="unit-progress"><i style={{ width: `${percent}%`, background: item.color }} /></div>
            <div className="unit-card-actions">
              <button onClick={(event) => { event.stopPropagation(); onUnit(item.id); onImport(item.id) }}><UploadCloud size={15} />上传词汇</button>
              <button className="danger-button" onClick={(event) => { event.stopPropagation(); onDeleteUnit(item) }}><Trash2 size={15} />删除单元</button>
            </div>
          </article>
        })}
        <button className="unit-card add-unit-card" onClick={onNewUnit}><Plus size={26} /><b>创建新单元</b><span>按主题整理你的学习内容</span></button>
      </section>
    </div>
  )
}

function StudyView({ unit, units, selectedWord, search, onUnit, onSelect, onImport, onToggleMastered, onEdit, onToggleStar, onSearch, onTest, onDictation }: {
  unit: Unit; units: Unit[]; selectedWord?: Word; search: string; onUnit: (id: string) => void; onSelect: (id: string) => void; onImport: () => void
  onToggleMastered: (word: Word) => void; onEdit: (word: Word, changes: Partial<Word>) => void
  onToggleStar: (word: Word) => void; onSearch: (value: string) => void; onTest: () => void; onDictation: () => void
}) {
  const { voiceGender } = useContext(SettingsContext)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const filtered = unit.words.filter((word) => {
    const matches = `${word.term}${word.reading}${word.meaning}`.toLowerCase().includes(search.toLowerCase())
    return matches && (filter === 'all' || (filter === 'mastered' ? word.mastered : !word.mastered))
  })
  const mastered = unit.words.filter((word) => word.mastered).length
  const percent = Math.round(mastered / Math.max(unit.words.length, 1) * 100)
  const selectedIndex = selectedWord ? filtered.findIndex((word) => word.id === selectedWord.id) : -1

  return (
    <div className="page study-page">
      <section className="page-intro">
        <div>
          <div className="eyebrow"><span style={{ background: unit.color }} /> VOCABULARY UNIT</div>
          <PageUnitSelect units={units} unit={unit} onUnit={onUnit} label="学习单元" />
          <p>{isPlaceholderTheme(unit.description) ? '主题归纳中' : unit.description} · 共 {unit.words.length} 个单词</p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" onClick={onDictation}><Keyboard size={18} />听写</button>
          <button className="secondary-button" onClick={onTest}><GraduationCap size={18} />单元测试</button>
          <button className="primary-button" onClick={onImport}><UploadCloud size={18} />导入单词</button>
        </div>
      </section>

      <label className="study-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索当前单元的单词、假名或释义…" /></label>

      <section className="overview-card">
        <div className="overview-copy"><span>单元学习进度</span><b>{percent}%</b></div>
        <div className="overview-bar"><i style={{ width: `${percent}%`, background: unit.color }} /></div>
        <div className="overview-meta"><span><i className="dot learned" />已掌握 {mastered}</span><span><i className="dot learning" />学习中 {unit.words.length - mastered}</span><em>上次学习：今天</em></div>
      </section>

      <div className="content-columns">
        <section className="word-library">
          <div className="section-toolbar">
            <div className="filter-tabs">
              {([['all', '全部'], ['learning', '学习中'], ['mastered', '已掌握']] as const).map(([id, label]) => (
                <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}<span>{id === 'all' ? unit.words.length : id === 'mastered' ? mastered : unit.words.length - mastered}</span></button>
              ))}
            </div>
            <div className="view-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={17} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={18} /></button></div>
          </div>
          {filtered.length ? (
            <div className={`word-grid ${layout === 'list' ? 'word-list' : ''}`}>
              {filtered.map((word) => <WordCard key={word.id} word={word} active={selectedWord?.id === word.id} onClick={() => onSelect(word.id)} />)}
            </div>
          ) : <EmptyState onImport={onImport} />}
        </section>
        <aside className="detail-column">
          {selectedWord ? <WordDetail
            word={selectedWord} onToggle={() => onToggleMastered(selectedWord)} onToggleStar={() => onToggleStar(selectedWord)}
            onEdit={(changes) => onEdit(selectedWord, changes)}
            position={selectedIndex >= 0 ? selectedIndex + 1 : 0} total={filtered.length}
            onPrevious={() => {
              if (selectedIndex <= 0) return
              const previous = filtered[selectedIndex - 1]
              onSelect(previous.id)
              void speakJapanese(previous.term, voiceGender)
            }}
            onNext={() => {
              if (selectedIndex < 0 || selectedIndex >= filtered.length - 1) return
              const next = filtered[selectedIndex + 1]
              onSelect(next.id)
              void speakJapanese(next.term, voiceGender)
            }}
          /> : <EmptyDetail onImport={onImport} />}
        </aside>
      </div>
    </div>
  )
}

function WordCard({ word, active, onClick }: { word: Word; active: boolean; onClick: () => void }) {
  return (
    <div className={`word-card ${active ? 'active' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() }
    }}>
      <span className={`status-pill ${word.mastered ? 'mastered' : ''}`}>{word.mastered ? '已掌握' : '学习中'}</span>
      <b className="jp word-term">{word.term}</b>
      <span className="jp word-reading">{word.reading}</span>
      {(word.romaji || toRomaji(word.reading)) && <span className="romaji word-romaji">{word.romaji || toRomaji(word.reading)}</span>}
      <span className="word-meaning">{word.meaning}</span>
      <span className="card-bottom"><em>{word.partOfSpeech.split('・')[0]}</em><VolumeButton word={word} small /></span>
    </div>
  )
}

function VolumeButton({ word, small = false, sentence = false }: { word: Word; small?: boolean; sentence?: boolean }) {
  const [speaking, setSpeaking] = useState(false)
  const { voiceGender } = useContext(SettingsContext)
  const speak = async (event: React.MouseEvent) => {
    event.stopPropagation()
    await speakJapanese(sentence ? word.example : word.term, voiceGender, {
      sentence,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    })
  }
  return <button className={`volume-button ${small ? 'small' : ''} ${speaking ? 'speaking' : ''}`} onClick={speak} aria-label="朗读">{speaking ? <Pause size={small ? 14 : 19} /> : <Volume2 size={small ? 14 : 19} />}</button>
}

function WordDetail({ word, onToggle, onToggleStar, onEdit, position, total, onPrevious, onNext }: {
  word: Word; onToggle: () => void; onToggleStar: () => void; onEdit: (changes: Partial<Word>) => void
  position: number; total: number; onPrevious: () => void; onNext: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(word)
  const [typing, setTyping] = useState('')
  const [typingResult, setTypingResult] = useState<'correct' | 'wrong' | null>(null)
  const [practiceOpen, setPracticeOpen] = useState(false)
  useEffect(() => { setDraft(word); setEditing(false); setTyping(''); setTypingResult(null); setPracticeOpen(false) }, [word])
  const save = () => { onEdit(draft); setEditing(false) }
  const checkTyping = () => {
    const correct = matchesTypingAnswer(typing, word)
    setTypingResult(correct ? 'correct' : 'wrong')
  }

  return (
    <div className="detail-card">
      <div className="detail-actions"><button onClick={onToggleStar} aria-label={word.starred ? '移出生词本' : '加入生词本'} className={word.starred ? 'starred' : ''}><BookMarked size={17} /></button><button onClick={() => setEditing(!editing)} aria-label="编辑词卡"><SquarePen size={17} /></button></div>
      <div className="detail-main-word">
        <span className="jp">{word.reading}</span>
        {(word.romaji || toRomaji(word.reading)) && <small className="romaji">{word.romaji || toRomaji(word.reading)}</small>}
        <div><h2 className="jp">{word.term}</h2><VolumeButton word={word} /></div>
        <em>{word.partOfSpeech}</em>
      </div>
      {editing ? (
        <div className="edit-form">
          <label>读音<input value={draft.reading} onChange={(e) => setDraft({ ...draft, reading: e.target.value })} /></label>
          <small className="romaji-hint">罗马音：{toRomaji(draft.reading) || '（填入假名读音后自动生成）'}</small>
          <label>罗马音（可改）<input value={draft.romaji || ''} onChange={(e) => setDraft({ ...draft, romaji: e.target.value })} placeholder="留空则按读音自动转换" /></label>
          <label>释义<input value={draft.meaning} onChange={(e) => setDraft({ ...draft, meaning: e.target.value })} /></label>
          <label>例句<textarea value={draft.example} onChange={(e) => setDraft({ ...draft, example: e.target.value })} /></label>
          <label>发音注意事项<input value={draft.pronunciationNote || ''} onChange={(e) => setDraft({ ...draft, pronunciationNote: e.target.value })} /></label>
          <label>记忆技巧<input value={draft.memoryTip || ''} onChange={(e) => setDraft({ ...draft, memoryTip: e.target.value })} /></label>
          <label>同义词<input value={draft.synonyms || ''} onChange={(e) => setDraft({ ...draft, synonyms: e.target.value })} placeholder="多个用 、隔开" /></label>
          <label>形近词<input value={draft.similarWords || ''} onChange={(e) => setDraft({ ...draft, similarWords: e.target.value })} placeholder="多个用 、隔开" /></label>
          <button className="primary-button compact" onClick={save}>保存修改</button>
        </div>
      ) : (
        <>
          <div className="detail-block"><label>中文释义</label><p className="definition">{word.meaning}</p></div>
          <div className="detail-block example-block">
            <label><Sparkles size={14} /> 例句</label>
            <p className="jp example">{word.example}</p>
            {word.exampleReading && <p className="jp furigana">{word.exampleReading}</p>}
            {word.translation && <p className="translation">{word.translation}</p>}
            <VolumeButton word={word} sentence />
          </div>
          {word.pronunciationNote && (
            <div className="detail-block"><label>发音注意事项</label><p className="definition">{word.pronunciationNote}</p></div>
          )}
          {word.memoryTip && (
            <div className="detail-block"><label>记忆技巧</label><p className="definition">{word.memoryTip}</p></div>
          )}
          {splitWordList(word.synonyms).length > 0 && (
            <div className="detail-block"><label>同义词</label><p className="word-chips">{splitWordList(word.synonyms).map((item) => <span key={item} className="jp">{item}</span>)}</p></div>
          )}
          {splitWordList(word.similarWords).length > 0 && (
            <div className="detail-block"><label>形近词</label><p className="word-chips">{splitWordList(word.similarWords).map((item) => <span key={item} className="jp">{item}</span>)}</p></div>
          )}
          <div className="typing-practice">
            <label><SquarePen size={14} /> 打字练习</label>
            <p>输入“{word.meaning}”对应的日语单词或假名</p>
            <div className={typingResult ? `typing-input ${typingResult}` : 'typing-input'}><input value={typing} onChange={(event) => { setTyping(event.target.value); setTypingResult(null) }} onKeyDown={(event) => event.key === 'Enter' && checkTyping()} placeholder="在这里输入…" /><button onClick={checkTyping} disabled={!typing.trim()}>检查</button></div>
            {typingResult && <span className={`typing-feedback ${typingResult}`}>{typingResult === 'correct' ? <><CheckCircle2 size={14} />输入正确</> : <><X size={14} />再试一次，正确答案是 {word.term}（{word.reading}）</>}</span>}
          </div>
        </>
      )}
      <button className={`pronounce-button ${practiceOpen ? 'open' : ''}`} onClick={() => setPracticeOpen((current) => !current)}><Mic size={18} />{practiceOpen ? '收起发音练习' : '练习这个词的发音'}</button>
      {practiceOpen && <InlinePronunciationPractice word={word} />}
      <button className={`master-button ${word.mastered ? 'done' : ''}`} onClick={onToggle}>{word.mastered ? <><CheckCircle2 size={18} />已掌握</> : <><Check size={18} />标记为已掌握</>}</button>
      <div className="detail-nav"><button disabled={position <= 1} onClick={onPrevious}><ChevronLeft size={16} />上一个</button><span>{position || 0} / {total}</span><button disabled={position <= 0 || position >= total} onClick={onNext}>下一个<ChevronRight size={16} /></button></div>
    </div>
  )
}

function InlinePronunciationPractice({ word }: { word: Word }) {
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const practice = usePronunciationPractice((text) => {
    setTranscript(text)
    setScore(pronunciationScore(text, word))
  }, word.id)

  useEffect(() => {
    setTranscript('')
    setScore(null)
  }, [word.id])

  return <div className="inline-practice">
    <div className="inline-practice-head"><div><span>当前练习</span><b className="jp">{word.term} · {word.reading}</b></div><VolumeButton word={word} /></div>
    <button
      className={`inline-record ${practice.recording ? 'recording' : ''}`}
      disabled={practice.evaluating}
      onClick={() => {
        if (practice.recording) practice.stop()
        else { setScore(null); setTranscript(''); practice.start() }
      }}
    >
      {practice.evaluating ? <span className="spinner" /> : practice.recording ? <Pause size={18} /> : <Mic size={18} />}
      <span>{practice.evaluating ? '正在分析…' : practice.recording ? '结束录音' : '开始朗读'}</span>
    </button>
    {practice.error && <div className="speech-error">{practice.error}</div>}
    {score !== null && <div className={`inline-score ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}><b>{score}<small>分</small></b><span>{score >= 80 ? '发音很自然' : score >= 55 ? '已经很接近了' : '请跟读后再试'}<small>识别结果：{transcript}</small></span></div>}
  </div>
}

function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!password.trim() || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) {
        setError(data.message || '密码错误')
        return
      }
      setAccessToken(data.token)
      onUnlock()
    } catch {
      setError('无法连接服务，请稍后重试')
    } finally { setBusy(false) }
  }
  return (
    <div className="access-gate" role="dialog" aria-modal="true" aria-labelledby="access-title">
      <section className="access-card">
        <span className="access-mark">語</span>
        <h1 id="access-title">言の葉</h1>
        <p>请输入访问密码后继续学习</p>
        <div className="access-row">
          <input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder="访问密码" />
          <button className="primary-button" disabled={busy || !password.trim()} onClick={submit}>{busy ? '验证中…' : '进入'}</button>
        </div>
        {error && <em>{error}</em>}
      </section>
    </div>
  )
}

function TestView({ unit, units, onUnit, onBack, onAnswer }: { unit: Unit; units: Unit[]; onUnit: (id: string) => void; onBack: () => void; onAnswer: (word: Word, kind: 'listening' | 'meaning', correct: boolean) => void }) {
  const { voiceGender } = useContext(SettingsContext)
  const [kind, setKind] = useState<'listening' | 'meaning' | null>(null)
  const [questions, setQuestions] = useState<Word[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [options, setOptions] = useState<Word[]>([])
  const [finished, setFinished] = useState(false)
  const usableMeaning = usableQuizWords(unit.words, 'meaning')
  const usableListening = usableQuizWords(unit.words, 'listening')

  const start = (nextKind: 'listening' | 'meaning') => {
    const next = orderQuizByWeakness(usableQuizWords(unit.words, nextKind), nextKind)
    setKind(nextKind)
    setQuestions(next)
    setIndex(0)
    setAnswers({})
    setFinished(false)
  }
  useEffect(() => {
    setKind(null)
    setQuestions([])
    setFinished(false)
    setAnswers({})
  }, [unit.id])
  const current = questions[index]
  useEffect(() => {
    if (!current) return
    setOptions(buildQuizOptions(current, unit.words, sharedDistractors(), kind || 'meaning'))
  }, [current, unit.words, kind])
  useEffect(() => {
    if (kind !== 'listening' || !current || answers[current.id]) return
    void speakJapanese(current.term, voiceGender)
  }, [kind, current, answers, voiceGender])
  const choose = (id: string) => {
    if (!current || !kind || answers[current.id]) return
    setAnswers({ ...answers, [current.id]: id })
    onAnswer(current, kind, id === current.id)
  }
  const next = () => index === questions.length - 1 ? setFinished(true) : setIndex(index + 1)
  const correct = questions.filter((word) => answers[word.id] === word.id).length

  if (!unit.words.length) return <div className="page"><EmptyState onImport={onBack} actionLabel="返回学习" /></div>
  if (!kind) {
    return (
      <div className="page test-page">
        <button className="back-link" onClick={onBack}><ChevronLeft size={17} />退出测试</button>
        <div className="test-top">
          <div>
            <span className="eyebrow">UNIT TEST</span>
            <PageUnitSelect units={units} unit={unit} onUnit={onUnit} label="测试单元" />
            <h1>选择测试方式</h1>
            <p className="test-mode-copy">听错和词义错分开计数。弱项会排在本轮前面，其余单词仍会测到。</p>
          </div>
          <b>{Math.max(usableMeaning.length, usableListening.length)}<small> / {unit.words.length} 词</small></b>
        </div>
        <div className="test-mode-grid">
          <button className="test-mode-card" disabled={usableListening.length < 1} onClick={() => start('listening')}>
            <Headphones size={28} />
            <b>听力测试</b>
            <span>先听日语发音，再从四个单词里选出你听到的那一个。听错过的词会优先出现。</span>
          </button>
          <button className="test-mode-card" disabled={usableMeaning.length < 1} onClick={() => start('meaning')}>
            <BookOpen size={28} />
            <b>单词词义测试</b>
            <span>看到日语单词和读音后，选出正确的中文意思。词义错过的词会优先出现。</span>
          </button>
        </div>
        {usableMeaning.length < 1 && usableListening.length < 1 && <p className="test-hint">这个单元还没有可测的单词。请稍等 AI 补全，或先到学习页确认词卡。</p>}
        {usableMeaning.length > 0 && usableMeaning.length < unit.words.length && <p className="test-hint">还有 {unit.words.length - usableMeaning.length} 个词的中文释义不合格或正在补全。词义测试先测 {usableMeaning.length} 个；听力仍可测全部日语单词。</p>}
      </div>
    )
  }
  if (finished) return (
    <div className="page result-page">
      <div className="result-card">
        <span className="result-icon"><Trophy /></span>
        <span className="eyebrow">TEST COMPLETE</span>
        <h1>{correct >= questions.length * .8 ? 'よくできました！' : 'もう一度、挑戦しよう。'}</h1>
        <p>{kind === 'listening' ? '听力测试' : '词义测试'}已测完 <b>{questions.length}</b> 个单词，答对 {correct} 题。错过的词会在下次同类型测试里优先出现。</p>
        <div className="result-score">{questions.length ? Math.round(correct / questions.length * 100) : 0}<small>分</small></div>
        <div className="result-actions">
          <button onClick={() => setKind(null)}>换一种测试</button>
          <button className="primary-button" onClick={() => start(kind)}>再测一次</button>
        </div>
      </div>
    </div>
  )
  if (!current) return null
  const picked = answers[current.id]
  const listening = kind === 'listening'
  const revealed = Boolean(picked) || !listening
  return (
    <div className="page test-page">
      <button className="back-link" onClick={() => setKind(null)}><ChevronLeft size={17} />返回选择</button>
      <div className="test-top">
        <div>
          <span className="eyebrow">{listening ? 'LISTENING TEST' : 'MEANING TEST'}</span>
          <PageUnitSelect units={units} unit={unit} onUnit={onUnit} label="测试单元" />
          <h1>{listening ? '听发音，选出单词' : '选择正确的中文释义'}</h1>
        </div>
        <b>{index + 1}<small> / {questions.length}</small></b>
      </div>
      <div className="test-progress"><i style={{ width: `${((index + (picked ? 1 : 0)) / questions.length) * 100}%` }} /></div>
      <section className="quiz-card">
        {revealed ? (
          <>
            <span className="jp quiz-reading">{current.reading}</span>
            <div><h2 className="jp">{current.term}</h2><VolumeButton word={current} /></div>
          </>
        ) : (
          <div className="quiz-listen">
            <button className="quiz-listen-play" onClick={() => void speakJapanese(current.term, voiceGender)} aria-label="播放单词">
              <Volume2 size={32} />
            </button>
            <b>点击播放</b>
            <span>听完后选择下面的单词</span>
          </div>
        )}
        <div className="quiz-options">{options.map((option, i) => {
          const selected = picked === option.id
          const showCorrect = picked && option.id === current.id
          const wrong = selected && option.id !== current.id
          return <button key={`${option.id}-${i}`} className={`${showCorrect ? 'correct' : ''} ${wrong ? 'wrong' : ''}`} onClick={() => choose(option.id)}><span>{String.fromCharCode(65 + i)}</span>{listening ? <strong className="jp">{optionLabel(option, 'listening')}</strong> : optionLabel(option, 'meaning')}{showCorrect && <CheckCircle2 />}{wrong && <X />}</button>
        })}</div>
        {picked && <div className={`answer-feedback ${picked === current.id ? 'correct' : 'wrong'}`}><b>{picked === current.id ? '回答正确' : '再记一次'}</b><span className="jp">{current.example}</span><small>{current.translation}</small></div>}
        <button className="primary-button quiz-next" disabled={!picked} onClick={next}>{index === questions.length - 1 ? '查看结果' : '下一题'}<ChevronRight size={18} /></button>
      </section>
    </div>
  )
}

function WordbookView({ units, onRemove }: { units: Unit[]; onRemove: (wordId: string, unitId: string) => void }) {
  const entries = units.flatMap((unit) => unit.words.filter((word) => word.starred).map((word) => ({ word, unit })))
  return (
    <div className="page hub-page">
      <section className="hub-hero"><div><span className="eyebrow">PERSONAL WORDBOOK</span><h1>生词本</h1><p>这里保存你主动标记的单词，跨单元集中查看。</p></div><span className="hero-count"><b>{entries.length}</b> 个生词</span></section>
      {entries.length ? <section className="collection-list">{entries.map(({ word, unit }) => <article key={word.id} className="collection-card">
        <span className="collection-unit" style={{ color: unit.color }}>{unit.name}</span>
        <div className="collection-word"><b className="jp">{word.term}</b><span className="jp">{word.reading}</span></div>
        <p>{word.meaning}</p><div className="collection-example"><span className="jp">{word.example}</span><small>{word.translation}</small></div>
        <VolumeButton word={word} />
        <button className="remove-word" onClick={() => onRemove(word.id, unit.id)}><Trash2 size={15} />移出</button>
      </article>)}</section> : <div className="wide-empty"><BookMarked /><h2>生词本还是空的</h2><p>在“学习”页打开词卡，点击右上角的生词本图标即可收藏。</p></div>}
    </div>
  )
}

function ReviewView({ units, onReview }: { units: Unit[]; onReview: (word: Word, unitId: string, remembered: boolean) => void }) {
  const entries = units.flatMap((unit) => unit.words.map((word) => ({ word, unit, state: getReviewState(word) })))
  const due = entries.filter((item) => item.state.due).sort((a, b) => a.state.nextReviewAt - b.state.nextReviewAt)
  const upcoming = entries.filter((item) => !item.state.due && Number.isFinite(item.state.nextReviewAt)).sort((a, b) => a.state.nextReviewAt - b.state.nextReviewAt).slice(0, 6)
  return (
    <div className="page hub-page">
      <section className="hub-hero"><div><span className="eyebrow">SPACED REPETITION</span><h1>待复习</h1><p>按照 1、2、4、7、15、30 天的间隔自动安排，忘记的词会在 10 分钟后重试。</p></div><span className="hero-count accent"><b>{due.length}</b> 个到期</span></section>
      <section className="memory-curve"><div className="curve-copy"><BrainCircuit /><div><b>艾宾浩斯间隔复习</b><span>每次确认记得后，系统自动延长下一次复习间隔。</span></div></div><div className="curve-steps">{REVIEW_INTERVAL_DAYS.map((day, index) => <span key={day}><i>{index + 1}</i><b>{day}天</b></span>)}</div></section>
      <h2 className="section-title">今天需要复习</h2>
      {due.length ? <section className="review-list">{due.map(({ word, unit, state }) => <article key={word.id} className="review-card">
        <div><span className="review-unit" style={{ color: unit.color }}>{unit.name}</span><b className="jp">{word.term}</b><small className="jp">{word.reading}</small></div>
        <p>{word.meaning}</p><span className="review-status">第 {state.stage + 1} 阶段 · {formatReviewTime(word)}</span><VolumeButton word={word} />
        <div className="review-actions"><button onClick={() => onReview(word, unit.id, false)}>没记住</button><button onClick={() => onReview(word, unit.id, true)}><Check size={16} />记住了</button></div>
      </article>)}</section> : <div className="wide-empty compact"><CheckCircle2 /><h2>今天的复习完成了</h2><p>系统会根据下一次到期时间自动把单词放回这里。</p></div>}
      {upcoming.length > 0 && <><h2 className="section-title upcoming-title">接下来</h2><div className="upcoming-list">{upcoming.map(({ word, unit }) => <div key={word.id}><span className="jp">{word.term}</span><small>{unit.name}</small><b>{formatReviewTime(word)}</b></div>)}</div></>}
    </div>
  )
}

function SettingsView({ settings, onChange, starredCount = 0, errorBookCount = 0, onView }: {
  settings: AppSettings; onChange: (settings: AppSettings) => void; starredCount?: number; errorBookCount?: number; onView?: (view: View) => void
}) {
  const avatars = ['ゆ', '桜', '語', '猫', '旅', '月']
  const sample = makeFallbackWord({ term: 'こんにちは', reading: 'こんにちは', meaning: '你好' })
  const [voiceStatus, setVoiceStatus] = useState('正在检测设备音色…')
  useEffect(() => {
    let cancelled = false
    loadSpeechVoices().then((voices) => {
      if (cancelled) return
      const selected = selectJapaneseVoice(voices, settings.voiceGender)
      if (!selected.voice) setVoiceStatus('未检测到日语音色，将使用浏览器默认语音')
      else if (settings.voiceGender === 'male' && !selected.nativeMatch) setVoiceStatus(`未找到原生男声，已对 ${selected.voice.name} 启用低音高模式`)
      else setVoiceStatus(`当前使用：${selected.voice.name}`)
    })
    return () => { cancelled = true }
  }, [settings.voiceGender])
  return (
    <div className="page settings-page">
      <section className="hub-hero"><div><span className="eyebrow">PREFERENCES</span><h1>个人设置</h1><p>设置头像和日语朗读音色。安卓可用 Chrome 菜单「添加到主屏幕」，像应用一样打开。</p></div></section>
      {onView && (
        <div className="me-shortcuts">
          <button onClick={() => onView('wordbook')}><BookMarked size={18} /><span>生词本</span><em>{starredCount}</em></button>
          <button onClick={() => onView('errorbook')}><NotebookPen size={18} /><span>错词本</span><em>{errorBookCount}</em></button>
          <button onClick={() => onView('test')}><GraduationCap size={18} /><span>单元测试</span></button>
          <button onClick={() => onView('dictation')}><Keyboard size={18} /><span>听写</span></button>
        </div>
      )}
      <div className="settings-layout">
        <section className="settings-card"><div className="settings-title"><UserRound /><div><h2>头像</h2><p>选择一个代表你的文字头像。</p></div></div><div className="avatar-options">{avatars.map((avatar) => <button key={avatar} className={settings.avatar === avatar ? 'active' : ''} onClick={() => onChange({ ...settings, avatar })}>{avatar}{settings.avatar === avatar && <CheckCircle2 />}</button>)}</div><label className="custom-avatar">自定义<input maxLength={2} value={settings.avatar} onChange={(event) => onChange({ ...settings, avatar: event.target.value || 'ゆ' })} /></label></section>
        <section className="settings-card"><div className="settings-title"><AudioLines /><div><h2>日语朗读音色</h2><p>系统会优先匹配设备中对应性别的日语语音。</p></div></div><div className="voice-options"><button className={settings.voiceGender === 'female' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'female' })}><span>女</span><div><b>女声</b><small>清晰、柔和</small></div>{settings.voiceGender === 'female' && <CheckCircle2 />}</button><button className={settings.voiceGender === 'male' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'male' })}><span>男</span><div><b>男声</b><small>沉稳、自然</small></div>{settings.voiceGender === 'male' && <CheckCircle2 />}</button></div><div className="voice-preview"><span><b>试听当前音色</b><small className="jp">こんにちは</small><em>{voiceStatus}</em></span><VolumeButton word={sample} /></div></section>
      </div>
    </div>
  )
}

function ImportModal({ unit, onClose, onImported }: { unit: Unit; onClose: () => void; onImported: (words: Word[], description?: string) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<ImportDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [fileReading, setFileReading] = useState(false)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parse = (text = raw) => { const next = parseVocabulary(text); setDrafts(next); setNotice(next.length ? '' : '没有识别到单词，请检查格式。') }
  const readFile = async (file?: File) => {
    if (!file) return
    setFileReading(true); setNotice('')
    try {
      const text = await readVocabularyFile(file)
      setRaw(text); parse(text)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '文件读取失败，请检查文件格式。')
    } finally { setFileReading(false) }
  }
  const enrich = async () => {
    if (!drafts.length) return
    setLoading(true); setNotice('')
    try {
      const enriched: Partial<Word>[] = Array.from({ length: drafts.length }, () => ({}))
      let themeFromModel = ''
      // 表格已给全 假名/词性/释义/例句 的词不调用大模型，只补缺失的。
      const pending = drafts
        .map((draft, index) => ({ draft, index }))
        .filter(({ draft }) => !(draft.reading && draft.meaning && draft.partOfSpeech && draft.example))
      const chunkSize = ENRICH_BATCH_SIZE
      for (let start = 0; start < pending.length; start += chunkSize) {
        const batch = pending.slice(start, start + chunkSize)
        setNotice(`AI 正在补全缺失字段… ${Math.min(start + batch.length, pending.length)}/${pending.length}`)
        try {
          const response = await apiFetch('/api/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: batch.map(({ draft }) => draft), unitName: unit.name }) })
          const data = await response.json()
          if (!response.ok || !Array.isArray(data.words)) throw new Error(data.error || 'AI 解析失败')
          data.words.forEach((item: Partial<Word>, offset: number) => { enriched[batch[offset].index] = item })
          if (!themeFromModel && typeof data.unitDescription === 'string' && data.unitDescription.trim()) {
            themeFromModel = data.unitDescription.trim().slice(0, 16)
          }
        } catch { /* this batch stays on local fallback and can be filled later */ }
      }
      const words: Word[] = drafts.map((draft, index) => {
        const merged = mergeEnrichedWord(makeFallbackWord(draft), enriched[index] || {})
        // 用户表格里提供的字段优先，模型只补空缺。
        return {
          ...merged,
          reading: String(draft.reading || '').trim() || merged.reading,
          meaning: String(draft.meaning || '').trim() || merged.meaning,
          partOfSpeech: String(draft.partOfSpeech || '').trim() || merged.partOfSpeech,
          example: String(draft.example || '').trim() || merged.example,
          ...(String(draft.example || '').trim() ? { exampleReading: '', translation: '' } : {}),
          romaji: String(draft.romaji || '').trim() || merged.romaji,
          pronunciationNote: String(draft.pronunciationNote || '').trim() || merged.pronunciationNote,
          memoryTip: String(draft.memoryTip || '').trim() || merged.memoryTip,
          synonyms: String(draft.synonyms || '').trim() || merged.synonyms,
          similarWords: String(draft.similarWords || '').trim() || merged.similarWords,
        }
      })
      const theme = themeFromModel && !isPlaceholderTheme(themeFromModel)
        ? themeFromModel
        : fallbackUnitTheme(unit.name, [...unit.words, ...words])
      onImported(words, theme)
    } catch {
      const words = drafts.map(makeFallbackWord)
      onImported(words, fallbackUnitTheme(unit.name, [...unit.words, ...words]))
      setNotice('词卡已用本地模板生成。')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal import-modal">
        <button className="modal-close" onClick={onClose}><X /></button>
        <span className="modal-icon"><Import /></span><span className="eyebrow">SMART IMPORT</span><h2>导入到「{unit.name}」</h2><p>粘贴单词或上传文件。支持表格列：单词、假名、词性、中文释义、罗马音、例句、发音注意事项、记忆技巧、同义词、形近词：表格里已有的内容直接采用，只有缺失的字段才交给 AI 补全。</p>
        {!drafts.length ? <>
          <button className="drop-zone" disabled={fileReading} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]) }}>{fileReading ? <span className="spinner dark" /> : <UploadCloud />}<b>{fileReading ? '正在读取 Word 文档…' : '拖入 Word、TXT、CSV 或 JSON 文件'}</b><span>Word 支持段落、列表与三列表格 · DOCX 最大 5MB</span></button>
          <input ref={fileRef} type="file" accept=".docx,.doc,.txt,.csv,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => readFile(e.target.files?.[0])} />
          <div className="or"><span />或直接粘贴<span /></div>
          <textarea className="import-textarea" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'猫\n食べる, たべる, 吃\n单词\t假名\t词性\t中文释义\t罗马音\t例句\t发音注意事项\t记忆技巧\n桜\tさくら\t名词\t樱花\tsakura\t桜が咲きました。\t\t“撒库拉”谐音'} />
          <small className="format-hint"><FileText size={14} />每行一个词；支持“单词, 读音, 释义”，也支持从 Excel 直接复制的 8 列表格（带表头自动识别）。扫描稿里的批注行会被自动过滤。</small>
          {notice && <div className="modal-notice">{notice}</div>}
          <button className="primary-button modal-submit" disabled={!raw.trim()} onClick={() => parse()}>解析单词<ChevronRight size={18} /></button>
        </> : <>
          <div className="preview-heading"><b>识别到 {drafts.length} 个单词</b><button onClick={() => setDrafts([])}>重新编辑</button></div>
          <div className="import-preview">{drafts.map((draft, i) => <div key={`${draft.term}-${i}`}><span>{i + 1}</span><b className="jp">{draft.term}</b><small>{draft.reading ? `${draft.reading}${(draft.romaji || toRomaji(draft.reading)) ? ` · ${draft.romaji || toRomaji(draft.reading)}` : ''}` : 'AI 自动识别读音'}</small><em>{draft.meaning || 'AI 自动查询释义'}</em></div>)}</div>
          {notice && <div className="modal-notice">{notice}</div>}
          <button className="primary-button modal-submit" disabled={loading} onClick={enrich}>{loading ? <><span className="spinner" />AI 正在整理词卡并归纳主题…</> : <><Sparkles size={18} />生成并导入词卡</>}</button>
        </>}
      </section>
    </div>
  )
}

function ConfirmDeleteUnitModal({ unit, onlyUnit, onClose, onConfirm }: {
  unit: Unit; onlyUnit: boolean; onClose: () => void; onConfirm: () => void
}) {
  const starred = unit.words.filter((word) => word.starred).length
  const due = unit.words.filter((word) => getReviewState(word).due).length
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal small-modal delete-modal">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X /></button>
        <span className="modal-icon danger"><Trash2 /></span>
        <h2>删除单元？</h2>
        {onlyUnit ? (
          <p>词库至少需要保留一个单元，不能删除「{unit.name}」。</p>
        ) : (
          <>
            <p>将删除单元「<b>{unit.name}</b>」及其全部词卡，此操作无法恢复。</p>
            <ul className="delete-summary">
              <li><b>{unit.words.length}</b> 个单词会一并删除</li>
              {starred > 0 && <li>其中 <b>{starred}</b> 个在生词本中</li>}
              {due > 0 && <li>其中 <b>{due}</b> 个仍在待复习</li>}
            </ul>
          </>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>{onlyUnit ? '我知道了' : '取消'}</button>
          {!onlyUnit && <button className="primary-button danger-confirm" onClick={onConfirm}>确认删除</button>}
        </div>
      </section>
    </div>
  )
}

function NewUnitModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal small-modal"><button className="modal-close" onClick={onClose}><X /></button><span className="modal-icon"><BookOpen /></span><h2>创建新单元</h2><p>只需填写名称。创建后上传词汇，AI 会根据内容自动归纳主题。</p><label>单元名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：第四单元" /></label><button className="primary-button modal-submit" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>创建并上传词汇</button></section></div>
}

function EmptyState({ onImport, actionLabel = '添加单词' }: { onImport: () => void; actionLabel?: string }) {
  return <div className="empty-state"><span><FileText /></span><b>这里还没有单词</b><p>导入 TXT、CSV、JSON，或直接粘贴词汇。</p><button onClick={onImport}>{actionLabel}</button></div>
}
function EmptyDetail({ onImport }: { onImport: () => void }) { return <div className="detail-card empty-detail"><BookOpen /><b>选择一个单词</b><p>查看释义、例句并练习发音。</p><button onClick={onImport}>导入词汇</button></div> }

export default App
