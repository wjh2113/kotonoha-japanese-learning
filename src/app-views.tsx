import { useContext, useEffect, useRef, useState } from 'react'
import {
  AudioLines, Bell, BookMarked, BookOpen, BrainCircuit, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, FileText, GraduationCap, Headphones, Home, Import, Keyboard, LayoutGrid, LibraryBig, List, Menu,
  Mic, NotebookPen, Palette, PanelLeft, PanelLeftClose, Pause, Plus, Search, Settings, Sparkles, SquarePen,
  Sprout, Target, Trash2, Trophy, UploadCloud, UserRound, Volume2, X,
} from 'lucide-react'
import { apiFetch, apiUrl, setAccessToken } from './api'
import { readVocabularyFile } from './docx'
import { PronunciationPractice } from './PronunciationPractice'
import { SettingsContext } from './settings-context'
import { loadSpeechVoices, selectJapaneseVoice, speakJapanese } from './speech'
import type { AppSettings, ImportDraft, ThemeName, Unit, View, Word } from './types'
import { DEFAULT_UNIT_THEME, fallbackUnitTheme, isPlaceholderTheme } from './theme'
import { buildQuizOptions, isPlaceholderMeaning, optionLabel, orderQuizByWeakness, recordQuizAnswer, sharedDistractors, usableQuizWords } from './quiz'
import { formatReviewTime, getReviewState, makeFallbackWord, matchesTypingAnswer, masteryDots, parseVocabularyHandbook, proficiencyPercent, pronunciationScore, REVIEW_INTERVAL_DAYS, scheduleReview, splitWordList, toRomaji, uid } from './utils'

const THEME_OPTIONS: { id: ThemeName; name: string; desc: string }[] = [
  { id: 'matcha', name: '抹茶', desc: '日式绿' },
  { id: 'aka', name: '绯红', desc: '暖橘红' },
  { id: 'ai', name: '黛蓝', desc: '书卷气' },
]

export function AvatarThemeMenu({
  settings, onSettingsChange, onOpenSettings, ariaLabel = '主题与设置',
}: {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onOpenSettings: () => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = settings.theme || 'matcha'

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current && !rootRef.current.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`avatar-theme-menu${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="header-avatar"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{settings.avatar}</span>
      </button>
      {open && (
        <div className="avatar-theme-popover" role="menu" aria-label="选择主题">
          <p className="avatar-theme-label">主题颜色</p>
          <div className="avatar-theme-options">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={current === option.id}
                className={current === option.id ? 'active' : ''}
                onClick={() => {
                  onSettingsChange({ ...settings, theme: option.id })
                  setOpen(false)
                }}
              >
                <span className={`theme-swatch theme-swatch-${option.id}`} />
                <div>
                  <b>{option.name}</b>
                  <small>{option.desc}</small>
                </div>
                {current === option.id && <CheckCircle2 size={16} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="avatar-theme-settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <Settings size={15} />
            我的设置
          </button>
        </div>
      )}
    </div>
  )
}

export function AppHeader({ open, view, starredCount, errorBookCount, reviewCount, onMenu, onView, onCollapse }: {
  open: boolean; view: View; starredCount: number; errorBookCount: number; reviewCount: number
  onMenu: () => void; onView: (view: View) => void; onCollapse: () => void
}) {
  const items: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'home', label: '首页', icon: <Home size={18} strokeWidth={1.6} /> },
    { id: 'study', label: '单词学习', icon: <BookOpen size={18} strokeWidth={1.6} /> },
    { id: 'library', label: '词库', icon: <LibraryBig size={18} strokeWidth={1.6} /> },
    { id: 'passage', label: '课文学习', icon: <FileText size={18} strokeWidth={1.6} /> },
    { id: 'test', label: '测试', icon: <GraduationCap size={18} strokeWidth={1.6} /> },
    { id: 'dictation', label: '听写', icon: <Keyboard size={18} strokeWidth={1.6} /> },
    { id: 'wordbook', label: '生词本', icon: <BookMarked size={18} strokeWidth={1.6} />, count: starredCount },
    { id: 'errorbook', label: '错词本', icon: <NotebookPen size={18} strokeWidth={1.6} />, count: errorBookCount },
    { id: 'review', label: '复习', icon: <Clock3 size={18} strokeWidth={1.6} />, count: reviewCount },
    { id: 'settings', label: '设置', icon: <Settings size={18} strokeWidth={1.6} /> },
  ]
  return (
    <aside className={`app-sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-desktop-head">
        <button type="button" className="sidebar-toggle" onClick={onCollapse} aria-label="隐藏菜单" title="隐藏菜单">
          <PanelLeftClose size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className="sidebar-mobile-head">
        <span className="sidebar-leaf" aria-hidden><Sprout size={18} strokeWidth={1.75} /></span>
        <b>にほんご学習</b>
        <button className="header-menu sidebar-close" onClick={onMenu} aria-label="关闭菜单"><X size={18} /></button>
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => { onView(item.id); if (open) onMenu() }}>
            {item.icon}<span>{item.label}</span>
            {Boolean(item.count) && <em>{item.count}</em>}
          </button>
        ))}
      </nav>
      <div className="sidebar-art" aria-hidden>
        <p className="jp">日本語を<br />もっと好きに</p>
        <svg viewBox="0 0 220 110" className="sidebar-fuji" fill="none">
          <ellipse cx="170" cy="28" rx="18" ry="8" fill="#f3d9a8" opacity=".55" />
          <path d="M10 95 C40 70 55 78 70 62 C90 40 105 48 120 30 C140 8 155 28 175 45 C190 58 205 52 220 62 L220 110 L10 110 Z" fill="currentColor" opacity=".16" />
          <path d="M30 110 C50 82 70 88 88 70 C108 50 122 58 140 42 C155 30 168 48 185 58 C198 66 210 62 220 70 L220 110 Z" fill="currentColor" opacity=".28" />
          <path d="M95 38 C102 28 112 24 120 30 C114 36 105 40 95 38 Z" fill="#fff" opacity=".55" />
          <circle cx="42" cy="72" r="3" fill="#e8b7c4" opacity=".8" />
          <circle cx="58" cy="78" r="2.2" fill="#e8b7c4" opacity=".65" />
          <circle cx="48" cy="84" r="2.5" fill="#d9a0b0" opacity=".7" />
        </svg>
      </div>
    </aside>
  )
}

