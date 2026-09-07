import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines, BookMarked, BookOpen, BrainCircuit, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, FileText, GraduationCap, Import, LayoutGrid, LibraryBig, List, Menu,
  Mic, MoreHorizontal, Pause, Plus, Search, Settings, Sparkles, SquarePen,
  Trash2, Trophy, UploadCloud, UserRound, Volume2, X,
} from 'lucide-react'
import { initialUnits } from './data'
import { readVocabularyFile } from './docx'
import type { AppSettings, ImportDraft, Unit, View, Word } from './types'
import { formatReviewTime, getReviewState, makeFallbackWord, parseVocabulary, pronunciationScore, REVIEW_INTERVAL_DAYS, scheduleReview, shuffle, uid } from './utils'

const STORAGE_KEY = 'kotonoha-units-v1'
const SETTINGS_KEY = 'kotonoha-settings-v1'
const COLORS = ['#dd5b43', '#668b87', '#d39a43', '#786f95', '#6d8d55']
const DEFAULT_SETTINGS: AppSettings = { avatar: 'ゆ', voiceGender: 'female' }
const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS)

function App() {
  const [units, setUnits] = useState<Unit[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '') } catch { return initialUnits }
  })
  const [unitId, setUnitId] = useState(units[0]?.id || '')
  const [view, setView] = useState<View>('study')
  const [learningMode, setLearningMode] = useState<'cards' | 'pronunciation'>('cards')
  const [selectedId, setSelectedId] = useState(units[0]?.words[0]?.id || '')
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importUnitId, setImportUnitId] = useState(unitId)
  const [newUnitOpen, setNewUnitOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [settings, setSettings] = useState<AppSettings>(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '') } } catch { return DEFAULT_SETTINGS }
  })

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(units)), [units])
  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings])
  useEffect(() => {
    const unit = units.find((item) => item.id === unitId)
    if (unit && !unit.words.some((word) => word.id === selectedId)) setSelectedId(unit.words[0]?.id || '')
  }, [unitId, units, selectedId])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(id)
  }, [toast])

  const unit = units.find((item) => item.id === unitId) || units[0]
  const selectedWord = unit?.words.find((word) => word.id === selectedId) || unit?.words[0]
  const totalWords = units.reduce((sum, item) => sum + item.words.length, 0)
  const mastered = units.reduce((sum, item) => sum + item.words.filter((word) => word.mastered).length, 0)
  const starredCount = units.reduce((sum, item) => sum + item.words.filter((word) => word.starred).length, 0)
  const reviewCount = units.reduce((sum, item) => sum + item.words.filter((word) => getReviewState(word).due).length, 0)

  const updateWord = (wordId: string, changes: Partial<Word>, targetUnitId = unitId) => {
    setUnits((current) => current.map((item) => item.id === targetUnitId
      ? { ...item, words: item.words.map((word) => word.id === wordId ? { ...word, ...changes } : word) }
      : item))
  }

  const addUnit = (name: string, description: string) => {
    const newUnit: Unit = { id: uid(), name, description, color: COLORS[units.length % COLORS.length], words: [] }
    setUnits((current) => [...current, newUnit])
    setUnitId(newUnit.id)
    setNewUnitOpen(false)
    setToast('新单元已创建')
  }

  const nav = (next: View) => {
    setView(next)
    if (next === 'study') setLearningMode('cards')
    setMobileNav(false)
  }

  const toggleMastered = (word: Word) => updateWord(word.id, word.mastered
    ? { mastered: false }
    : { mastered: true, ...scheduleReview(word, true) })

  const addImportedWords = (targetUnit: Unit, words: Word[]) => {
    setUnits((current) => current.map((item) => item.id === targetUnit.id ? { ...item, words: [...item.words, ...words] } : item))
    if (words[0]) setSelectedId(words[0].id)
    setImportOpen(false)
    setToast(`已导入 ${words.length} 个单词到「${targetUnit.name}」`)
  }

  const openImport = (targetUnitId = unitId) => {
    setImportUnitId(targetUnitId)
    setImportOpen(true)
  }

  const importUnit = units.find((item) => item.id === importUnitId) || unit

  return (
    <SettingsContext.Provider value={settings}>
    <div className="app-shell">
      <AppHeader
        open={mobileNav} view={view} units={units} unitId={unitId} settings={settings}
        starredCount={starredCount} reviewCount={reviewCount}
        onMenu={() => setMobileNav((current) => !current)} onView={nav}
        onUnit={setUnitId}
      />
      <main className="main">
        {view === 'library' && <LibraryView units={units} unitId={unitId} onUnit={setUnitId} onImport={openImport} onNewUnit={() => setNewUnitOpen(true)} />}
        {view === 'study' && unit && learningMode === 'cards' && (
          <StudyView
            unit={unit} selectedWord={selectedWord}
            onSelect={setSelectedId} onImport={() => openImport()}
            onToggleMastered={toggleMastered}
            onEdit={(word, changes) => updateWord(word.id, changes)}
            onPractice={() => setLearningMode('pronunciation')}
            onToggleStar={(word) => { updateWord(word.id, { starred: !word.starred }); setToast(word.starred ? '已移出生词本' : '已加入生词本') }}
            search={search} onSearch={setSearch}
          />
        )}
        {view === 'study' && unit && learningMode === 'pronunciation' && <PronunciationView unit={unit} initialWord={selectedWord} onBack={() => setLearningMode('cards')} />}
        {view === 'test' && unit && <TestView unit={unit} onBack={() => setView('study')} onAnswer={(word, correct) => updateWord(word.id, { mastered: correct || word.mastered, ...scheduleReview(word, correct) })} />}
        {view === 'wordbook' && <WordbookView units={units} onRemove={(wordId, targetUnitId) => { updateWord(wordId, { starred: false }, targetUnitId); setToast('已移出生词本') }} />}
        {view === 'review' && <ReviewView units={units} onReview={(word, targetUnitId, remembered) => { updateWord(word.id, { mastered: remembered || word.mastered, ...scheduleReview(word, remembered) }, targetUnitId); setToast(remembered ? '已安排下一次复习' : '10 分钟后会再次提醒') }} />}
        {view === 'settings' && <SettingsView settings={settings} onChange={setSettings} />}
      </main>

      {importOpen && importUnit && <ImportModal unit={importUnit} onClose={() => setImportOpen(false)} onImported={(words) => addImportedWords(importUnit, words)} />}
      {newUnitOpen && <NewUnitModal onClose={() => setNewUnitOpen(false)} onCreate={addUnit} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单" />}
    </div>
    </SettingsContext.Provider>
  )
}

