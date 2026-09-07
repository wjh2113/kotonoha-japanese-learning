import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, FileText, GraduationCap, Headphones, Import, LayoutGrid, List, Menu,
  Mic, MoreHorizontal, Pause, Play, Plus, Search, Sparkles, SquarePen, Trophy,
  UploadCloud, Volume2, X,
} from 'lucide-react'
import { initialUnits } from './data'
import type { ImportDraft, Unit, View, Word } from './types'
import { makeFallbackWord, parseVocabulary, pronunciationScore, shuffle, uid } from './utils'

const STORAGE_KEY = 'kotonoha-units-v1'
const COLORS = ['#dd5b43', '#668b87', '#d39a43', '#786f95', '#6d8d55']

function App() {
  const [units, setUnits] = useState<Unit[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '') } catch { return initialUnits }
  })
  const [unitId, setUnitId] = useState(units[0]?.id || '')
  const [view, setView] = useState<View>('study')
  const [selectedId, setSelectedId] = useState(units[0]?.words[0]?.id || '')
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [newUnitOpen, setNewUnitOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(units)), [units])
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

  const updateWord = (wordId: string, changes: Partial<Word>) => {
    setUnits((current) => current.map((item) => item.id === unitId
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

  const nav = (next: View) => { setView(next); setMobileNav(false) }

  return (
    <div className="app-shell">
      <Sidebar
        open={mobileNav} view={view} units={units} unitId={unitId} totalWords={totalWords}
        onView={nav} onUnit={(id) => { setUnitId(id); setView('study'); setMobileNav(false) }}
        onNewUnit={() => setNewUnitOpen(true)}
      />
      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Menu size={21} /></button>
          <div className="search-wrap">
            <Search size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索单词、假名或释义…" />
            <span className="shortcut">⌘ K</span>
          </div>
          <div className="daily-progress">
            <span className="progress-icon"><Trophy size={16} /></span>
            <span><b>今日进度</b><small>{mastered} / {Math.max(totalWords, 1)} 个单词</small></span>
            <div className="progress-track"><i style={{ width: `${Math.round(mastered / Math.max(totalWords, 1) * 100)}%` }} /></div>
          </div>
          <button className="help-button"><CircleHelp size={19} /></button>
          <div className="avatar">ゆ</div>
        </header>

        {view === 'study' && unit && (
          <StudyView
            unit={unit} selectedWord={selectedWord} search={search}
            onSelect={setSelectedId} onImport={() => setImportOpen(true)}
            onToggleMastered={(word) => updateWord(word.id, { mastered: !word.mastered })}
            onEdit={(word, changes) => updateWord(word.id, changes)}
            onPractice={() => setView('pronunciation')}
          />
        )}
        {view === 'pronunciation' && unit && <PronunciationView unit={unit} initialWord={selectedWord} onBack={() => setView('study')} />}
        {view === 'test' && unit && <TestView unit={unit} onBack={() => setView('study')} />}
      </main>

      {importOpen && unit && <ImportModal unit={unit} onClose={() => setImportOpen(false)} onImported={(words) => {
        setUnits((current) => current.map((item) => item.id === unit.id ? { ...item, words: [...item.words, ...words] } : item))
        if (words[0]) setSelectedId(words[0].id)
        setImportOpen(false); setToast(`已导入 ${words.length} 个单词`)
      }} />}
      {newUnitOpen && <NewUnitModal onClose={() => setNewUnitOpen(false)} onCreate={addUnit} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单" />}
    </div>
  )
}

function Sidebar({ open, view, units, unitId, totalWords, onView, onUnit, onNewUnit }: {
  open: boolean; view: View; units: Unit[]; unitId: string; totalWords: number
  onView: (view: View) => void; onUnit: (id: string) => void; onNewUnit: () => void
}) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark">葉</span><span><b>KOTONOHA</b><small>言の葉 · 日语学习</small></span></div>
      <nav className="main-nav">
        <button className={view === 'study' ? 'active' : ''} onClick={() => onView('study')}><BookOpen size={19} />学习</button>
        <button className={view === 'pronunciation' ? 'active' : ''} onClick={() => onView('pronunciation')}><AudioLines size={19} />发音练习</button>
        <button className={view === 'test' ? 'active' : ''} onClick={() => onView('test')}><GraduationCap size={19} />测试模式</button>
      </nav>
      <div className="sidebar-rule" />
      <div className="unit-heading"><span>我的单元</span><button onClick={onNewUnit}><Plus size={17} /></button></div>
      <div className="unit-list">
        {units.map((unit, index) => (
          <button key={unit.id} className={unit.id === unitId ? 'active' : ''} onClick={() => onUnit(unit.id)}>
            <span className="unit-index" style={{ '--unit-color': unit.color } as React.CSSProperties}>{String(index + 1).padStart(2, '0')}</span>
            <span><b>{unit.name}</b><small>{unit.words.length} 个单词</small></span>
            {unit.id === unitId && <span className="current-dot" />}
          </button>
        ))}
      </div>
      <button className="new-unit" onClick={onNewUnit}><Plus size={17} />新建单元</button>
      <div className="sidebar-footer">
        <span><Sparkles size={16} /></span>
        <div><b>{totalWords} 个词汇</b><small>坚持，就是最好的天赋。</small></div>
      </div>
    </aside>
  )
}

function StudyView({ unit, selectedWord, search, onSelect, onImport, onToggleMastered, onEdit, onPractice }: {
  unit: Unit; selectedWord?: Word; search: string; onSelect: (id: string) => void; onImport: () => void
  onToggleMastered: (word: Word) => void; onEdit: (word: Word, changes: Partial<Word>) => void; onPractice: () => void
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
          {selectedWord ? <WordDetail word={selectedWord} onToggle={() => onToggleMastered(selectedWord)} onEdit={(changes) => onEdit(selectedWord, changes)} onPractice={onPractice} /> : <EmptyDetail onImport={onImport} />}
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
  const speak = (event: React.MouseEvent) => {
    event.stopPropagation()
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(sentence ? word.example : word.term)
    utterance.lang = 'ja-JP'; utterance.rate = sentence ? 0.82 : 0.72
    const voices = speechSynthesis.getVoices()
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ja')) || null
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    speechSynthesis.speak(utterance)
  }
  return <button className={`volume-button ${small ? 'small' : ''} ${speaking ? 'speaking' : ''}`} onClick={speak} aria-label="朗读">{speaking ? <Pause size={small ? 14 : 19} /> : <Volume2 size={small ? 14 : 19} />}</button>
}

function WordDetail({ word, onToggle, onEdit, onPractice }: { word: Word; onToggle: () => void; onEdit: (changes: Partial<Word>) => void; onPractice: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(word)
  useEffect(() => { setDraft(word); setEditing(false) }, [word])
  const save = () => { onEdit(draft); setEditing(false) }

  return (
    <div className="detail-card">
      <div className="detail-actions"><button onClick={() => setEditing(!editing)}><SquarePen size={17} /></button><button><MoreHorizontal size={19} /></button></div>
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

function TestView({ unit, onBack }: { unit: Unit; onBack: () => void }) {
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

function ImportModal({ unit, onClose, onImported }: { unit: Unit; onClose: () => void; onImported: (words: Word[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<ImportDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parse = (text = raw) => { const next = parseVocabulary(text); setDrafts(next); setNotice(next.length ? '' : '没有识别到单词，请检查格式。') }
  const readFile = async (file?: File) => {
    if (!file) return
    if (file.size > 1024 * 1024) { setNotice('文件请控制在 1MB 以内。'); return }
    const text = await file.text(); setRaw(text); parse(text)
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
          <button className="drop-zone" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]) }}><UploadCloud /><b>拖入 TXT、CSV 或 JSON 文件</b><span>或点击选择文件 · 最大 1MB</span></button>
          <input ref={fileRef} type="file" accept=".txt,.csv,.json" hidden onChange={(e) => readFile(e.target.files?.[0])} />
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