export function DesktopTopBar({ settings, onView, onSettingsChange, sidebarCollapsed, onToggleSidebar, reviewCount = 0 }: {
  settings: AppSettings; onView: (view: View) => void; onSettingsChange: (settings: AppSettings) => void
  sidebarCollapsed: boolean; onToggleSidebar: () => void; reviewCount?: number
}) {
  const streak = settings.streakDays || 0
  const statusLine = streak > 0 ? `连续 ${streak} 天` : (reviewCount > 0 ? `${reviewCount} 词待复习` : '今日开始学习')
  return (
    <header className="desktop-topbar">
      <div className="topbar-left">
        {sidebarCollapsed && (
          <button type="button" className="icon-button sidebar-toggle" onClick={onToggleSidebar} aria-label="显示菜单" title="显示菜单">
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
        )}
        <button type="button" className="topbar-brand" onClick={() => onView('home')}>
          <span className="topbar-leaf" aria-hidden><Sprout size={18} strokeWidth={1.75} /></span>
          <span className="topbar-brand-text">
            <b>日语学习</b>
            <small>一词一句，遇见更好的自己</small>
          </span>
        </button>
      </div>
      <div className="topbar-right">
        <button
          type="button"
          className="icon-button"
          aria-label={reviewCount > 0 ? `待复习 ${reviewCount} 词` : '复习'}
          title={reviewCount > 0 ? `${reviewCount} 词待复习` : '去复习'}
          onClick={() => onView('review')}
        >
          <Bell size={18} strokeWidth={1.6} />
          {reviewCount > 0 && <em className="topbar-badge">{reviewCount > 99 ? '99+' : reviewCount}</em>}
        </button>
        <div className="topbar-user">
          <AvatarThemeMenu
            settings={settings}
            onSettingsChange={onSettingsChange}
            onOpenSettings={() => onView('settings')}
            ariaLabel="主题与设置"
          />
          <div>
            <b>{settings.displayName || '小林同学'}</b>
            <small>{statusLine}</small>
          </div>
        </div>
      </div>
    </header>
  )
}

const VIEW_TITLES: Record<View, string> = {
  home: '首页', library: '词库', study: '单词学习', passage: '课文学习', test: '测试', dictation: '听写', wordbook: '生词本', errorbook: '错词本', review: '复习', settings: '设置',
}