function AppHeader({ open, view, units, unitId, settings, starredCount, reviewCount, onMenu, onView, onUnit }: {
  open: boolean; view: View; units: Unit[]; unitId: string; settings: AppSettings; starredCount: number; reviewCount: number
  onMenu: () => void; onView: (view: View) => void; onUnit: (id: string) => void
}) {
  const items: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'library', label: '词库', icon: <LibraryBig size={17} /> },
    { id: 'study', label: '学习', icon: <BookOpen size={17} /> },
    { id: 'test', label: '测试', icon: <GraduationCap size={17} /> },
    { id: 'wordbook', label: '生词本', icon: <BookMarked size={17} />, count: starredCount },
    { id: 'review', label: '待复习', icon: <Clock3 size={17} />, count: reviewCount },
    { id: 'settings', label: '设置', icon: <Settings size={17} /> },
  ]
  return (
    <header className="app-header">
      <button className="header-menu" onClick={onMenu} aria-label="打开菜单"><Menu size={21} /></button>
      <button className="header-brand" onClick={() => onView('study')}><span>語</span><b>日语单词学习</b></button>
      <label className="unit-select"><span>学习单元</span><select value={unitId} onChange={(event) => onUnit(event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.words.length}词</option>)}</select></label>
      <nav className={`header-nav ${open ? 'open' : ''}`}>
        {items.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)}>{item.icon}<span>{item.label}</span>{Boolean(item.count) && <em>{item.count}</em>}</button>)}
      </nav>
      <button className="header-avatar" onClick={() => onView('settings')} aria-label="打开设置"><span>{settings.avatar}</span></button>
    </header>
  )
}