export function MobileTopBar({ view, settings, onView, onSettingsChange, onMenu, reviewCount = 0 }: {
  view: View; settings: AppSettings; onView: (view: View) => void; onSettingsChange: (settings: AppSettings) => void; onMenu: () => void; reviewCount?: number
}) {
  return (
    <header className="mobile-topbar home-topbar">
      <button className="header-menu" onClick={onMenu} aria-label="打开菜单"><Menu size={21} /></button>
      <div className="mobile-brand">
        <Sprout size={18} />
        <b>{VIEW_TITLES[view]}</b>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={reviewCount > 0 ? `待复习 ${reviewCount} 词` : '复习'}
        onClick={() => onView('review')}
      >
        <Bell size={18} />
        {reviewCount > 0 && <em className="topbar-badge">{reviewCount > 99 ? '99+' : reviewCount}</em>}
      </button>
      <AvatarThemeMenu
        settings={settings}
        onSettingsChange={onSettingsChange}
        onOpenSettings={() => onView('settings')}
        ariaLabel="主题与我的"
      />
    </header>
  )
}

export function MobileTabBar({ view, reviewCount, onView }: { view: View; reviewCount: number; onView: (view: View) => void }) {
  const items: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'home', label: '首页', icon: <Home size={21} /> },
    { id: 'study', label: '单词', icon: <BookOpen size={21} /> },
    { id: 'passage', label: '课文', icon: <FileText size={21} /> },
    { id: 'dictation', label: '听写', icon: <Keyboard size={21} /> },
    { id: 'review', label: '复习', icon: <Clock3 size={21} />, count: reviewCount },
    { id: 'settings', label: '我的', icon: <UserRound size={21} /> },
  ]
  const active = view === 'wordbook' || view === 'errorbook' || view === 'test' || view === 'library' ? '' : view
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

export function LibraryView({ units, unitId, onUnit, onImport, onNewUnit, onRenameUnit, onDeleteUnit }: {
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
        <div><span className="eyebrow">VOCABULARY LIBRARY</span><h1>我的词库</h1><p>按单元管理词汇，并从「词汇手册」Excel 模版批量导入。</p></div>
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

export function StudyView({ unit, units, selectedWord, search, onUnit, onSelect, onImport, onToggleMastered, onEdit, onToggleStar, onSearch, onTest, onDictation }: {
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
    <div className="page study-page study-design">
      <div className="study-topbar">
        <label className="study-unit-chip">
          <BookOpen size={16} strokeWidth={1.6} />
          <select aria-label="学习单元" value={unit.id} onChange={(event) => onUnit(event.target.value)}>
            {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="study-search">
          <Search size={17} strokeWidth={1.6} />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索单词、假名或中文释义…" />
        </label>
        <div className="view-toggle">
          <button type="button" className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图"><LayoutGrid size={17} strokeWidth={1.6} /></button>
          <button type="button" className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图"><List size={18} strokeWidth={1.6} /></button>
        </div>
      </div>

      <section className="study-heading">
        <div>
          <h1><BookOpen size={22} strokeWidth={1.6} />单词学习</h1>
          <p>选择单词卡片，开始学习和记忆吧！</p>
        </div>
        <div className="study-mastery-meta">
          <span>共 {unit.words.length} 个单词</span>
          <div className="study-mastery-bar" aria-label={`${mastered}/${unit.words.length} 已掌握`}>
            <i style={{ width: `${percent}%` }} />
          </div>
          <b>{mastered}/{unit.words.length} 已掌握</b>
        </div>
        <div className="hero-actions study-heading-actions">
          <button className="secondary-button" onClick={onDictation}><Keyboard size={16} strokeWidth={1.6} />听写</button>
          <button className="secondary-button" onClick={onTest}><GraduationCap size={16} strokeWidth={1.6} />单元测试</button>
          <button className="primary-button" onClick={onImport}><UploadCloud size={16} strokeWidth={1.6} />导入单词</button>
        </div>
      </section>

      <div className="content-columns">
        <section className="word-library">
          <div className="section-toolbar">
            <div className="filter-tabs">
              {([['all', '全部'], ['learning', '学习中'], ['mastered', '已掌握']] as const).map(([id, label]) => (
                <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}<span>{id === 'all' ? unit.words.length : id === 'mastered' ? mastered : unit.words.length - mastered}</span></button>
              ))}
            </div>
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
  const dots = masteryDots(word)
  return (
    <div className={`word-card ${active ? 'active' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() }
    }}>
      <span className="mastery-dots" aria-label={`掌握度 ${dots}/5`}>
        {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < dots ? 'on' : ''} />)}
      </span>
      <b className="jp word-term">{word.term}</b>
      <span className="jp word-reading">{word.reading}</span>
      <em className="word-pos">{word.partOfSpeech.split('・')[0]}</em>
      <span className="word-meaning">{word.meaning}</span>
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
  const [notesDraft, setNotesDraft] = useState(word.notes || '')
  useEffect(() => { setDraft(word); setEditing(false); setTyping(''); setTypingResult(null); setPracticeOpen(false); setNotesDraft(word.notes || '') }, [word])
  const save = () => { onEdit(draft); setEditing(false) }
  const checkTyping = () => {
    const correct = matchesTypingAnswer(typing, word)
    setTypingResult(correct ? 'correct' : 'wrong')
  }
  const dots = masteryDots(word)

  return (
    <div className="detail-card">
      <div className="detail-actions">
        <span className="mastery-dots" aria-label={`掌握度 ${dots}/5`}>
          {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < dots ? 'on' : ''} />)}
        </span>
        <button onClick={onToggleStar} aria-label={word.starred ? '移出生词本' : '加入生词本'} className={word.starred ? 'starred' : ''}><BookMarked size={17} strokeWidth={1.6} /></button>
        <button onClick={() => setEditing(!editing)} aria-label="编辑词卡"><SquarePen size={17} strokeWidth={1.6} /></button>
      </div>
      <div className="detail-main-word">
        <h2 className="jp">{word.term}</h2>
        <span className="jp">{word.reading}</span>
        {(word.romaji || toRomaji(word.reading)) && <small className="romaji">{word.romaji || toRomaji(word.reading)}</small>}
        <div className="detail-meta-row">
          <em>{word.partOfSpeech}</em>
          <span className="detail-speak"><VolumeButton word={word} /><b>发音</b></span>
        </div>
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
          <label>我的笔记<textarea value={draft.notes || ''} maxLength={200} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          <button className="primary-button compact" onClick={save}>保存修改</button>
        </div>
      ) : (
        <>
          <div className="detail-block"><label><BookOpen size={14} strokeWidth={1.6} />中文释义</label><p className="definition meaning-wash">{word.meaning}</p></div>
          <div className="detail-block example-block">
            <label><FileText size={14} strokeWidth={1.6} />例句</label>
            <p className="jp example">{word.example}</p>
            {word.exampleReading && <p className="jp furigana">{word.exampleReading}</p>}
            {word.translation && <p className="translation">{word.translation}</p>}
            <VolumeButton word={word} sentence />
          </div>
          {(splitWordList(word.similarWords).length > 0 || splitWordList(word.synonyms).length > 0) && (
            <div className="detail-related">
              {splitWordList(word.similarWords).length > 0 && (
                <div className="detail-block"><label><Sparkles size={14} strokeWidth={1.6} />相似词</label><p className="word-chips">{splitWordList(word.similarWords).map((item) => <span key={item} className="jp">{item}</span>)}</p></div>
              )}
              {splitWordList(word.synonyms).length > 0 && (
                <div className="detail-block"><label><Sparkles size={14} strokeWidth={1.6} />同义词</label><p className="word-chips">{splitWordList(word.synonyms).map((item) => <span key={item} className="jp">{item}</span>)}</p></div>
              )}
            </div>
          )}
          {word.pronunciationNote && (
            <div className="detail-block"><label><Mic size={14} strokeWidth={1.6} />发音注意事项</label><p className="definition">{word.pronunciationNote}</p></div>
          )}
          <div className="detail-block">
            <label><SquarePen size={14} strokeWidth={1.6} />记忆技巧</label>
            <p className="definition">{word.memoryTip || '暂无记忆技巧，可点右上角编辑补充。'}</p>
          </div>
          <div className="detail-block">
            <label><NotebookPen size={14} strokeWidth={1.6} />我的笔记</label>
            <textarea
              className="notes-input"
              value={notesDraft}
              maxLength={200}
              placeholder="写下你的记忆联想…"
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={() => {
                if ((word.notes || '') !== notesDraft) onEdit({ notes: notesDraft.slice(0, 200) })
              }}
            />
            <small className="notes-count">{notesDraft.length}/200</small>
          </div>
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
      <div className="detail-footer-actions">
        <button type="button" className={`mark-button ${word.starred ? 'on' : ''}`} onClick={onToggleStar}><BookMarked size={16} />{word.starred ? '已标记' : '标记'}</button>
        <button className={`master-button ${word.mastered ? 'done' : ''}`} onClick={onToggle}>{word.mastered ? <><CheckCircle2 size={18} />已掌握</> : <><Check size={18} />标记为已掌握</>}</button>
      </div>
      <div className="detail-nav"><button disabled={position <= 1} onClick={onPrevious}><ChevronLeft size={16} />上一个</button><span>{position || 0} / {total}</span><button disabled={position <= 0 || position >= total} onClick={onNext}>下一个<ChevronRight size={16} /></button></div>
    </div>
  )
}

function InlinePronunciationPractice({ word }: { word: Word }) {
  return (
    <PronunciationPractice
      variant="inline"
      referenceText={word.term}
      referenceReading={word.reading}
      resetKey={word.id}
      scoreFn={(text) => pronunciationScore(text, word)}
      header={(
        <div className="inline-practice-head">
          <div><span>当前练习</span><b className="jp">{word.term} · {word.reading}</b></div>
          <VolumeButton word={word} />
        </div>
      )}
    />
  )
}

export function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!password.trim() || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(apiUrl('/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
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

export function TestView({ unit, units, onUnit, onBack, onAnswer }: { unit: Unit; units: Unit[]; onUnit: (id: string) => void; onBack: () => void; onAnswer: (word: Word, kind: 'listening' | 'meaning', correct: boolean) => void }) {
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
      <div className="page test-page quiz-design">
        <button className="back-link" onClick={onBack}><ChevronLeft size={17} strokeWidth={1.6} />退出测试</button>
        <div className="test-top">
          <div>
            <PageUnitSelect units={units} unit={unit} onUnit={onUnit} label="测试单元" />
            <h1>选择测试方式</h1>
            <p className="test-mode-copy">听错和词义错分开计数。弱项会排在本轮前面，其余单词仍会测到。</p>
          </div>
          <b>{Math.max(usableMeaning.length, usableListening.length)}<small> / {unit.words.length} 词</small></b>
        </div>
        <div className="test-mode-grid">
          <button className="test-mode-card" disabled={usableListening.length < 1} onClick={() => start('listening')}>
            <Headphones size={28} strokeWidth={1.6} />
            <b>听力测试</b>
            <span>先听日语发音，再从四个单词里选出你听到的那一个。听错过的词会优先出现。</span>
          </button>
          <button className="test-mode-card" disabled={usableMeaning.length < 1} onClick={() => start('meaning')}>
            <BookOpen size={28} strokeWidth={1.6} />
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
    <div className="page result-page quiz-design">
      <div className="result-card">
        <span className="result-icon"><Trophy size={28} strokeWidth={1.6} /></span>
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
    <div className="page test-page quiz-design">
      <div className="quiz-hero-deco" aria-hidden>
        <svg viewBox="0 0 220 120" className="home-torii" fill="none">
          <circle cx="168" cy="32" r="22" fill="currentColor" opacity=".16" />
          <circle cx="168" cy="32" r="12" fill="currentColor" opacity=".08" />
          <path d="M42 48 H178" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".28" />
          <path d="M36 40 H184" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".22" />
          <path d="M58 48 V92 M162 48 V92" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".26" />
          <path d="M50 58 H170" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity=".2" />
          <path d="M18 102 C48 82 72 92 96 78 C118 66 140 84 178 70 C192 64 204 68 214 62" stroke="currentColor" strokeWidth="2.2" opacity=".18" />
        </svg>
      </div>
      <div className="test-top quiz-top-bar">
        <div className="quiz-chips">
          <span><BookOpen size={14} strokeWidth={1.6} />{unit.name}</span>
          <span><Headphones size={14} strokeWidth={1.6} />{listening ? '听发音，选出单词' : '选出正确释义'}</span>
          <span className="quiz-progress-chip">
            <b>{index + 1} / {questions.length}</b>
            <i className="quiz-progress-mini"><em style={{ width: `${((index + (picked ? 1 : 0)) / questions.length) * 100}%` }} /></i>
          </span>
        </div>
      </div>
      <section className="quiz-card quiz-card-design">
        {revealed ? (
          <>
            <span className="jp quiz-reading">{current.reading}</span>
            <div><h2 className="jp">{current.term}</h2><VolumeButton word={current} /></div>
          </>
        ) : (
          <div className="quiz-listen">
            <button className="quiz-listen-play" onClick={() => void speakJapanese(current.term, voiceGender)} aria-label="播放单词">
              <Volume2 size={36} strokeWidth={1.6} />
            </button>
            <b>点击播放</b>
            <span>听完后选择下面的单词</span>
          </div>
        )}
        <div className="quiz-options quiz-options-design">{options.map((option, i) => {
          const selected = picked === option.id
          const showCorrect = picked && option.id === current.id
          const wrong = selected && option.id !== current.id
          return <button key={`${option.id}-${i}`} className={`${selected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${wrong ? 'wrong' : ''}`} onClick={() => choose(option.id)}><em>{String.fromCharCode(65 + i)}</em>{listening ? <strong className="jp">{optionLabel(option, 'listening')}</strong> : optionLabel(option, 'meaning')}{selected && <CheckCircle2 size={18} strokeWidth={1.6} />}</button>
        })}</div>
        {picked && <div className={`answer-feedback ${picked === current.id ? 'correct' : 'wrong'}`}><b>{picked === current.id ? '回答正确' : '再记一次'}</b><span className="jp">{current.example}</span><small>{current.translation}</small></div>}
        <button className="primary-button quiz-next" disabled={!picked} onClick={next}>{index === questions.length - 1 ? '查看结果' : '下一题'}<ChevronRight size={18} strokeWidth={1.6} /></button>
      </section>
      <button className="back-link" onClick={() => setKind(null)}><ChevronLeft size={17} strokeWidth={1.6} />返回选择</button>
    </div>
  )
}

export function WordbookView({ units, onRemove }: { units: Unit[]; onRemove: (wordId: string, unitId: string) => void }) {
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

export function ReviewView({ units, onReview }: { units: Unit[]; onReview: (word: Word, unitId: string, remembered: boolean) => void }) {
  const entries = units.flatMap((unit) => unit.words.map((word) => ({ word, unit, state: getReviewState(word) })))
  const due = entries.filter((item) => item.state.due).sort((a, b) => a.state.nextReviewAt - b.state.nextReviewAt)
  const stageGoals: Record<number, string> = {
    1: '初步巩固，强化记忆',
    2: '加深印象，减少遗忘',
    4: '巩固记忆，提升熟练度',
    7: '长期记忆，稳固掌握',
    15: '最终巩固，形成长期记忆',
    30: '周期回访，保持激活',
  }
  const stageCounts = REVIEW_INTERVAL_DAYS.map((day, index) => ({
    day,
    count: entries.filter((item) => (item.word.reviewStage ?? 0) === index && Number.isFinite(item.word.nextReviewAt)).length,
    goal: stageGoals[day] || '',
    primary: day <= 15,
  }))
  const [activeIndex, setActiveIndex] = useState(0)
  const [sessionOpen, setSessionOpen] = useState(false)
  const active = due[activeIndex] || due[0]
  return (
    <div className="page hub-page review-design">
      <section className="hub-hero review-hero">
        <div>
          <h1>待复习</h1>
          <p className="review-today-line">今日 <b>{due.length}</b> 词待复习</p>
          <p>根据艾宾浩斯遗忘曲线，合理安排复习计划，巩固日语记忆。</p>
        </div>
        <div className="quiz-hero-deco review-hero-deco" aria-hidden>
          <svg viewBox="0 0 220 120" className="home-torii" fill="none">
            <circle cx="168" cy="32" r="22" fill="currentColor" opacity=".16" />
            <path d="M42 48 H178" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".28" />
            <path d="M58 48 V92 M162 48 V92" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".26" />
            <path d="M18 102 C48 82 72 92 96 78 C118 66 140 84 178 70 C192 64 204 68 214 62" stroke="currentColor" strokeWidth="2.2" opacity=".18" />
          </svg>
        </div>
      </section>
      <section className="home-card memory-curve-card">
        <div className="curve-copy"><Target size={18} strokeWidth={1.6} /><div><b>艾宾浩斯间隔重复</b><span>科学安排复习时间，让记忆更牢固。</span></div></div>
        <div className="curve-steps curve-steps-rich">
          {stageCounts.map(({ day, count, goal, primary }, index) => (
            <span key={day} className={primary ? '' : 'curve-stage-soft'}>
              <i>{day}d</i>
              <strong>{day}天后复习</strong>
              <small>{goal}</small>
              <b>{count} 词</b>
              {index < stageCounts.length - 1 && <em className="curve-arrow" aria-hidden>→</em>}
            </span>
          ))}
        </div>
      </section>
      <section className="home-card review-queue-card">
        <header>
          <div><Clock3 size={16} strokeWidth={1.6} /><b>今日复习队列</b></div>
          <small>共 {due.length} 词 · 按下次复习时间排序</small>
        </header>
        {due.length ? (
          <div className="review-table">
            <div className="review-table-head"><span>单词</span><span>下次复习时间</span><span>熟练度</span><span>操作</span></div>
            {due.map(({ word, state }, index) => (
              <div key={word.id} className={`review-table-row ${index % 2 ? 'zebra' : ''} ${index === activeIndex ? 'active' : ''}`}>
                <div>
                  <b className="jp">{word.term}</b>
                  <small className="jp">{word.reading}</small>
                  <em>{word.meaning}</em>
                </div>
                <span className="review-next-time"><Clock3 size={14} strokeWidth={1.6} />{formatReviewTime(word)} · 第 {state.stage + 1} 阶段</span>
                <span className="review-prof"><span className="review-prof-track"><i style={{ width: `${proficiencyPercent(word)}%` }} /></span><b>{proficiencyPercent(word)}%</b></span>
                <button type="button" onClick={() => { setActiveIndex(index); setSessionOpen(true) }} aria-label="开始复习"><ChevronRight size={16} strokeWidth={1.6} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="wide-empty compact"><CheckCircle2 strokeWidth={1.6} /><h2>今天的复习完成了</h2><p>系统会根据下一次到期时间自动把单词放回这里。</p></div>
        )}
        {sessionOpen && active && (
          <div className="review-active-card">
            <div>
              <span className="review-unit">{active.unit.name}</span>
              <b className="jp">{active.word.term}</b>
              <small className="jp">{active.word.reading}</small>
              <p>{active.word.meaning}</p>
            </div>
            <VolumeButton word={active.word} />
            <div className="review-actions">
              <button onClick={() => onReview(active.word, active.unit.id, false)}>没记住</button>
              <button onClick={() => onReview(active.word, active.unit.id, true)}><Check size={16} strokeWidth={1.6} />记住了</button>
            </div>
          </div>
        )}
        {due.length > 0 && (
          <button
            type="button"
            className="primary-button review-start"
            onClick={() => {
              setActiveIndex(0)
              setSessionOpen(true)
            }}
          >
            <AudioLines size={18} strokeWidth={1.6} />开始今日复习
          </button>
        )}
      </section>
    </div>
  )
}

export function SettingsView({ settings, onChange, starredCount = 0, errorBookCount = 0, onView }: {
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
        <section className="settings-card"><div className="settings-title"><Palette /><div><h2>主题颜色</h2><p>选择整套界面的主色调，随时可换。</p></div></div><div className="voice-options theme-options">{([['matcha', '抹茶', '清新日式绿，默认'], ['aka', '绯红', '暖橘红'], ['ai', '黛蓝', '沉静书卷气']] as const).map(([id, name, desc]) => <button key={id} className={(settings.theme || 'matcha') === id ? 'active' : ''} onClick={() => onChange({ ...settings, theme: id })}><span className={`theme-swatch theme-swatch-${id}`} /><div><b>{name}</b><small>{desc}</small></div>{(settings.theme || 'matcha') === id && <CheckCircle2 />}</button>)}</div></section>
        <section className="settings-card"><div className="settings-title"><AudioLines /><div><h2>日语朗读音色</h2><p>系统会优先匹配设备中对应性别的日语语音。</p></div></div><div className="voice-options"><button className={settings.voiceGender === 'female' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'female' })}><span>女</span><div><b>女声</b><small>清晰、柔和</small></div>{settings.voiceGender === 'female' && <CheckCircle2 />}</button><button className={settings.voiceGender === 'male' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'male' })}><span>男</span><div><b>男声</b><small>沉稳、自然</small></div>{settings.voiceGender === 'male' && <CheckCircle2 />}</button></div><div className="voice-preview"><span><b>试听当前音色</b><small className="jp">こんにちは</small><em>{voiceStatus}</em></span><VolumeButton word={sample} /></div></section>
      </div>
    </div>
  )
}

export function ImportModal({ unit, onClose, onImported }: { unit: Unit; onClose: () => void; onImported: (words: Word[], description?: string) => void }) {
  const [drafts, setDrafts] = useState<ImportDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [fileReading, setFileReading] = useState(false)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const readFile = async (file?: File) => {
    if (!file) return
    setFileReading(true)
    setNotice('')
    try {
      const text = await readVocabularyFile(file)
      const next = parseVocabularyHandbook(text)
      if (!next.length) {
        setDrafts([])
        setNotice('未识别到词汇手册格式。请使用下载的模版，表头需含：序号、单词、假名、词性、中文释义…')
        return
      }
      setDrafts(next)
      setNotice('')
    } catch (reason) {
      setDrafts([])
      setNotice(reason instanceof Error ? reason.message : '文件读取失败，请检查是否为词汇手册 Excel。')
    } finally {
      setFileReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const importWords = async () => {
    if (!drafts.length) return
    setLoading(true)
    setNotice('')
    try {
      // 只用模版字段，不调用 AI，避免改写用户整理的释义/例句。
      const words = drafts.map(makeFallbackWord)
      onImported(words, fallbackUnitTheme(unit.name, [...unit.words, ...words]))
    } catch {
      setNotice('导入失败，请重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal import-modal">
        <button className="modal-close" onClick={onClose}><X /></button>
        <span className="modal-icon"><Import /></span>
        <span className="eyebrow">VOCAB HANDBOOK</span>
        <h2>导入到「{unit.name}」</h2>
        <p>仅支持「词汇手册」Excel 模版。表内字段原样入库，不再用 AI 改写，以保证数据准确。</p>
        {!drafts.length ? <>
          <div className="import-template-row">
            <a className="secondary-button import-template-link" href="/templates/词汇导入模版.xlsx" download="词汇导入模版.xlsx">
              <FileText size={16} />下载导入模版
            </a>
            <small>列：序号｜单词｜假名｜词性｜中文释义｜罗马音｜例句｜例句译文｜发音注意事项｜记忆技巧｜同义词｜形近词</small>
          </div>
          <button
            className="drop-zone"
            type="button"
            disabled={fileReading}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void readFile(e.dataTransfer.files[0]) }}
          >
            {fileReading ? <span className="spinner dark" /> : <UploadCloud />}
            <b>{fileReading ? '正在读取 Excel…' : '拖入或选择词汇手册 .xlsx'}</b>
            <span>不接受 Word / 粘贴 / CSV / JSON</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            hidden
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          {notice && <div className="modal-notice">{notice}</div>}
        </> : <>
          <div className="preview-heading"><b>识别到 {drafts.length} 个单词</b><button type="button" onClick={() => setDrafts([])}>重新选择文件</button></div>
          <div className="import-preview">{drafts.map((draft, i) => <div key={`${draft.term}-${i}`}><span>{i + 1}</span><b className="jp">{draft.term}</b><small>{draft.reading || '—'}</small><em>{draft.meaning || '—'}</em></div>)}</div>
          {notice && <div className="modal-notice">{notice}</div>}
          <button className="primary-button modal-submit" disabled={loading} onClick={() => void importWords()}>
            {loading ? <><span className="spinner" />正在导入…</> : <><Sparkles size={18} />确认导入词卡</>}
          </button>
        </>}
      </section>
    </div>
  )
}

export function ConfirmDeleteUnitModal({ unit, onlyUnit, onClose, onConfirm }: {
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

export function NewUnitModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal small-modal"><button className="modal-close" onClick={onClose}><X /></button><span className="modal-icon"><BookOpen /></span><h2>创建新单元</h2><p>只需填写名称。创建后上传词汇，AI 会根据内容自动归纳主题。</p><label>单元名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：第四单元" /></label><button className="primary-button modal-submit" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>创建并上传词汇</button></section></div>
}

function EmptyState({ onImport, actionLabel = '添加单词' }: { onImport: () => void; actionLabel?: string }) {
  return <div className="empty-state"><span><FileText /></span><b>这里还没有单词</b><p>请上传词汇手册 Excel 模版。</p><button onClick={onImport}>{actionLabel}</button></div>
}
function EmptyDetail({ onImport }: { onImport: () => void }) { return <div className="detail-card empty-detail"><BookOpen /><b>选择一个单词</b><p>查看释义、例句并练习发音。</p><button onClick={onImport}>导入词汇</button></div> }