function LibraryView({ units, unitId, onUnit, onImport, onNewUnit }: {
  units: Unit[]; unitId: string; onUnit: (id: string) => void; onImport: (unitId?: string) => void; onNewUnit: () => void
}) {
  const total = units.reduce((sum, item) => sum + item.words.length, 0)
  const mastered = units.reduce((sum, item) => sum + item.words.filter((word) => word.mastered).length, 0)
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
            <h2>{item.name}</h2><p>{item.description}</p>
            <div className="unit-card-meta"><span>{item.words.length} 个单词</span><span>{learned} 个已掌握</span></div>
            <div className="unit-progress"><i style={{ width: `${percent}%`, background: item.color }} /></div>
            <button onClick={(event) => { event.stopPropagation(); onUnit(item.id); onImport(item.id) }}><UploadCloud size={15} />上传词汇</button>
          </article>
        })}
        <button className="unit-card add-unit-card" onClick={onNewUnit}><Plus size={26} /><b>创建新单元</b><span>按主题整理你的学习内容</span></button>
      </section>
    </div>
  )
}

function StudyView({ unit, selectedWord, search, onSelect, onImport, onToggleMastered, onEdit, onPractice, onToggleStar, onSearch }: {
  unit: Unit; selectedWord?: Word; search: string; onSelect: (id: string) => void; onImport: () => void
  onToggleMastered: (word: Word) => void; onEdit: (word: Word, changes: Partial<Word>) => void; onPractice: () => void
  onToggleStar: (word: Word) => void; onSearch: (value: string) => void
}) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const filtered = unit.words.filter((word) => {
    const matches = `${word.term}${word.reading}${word.meaning}`.toLowerCase().includes(search.toLowerCase())
    return matches && (filter === 'all' || (filter === 'mastered' ? word.mastered : !word.mastered))
  })
  const mastered = unit.words.filter((word) => word.mastered).length
  const percent = Math.round(mastered / Math.max(unit.words.length, 1) * 100)

  return (
    <div className="page study-page">
      <section className="page-intro">
        <div>
          <div className="eyebrow"><span style={{ background: unit.color }} /> VOCABULARY UNIT</div>
          <h1>{unit.name}</h1>
          <p>{unit.description} · 共 {unit.words.length} 个单词</p>
        </div>
        <button className="primary-button" onClick={onImport}><UploadCloud size={18} />导入单词</button>
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
          {selectedWord ? <WordDetail word={selectedWord} onToggle={() => onToggleMastered(selectedWord)} onToggleStar={() => onToggleStar(selectedWord)} onEdit={(changes) => onEdit(selectedWord, changes)} onPractice={onPractice} /> : <EmptyDetail onImport={onImport} />}
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
      <span className="word-meaning">{word.meaning}</span>
      <span className="card-bottom"><em>{word.partOfSpeech.split('・')[0]}</em><VolumeButton word={word} small /></span>
    </div>
  )
}

function VolumeButton({ word, small = false, sentence = false }: { word: Word; small?: boolean; sentence?: boolean }) {
  const [speaking, setSpeaking] = useState(false)
  const { voiceGender } = useContext(SettingsContext)
  const speak = (event: React.MouseEvent) => {
    event.stopPropagation()
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(sentence ? word.example : word.term)
    utterance.lang = 'ja-JP'; utterance.rate = sentence ? 0.82 : 0.72
    const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith('ja'))
    const genderHint = voiceGender === 'female'
      ? /nanami|ayumi|haruka|kyoko|sayaka|female|woman|女性|女声/i
      : /ichiro|keita|male|man|男性|男声/i
    utterance.voice = voices.find((voice) => genderHint.test(`${voice.name} ${voice.voiceURI}`)) || voices[0] || null
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    speechSynthesis.speak(utterance)
  }
  return <button className={`volume-button ${small ? 'small' : ''} ${speaking ? 'speaking' : ''}`} onClick={speak} aria-label="朗读">{speaking ? <Pause size={small ? 14 : 19} /> : <Volume2 size={small ? 14 : 19} />}</button>
}

function WordDetail({ word, onToggle, onToggleStar, onEdit, onPractice }: { word: Word; onToggle: () => void; onToggleStar: () => void; onEdit: (changes: Partial<Word>) => void; onPractice: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(word)
  useEffect(() => { setDraft(word); setEditing(false) }, [word])
  const save = () => { onEdit(draft); setEditing(false) }

  return (
    <div className="detail-card">
      <div className="detail-actions"><button onClick={onToggleStar} aria-label={word.starred ? '移出生词本' : '加入生词本'} className={word.starred ? 'starred' : ''}><BookMarked size={17} /></button><button onClick={() => setEditing(!editing)} aria-label="编辑词卡"><SquarePen size={17} /></button><button aria-label="更多操作"><MoreHorizontal size={19} /></button></div>
      <div className="detail-main-word">
        <span className="jp">{word.reading}</span>
        <div><h2 className="jp">{word.term}</h2><VolumeButton word={word} /></div>
        <em>{word.partOfSpeech}</em>
      </div>
      {editing ? (
        <div className="edit-form">
          <label>读音<input value={draft.reading} onChange={(e) => setDraft({ ...draft, reading: e.target.value })} /></label>
          <label>释义<input value={draft.meaning} onChange={(e) => setDraft({ ...draft, meaning: e.target.value })} /></label>
          <label>例句<textarea value={draft.example} onChange={(e) => setDraft({ ...draft, example: e.target.value })} /></label>
          <button className="primary-button compact" onClick={save}>保存修改</button>
        </div>
      ) : (
        <>
          <div className="detail-block"><label>中文释义</label><p className="definition">{word.meaning}</p></div>
          <div className="detail-block example-block">
            <label><Sparkles size={14} /> AI 初学者例句</label>
            <p className="jp example">{word.example}</p>
            <p className="jp furigana">{word.exampleReading}</p>
            <p className="translation">{word.translation}</p>
            <VolumeButton word={word} sentence />
          </div>
        </>
      )}
      <button className="pronounce-button" onClick={onPractice}><Mic size={18} />练习这个词的发音</button>
      <button className={`master-button ${word.mastered ? 'done' : ''}`} onClick={onToggle}>{word.mastered ? <><CheckCircle2 size={18} />已掌握</> : <><Check size={18} />标记为已掌握</>}</button>
      <div className="detail-nav"><button><ChevronLeft size={16} />上一个</button><span>选择左侧单词继续</span><button>下一个<ChevronRight size={16} /></button></div>
    </div>
  )
}

function PronunciationView({ unit, initialWord, onBack }: { unit: Unit; initialWord?: Word; onBack: () => void }) {
  const [index, setIndex] = useState(Math.max(0, initialWord ? unit.words.findIndex((word) => word.id === initialWord.id) : 0))
  const [recording, setRecording] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [error, setError] = useState('')
  const recognition = useRef<SpeechRecognition | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const mediaStream = useRef<MediaStream | null>(null)
  const audioChunks = useRef<Blob[]>([])
  const browserFallback = useRef(false)
  const word = unit.words[index]
  useEffect(() => { setTranscript(''); setScore(null); setError('') }, [index])

  const finishScore = (text: string) => {
    setTranscript(text)
    setScore(pronunciationScore(text, word))
    setRecording(false)
    setEvaluating(false)
  }

  const recordWithBrowser = () => {
    if (!word) return
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) { setError('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。'); return }
    const instance = new Constructor()
    recognition.current = instance
    instance.lang = 'ja-JP'; instance.interimResults = false; instance.continuous = false
    instance.onresult = (event) => {
      const text = event.results[0][0].transcript
      finishScore(text)
    }
    instance.onerror = (event) => { setError(event.error === 'not-allowed' ? '请允许浏览器使用麦克风。' : '没有听清，请靠近麦克风再试一次。'); setRecording(false) }
    instance.onend = () => setRecording(false)
    setError(''); setScore(null); setTranscript(''); setRecording(true); instance.start()
  }

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const sendRecording = async (blob: Blob) => {
    setEvaluating(true)
    try {
      const audioBase64 = await blobToBase64(blob)
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
      const response = await fetch('/api/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || 'audio/webm', filename: `pronunciation.${extension}` }),
      })
      const data = await response.json()
      if (!response.ok || !data.text) throw new Error(data.error || '网关没有返回转写文本。')
      finishScore(data.text)
    } catch (reason) {
      setEvaluating(false)
      browserFallback.current = true
      setError(`${reason instanceof Error ? reason.message : '网关语音转写失败。'} 已切换到浏览器识别，请再读一次。`)
    }
  }

  const startRecording = async () => {
    if (!word) return
    if (browserFallback.current || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      recordWithBrowser(); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStream.current = stream
      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, supported ? { mimeType: supported } : undefined)
      mediaRecorder.current = recorder; audioChunks.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunks.current.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(audioChunks.current, { type: recorder.mimeType || 'audio/webm' })
        setRecording(false)
        if (blob.size) sendRecording(blob)
      }
      setError(''); setScore(null); setTranscript(''); setRecording(true); recorder.start()
    } catch {
      browserFallback.current = true
      setError('无法开始录音，已切换到浏览器识别。')
      recordWithBrowser()
    }
  }

  const stopRecording = () => {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop()
    else recognition.current?.stop()
  }

  if (!word) return <div className="page"><EmptyState onImport={onBack} /></div>
  return (
    <div className="page practice-page">
      <button className="back-link" onClick={onBack}><ChevronLeft size={17} />返回单词表</button>
      <div className="mode-heading"><span className="eyebrow">PRONUNCIATION LAB</span><h1>发音练习</h1><p>先听标准读音，再用自然的速度读出来。</p></div>
      <div className="practice-layout">
        <aside className="practice-queue"><b>{unit.name}</b><span>{index + 1} / {unit.words.length}</span><div>{unit.words.map((item, i) => <button key={item.id} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}><span className="jp">{item.term}</span><small>{item.reading}</small></button>)}</div></aside>
        <section className="practice-card">
          <div className="sound-waves"><i /><i /><i /><i /><i /></div>
          <span className="jp practice-reading">{word.reading}</span>
          <h2 className="jp">{word.term}</h2>
          <p>{word.meaning}</p>
          <VolumeButton word={word} />
          <div className="record-area">
            <button className={`record-button ${recording ? 'recording' : ''}`} disabled={evaluating} onClick={() => recording ? stopRecording() : startRecording()}>
              {evaluating ? <span className="spinner" /> : recording ? <Pause size={26} /> : <Mic size={27} />}
            </button>
            <b>{evaluating ? 'AI 正在分析发音…' : recording ? '正在聆听…再次点按结束' : score === null ? '点按录音，朗读上方单词' : '完成评测'}</b>
            <small>{recording ? '建议保持 1–3 秒的自然语速' : '录音经服务端转写，API Key 不会发送到浏览器'}</small>
          </div>
          {error && <div className="speech-error">{error}</div>}
          {score !== null && (
            <div className={`score-panel ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}>
              <div className="score-ring"><b>{score}</b><small>分</small></div>
              <div><b>{score >= 80 ? '发音很自然！' : score >= 55 ? '已经很接近了' : '再慢一点试试'}</b><p>识别结果：<span className="jp">{transcript}</span></p><small>{score >= 80 ? '假名与目标词匹配良好，保持现在的节奏。' : '重点留意长音、促音和浊音，先跟读标准音再录一次。'}</small></div>
            </div>
          )}
          <div className="practice-controls"><button disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft />上一个</button><button disabled={index === unit.words.length - 1} onClick={() => setIndex(index + 1)}>下一个<ChevronRight /></button></div>
        </section>
      </div>
    </div>
  )
}

function TestView({ unit, onBack, onAnswer }: { unit: Unit; onBack: () => void; onAnswer: (word: Word, correct: boolean) => void }) {
  const [questions, setQuestions] = useState<Word[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [options, setOptions] = useState<Word[]>([])
  const [finished, setFinished] = useState(false)

  const start = () => {
    const next = shuffle(unit.words).slice(0, Math.min(10, unit.words.length))
    setQuestions(next); setIndex(0); setAnswers({}); setFinished(false)
  }
  useEffect(() => { start() }, [unit.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = questions[index]
  useEffect(() => {
    if (!current) return
    setOptions(shuffle([current, ...shuffle(unit.words.filter((word) => word.id !== current.id)).slice(0, 3)]))
  }, [current, unit.words])
  const choose = (id: string) => {
    if (!current || answers[current.id]) return
    setAnswers({ ...answers, [current.id]: id })
    onAnswer(current, id === current.id)
  }
  const next = () => index === questions.length - 1 ? setFinished(true) : setIndex(index + 1)
  const correct = questions.filter((word) => answers[word.id] === word.id).length

  if (!unit.words.length) return <div className="page"><EmptyState onImport={onBack} /></div>
  if (finished) return (
    <div className="page result-page">
      <div className="result-card"><span className="result-icon"><Trophy /></span><span className="eyebrow">TEST COMPLETE</span><h1>{correct >= questions.length * .8 ? 'よくできました！' : 'もう一度、挑戦しよう。'}</h1><p>本轮答对 <b>{correct}</b> / {questions.length} 题</p><div className="result-score">{Math.round(correct / questions.length * 100)}<small>分</small></div><div className="result-actions"><button onClick={onBack}>返回学习</button><button className="primary-button" onClick={start}>再测一次</button></div></div>
    </div>
  )
  if (!current) return null
  const picked = answers[current.id]
  return (
    <div className="page test-page">
      <button className="back-link" onClick={onBack}><ChevronLeft size={17} />退出测试</button>
      <div className="test-top"><div><span className="eyebrow">QUICK TEST · {unit.name}</span><h1>选择正确的中文释义</h1></div><b>{index + 1}<small> / {questions.length}</small></b></div>
      <div className="test-progress"><i style={{ width: `${((index + (picked ? 1 : 0)) / questions.length) * 100}%` }} /></div>
      <section className="quiz-card">
        <span className="jp quiz-reading">{current.reading}</span>
        <div><h2 className="jp">{current.term}</h2><VolumeButton word={current} /></div>
        <div className="quiz-options">{options.map((option, i) => {
          const selected = picked === option.id
          const showCorrect = picked && option.id === current.id
          const wrong = selected && option.id !== current.id
          return <button key={option.id} className={`${showCorrect ? 'correct' : ''} ${wrong ? 'wrong' : ''}`} onClick={() => choose(option.id)}><span>{String.fromCharCode(65 + i)}</span>{option.meaning}{showCorrect && <CheckCircle2 />}{wrong && <X />}</button>
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

function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const avatars = ['ゆ', '桜', '語', '猫', '旅', '月']
  const sample = makeFallbackWord({ term: 'こんにちは', reading: 'こんにちは', meaning: '你好' })
  return (
    <div className="page settings-page">
      <section className="hub-hero"><div><span className="eyebrow">PREFERENCES</span><h1>个人设置</h1><p>设置头像和日语朗读音色，选择会保存在当前浏览器。</p></div></section>
      <div className="settings-layout">
        <section className="settings-card"><div className="settings-title"><UserRound /><div><h2>头像</h2><p>选择一个代表你的文字头像。</p></div></div><div className="avatar-options">{avatars.map((avatar) => <button key={avatar} className={settings.avatar === avatar ? 'active' : ''} onClick={() => onChange({ ...settings, avatar })}>{avatar}{settings.avatar === avatar && <CheckCircle2 />}</button>)}</div><label className="custom-avatar">自定义<input maxLength={2} value={settings.avatar} onChange={(event) => onChange({ ...settings, avatar: event.target.value || 'ゆ' })} /></label></section>
        <section className="settings-card"><div className="settings-title"><AudioLines /><div><h2>日语朗读音色</h2><p>系统会优先匹配设备中对应性别的日语语音。</p></div></div><div className="voice-options"><button className={settings.voiceGender === 'female' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'female' })}><span>女</span><div><b>女声</b><small>清晰、柔和</small></div>{settings.voiceGender === 'female' && <CheckCircle2 />}</button><button className={settings.voiceGender === 'male' ? 'active' : ''} onClick={() => onChange({ ...settings, voiceGender: 'male' })}><span>男</span><div><b>男声</b><small>沉稳、自然</small></div>{settings.voiceGender === 'male' && <CheckCircle2 />}</button></div><div className="voice-preview"><span><b>试听当前音色</b><small className="jp">こんにちは</small></span><VolumeButton word={sample} /></div></section>
      </div>
    </div>
  )
}

function ImportModal({ unit, onClose, onImported }: { unit: Unit; onClose: () => void; onImported: (words: Word[]) => void }) {
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
      const response = await fetch('/api/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: drafts }) })
      if (!response.ok) throw new Error((await response.json()).error)
      const data = await response.json()
      const words: Word[] = data.words.map((item: Partial<Word>, index: number) => ({ ...makeFallbackWord(drafts[index] || { term: item.term || '' }), ...item, id: uid(), mastered: false, createdAt: Date.now() }))
      onImported(words)
    } catch {
      setNotice('当前未配置 LLM，已使用本地词典与模板生成。你可以稍后在 .env 中配置密钥。')
      window.setTimeout(() => onImported(drafts.map(makeFallbackWord)), 750)
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal import-modal">
        <button className="modal-close" onClick={onClose}><X /></button>
        <span className="modal-icon"><Import /></span><span className="eyebrow">SMART IMPORT</span><h2>导入到「{unit.name}」</h2><p>粘贴单词或上传文件，AI 将自动补全读音、释义与初学者例句。</p>
        {!drafts.length ? <>
          <button className="drop-zone" disabled={fileReading} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]) }}>{fileReading ? <span className="spinner dark" /> : <UploadCloud />}<b>{fileReading ? '正在读取 Word 文档…' : '拖入 Word、TXT、CSV 或 JSON 文件'}</b><span>Word 支持段落、列表与三列表格 · DOCX 最大 5MB</span></button>
          <input ref={fileRef} type="file" accept=".docx,.doc,.txt,.csv,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => readFile(e.target.files?.[0])} />
          <div className="or"><span />或直接粘贴<span /></div>
          <textarea className="import-textarea" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'猫\n食べる, たべる, 吃\n図書館\tとしょかん\t图书馆'} />
          <small className="format-hint"><FileText size={14} />每行一个词；也支持“单词, 读音, 释义”格式</small>
          {notice && <div className="modal-notice">{notice}</div>}
          <button className="primary-button modal-submit" disabled={!raw.trim()} onClick={() => parse()}>解析单词<ChevronRight size={18} /></button>
        </> : <>
          <div className="preview-heading"><b>识别到 {drafts.length} 个单词</b><button onClick={() => setDrafts([])}>重新编辑</button></div>
          <div className="import-preview">{drafts.map((draft, i) => <div key={`${draft.term}-${i}`}><span>{i + 1}</span><b className="jp">{draft.term}</b><small>{draft.reading || 'AI 自动识别读音'}</small><em>{draft.meaning || 'AI 自动查询释义'}</em></div>)}</div>
          {notice && <div className="modal-notice">{notice}</div>}
          <button className="primary-button modal-submit" disabled={loading} onClick={enrich}>{loading ? <><span className="spinner" />AI 正在整理词卡…</> : <><Sparkles size={18} />生成并导入词卡</>}</button>
        </>}
      </section>
    </div>
  )
}

function NewUnitModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal small-modal"><button className="modal-close" onClick={onClose}><X /></button><span className="modal-icon"><BookOpen /></span><h2>创建新单元</h2><p>相同主题的单词放进一个单元，复习会更高效。</p><label>单元名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：第四单元" /></label><label>主题说明<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如：旅行与住宿" /></label><button className="primary-button modal-submit" disabled={!name.trim()} onClick={() => onCreate(name.trim(), description.trim() || '我的词汇单元')}>创建单元</button></section></div>
}

function EmptyState({ onImport }: { onImport: () => void }) { return <div className="empty-state"><span><FileText /></span><b>这里还没有单词</b><p>导入 TXT、CSV、JSON，或直接粘贴词汇。</p><button onClick={onImport}>添加单词</button></div> }
function EmptyDetail({ onImport }: { onImport: () => void }) { return <div className="detail-card empty-detail"><BookOpen /><b>选择一个单词</b><p>查看释义、例句并练习发音。</p><button onClick={onImport}>导入词汇</button></div> }

export default App
