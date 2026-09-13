import { useContext, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Bot, CheckCircle2, ChevronLeft, ChevronRight, Circle, Copy, Eye, FileText, Headphones, LoaderCircle, Mic, Pause, Play,
  RefreshCw, Repeat, ScrollText, SquarePen, Trash2, TriangleAlert, UploadCloud, Volume2, X,
} from 'lucide-react'
import { apiFetch, readApiJson } from './api'
import { readPassageSource } from './docx'
import { isPassagePlaceholder, looksLikeErrorDocument, publicApiMessage } from './error-text'
import {
  chunkItems, hasChineseTranslation, isPrimarilyChineseLine, isTransientPassage, mergeAnalyzedSentences, mergePassageBooks,
  normalizePassageSentence, passageProgressSummary, parsePassageHandbook, recordSentenceDictation, recordSentenceScore,
  recoverInterruptedIngest, sentenceNeedsAnalysis,
} from './passage'
import { PassageIntensive } from './PassageIntensive'
import { usePronunciationPractice } from './pronunciation-practice'
import { SettingsContext } from './settings-context'
import { speakJapanese, speakJapaneseQueue, stopSpeaking } from './speech'
import type { Passage, PassageBook, PassageSentence } from './types'
import { normalizeJapanese, pronunciationScoreFor, uid } from './utils'

type Mode = 'source' | 'intensive' | 'shadow'

function passageTitle(value?: string, fallback = '课文') {
  return String(value || '').trim().slice(0, 80) || fallback
}

function hydrateProgress(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const next: NonNullable<Passage['progress']> = {}
  for (const [id, row] of Object.entries(value as Record<string, any>)) {
    if (!id || !row || typeof row !== 'object') continue
    next[id] = {
      attempts: Math.max(0, Number(row.attempts) || 0),
      lastScore: Math.max(0, Math.min(100, Number(row.lastScore) || 0)),
      bestScore: Math.max(0, Math.min(100, Number(row.bestScore) || 0)),
      ...(typeof row.dictation === 'string' ? { dictation: row.dictation.slice(0, 2000) } : {}),
    }
  }
  return next
}

function hydratePassage(item: unknown): Passage | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Partial<Passage> & { sentences?: unknown[] }
  const id = String(record.id || '').trim()
  if (!id) return null
  const sentences = Array.isArray(record.sentences) ? record.sentences : []
  const status = record.status === 'processing' || record.status === 'error' ? record.status : 'ready'
  return recoverInterruptedIngest({
    id,
    title: passageTitle(record.title),
    sourceText: String(record.sourceText || ''),
    createdAt: Number(record.createdAt) || Date.now(),
    bookId: String(record.bookId || '').trim(),
    bookName: String(record.bookName || '').trim(),
    progress: hydrateProgress(record.progress),
    status,
    statusText: String(record.statusText || ''),
    sentences: sentences.map((sentence) => {
      const next = normalizePassageSentence(sentence, uid())
      return { ...next, id: next.id || uid() }
    }).filter((sentence) => sentence.text),
  })
}

export function PassageView() {
  const { voiceGender } = useContext(SettingsContext)
  const [passages, setPassages] = useState<Passage[]>([])
  const [books, setBooks] = useState<PassageBook[]>([])
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<Mode>('source')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [catalogOpen, setCatalogOpen] = useState(true)
  const [draftBookId, setDraftBookId] = useState('')
  const [query, setQuery] = useState('')
  const [sourceEditing, setSourceEditing] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [playingFull, setPlayingFull] = useState(false)
  const [shadowRetry, setShadowRetry] = useState(0)
  const [playSpeed, setPlaySpeed] = useState(1)
  const [playLoop, setPlayLoop] = useState(false)
  const persistError = useRef(false)
  const persistEnabled = useRef(false)
  const ingesting = useRef(false)
  const analyzing = useRef(new Set<string>())
  const ingestingIds = useRef(new Set<string>())
  const resumed = useRef(false)
  const passagesRef = useRef<Passage[]>([])
  const fillPassageRef = useRef<(id: string) => Promise<void>>(async () => undefined)
  const activeSentenceRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => () => stopSpeaking(), [])

  // Only follow the active line when the index changes — not on every render.
  // An inline callback ref would re-fire scrollIntoView after any state update and fight the wheel.
  useEffect(() => {
    activeSentenceRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [sentenceIndex, mode, selectedId])

  const commitPassages = (next: Passage[]) => {
    passagesRef.current = next
    setPassages(next)
  }

  const patchPassage = (id: string, changes: Partial<Passage>) => {
    commitPassages(passagesRef.current.map((item) => item.id === id ? { ...item, ...changes } : item))
  }

  const fillPassage = async (passageId: string) => {
    if (analyzing.current.has(passageId)) return
    analyzing.current.add(passageId)
    try {
      const current = passagesRef.current.find((item) => item.id === passageId)
      if (!current) return
      if (isTransientPassage(current) || current.sentences.some((sentence) => isPassagePlaceholder(sentence.text))) {
        // Still being built by processIngest — wait for the next call with real source text.
        if (ingestingIds.current.has(passageId)) return
        patchPassage(passageId, {
          status: 'error',
          statusText: '课文识别未完成，请重新上传或粘贴原文。',
          sourceText: looksLikeErrorDocument(current.sourceText) ? '' : current.sourceText,
          sentences: current.sentences.filter((sentence) => !isPassagePlaceholder(sentence.text)),
          title: looksLikeErrorDocument(current.title) ? '课文' : current.title,
        })
        return
      }
      if (!current.sentences.length) {
        patchPassage(passageId, { status: 'error', statusText: '还没有可解析的句子，请重新上传或粘贴原文。' })
        return
      }
      const pending = current.sentences.filter(sentenceNeedsAnalysis)
      if (!pending.length) {
        // Mark Chinese notes as self-translated so UI leaves "生成中".
        const normalized = current.sentences.map((sentence) => (
          isPrimarilyChineseLine(sentence.text)
            ? {
                ...sentence,
                translation: sentence.text,
                reading: '',
                tokens: [{ surface: sentence.text, reading: '', meaning: sentence.text }],
                grammar: [],
              }
            : sentence
        ))
        patchPassage(passageId, { sentences: normalized, status: 'ready', statusText: '' })
        return
      }
      // Prefill Chinese instructional lines (and repair any previously mis-merged results).
      patchPassage(passageId, {
        sentences: current.sentences.map((sentence) => (
          isPrimarilyChineseLine(sentence.text)
            ? {
                ...sentence,
                translation: sentence.text,
                reading: '',
                tokens: [{ surface: sentence.text, reading: '', meaning: sentence.text }],
                grammar: [],
              }
            : sentence
        )),
      })
      const latestForPending = passagesRef.current.find((item) => item.id === passageId) || current
      const work = latestForPending.sentences.filter(sentenceNeedsAnalysis)
      const total = latestForPending.sentences.length
      // 表格导入的课文已有翻译，只需补读音/逐词，提示语区分开。
      const fillingGapsOnly = work.length > 0 && work.every((sentence) => hasChineseTranslation(sentence.translation))
      const progressLabel = (done: number) => fillingGapsOnly ? `正在补全读音与逐词注释 ${done}/${total}` : `正在生成整句翻译 ${done}/${total}`
      let finished = total - work.length
      let chunkErrors = 0
      for (const chunk of chunkItems(work)) {
        if (!passagesRef.current.some((item) => item.id === passageId)) return
        patchPassage(passageId, { status: 'processing', statusText: progressLabel(finished) })
        try {
          const controller = new AbortController()
          const timeout = window.setTimeout(() => controller.abort(), 100_000)
          let response: Response
          try {
            response = await apiFetch('/api/passage/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sentences: chunk.map((sentence) => ({ text: sentence.text })) }),
              signal: controller.signal,
            })
          } finally {
            window.clearTimeout(timeout)
          }
          const data = await readApiJson<{ title?: string; sentences?: unknown[]; error?: string }>(response, '课文解析失败，请稍后重试。')
          if (!response.ok) throw new Error(publicApiMessage(data.error, '课文解析失败，请稍后重试。'))
          const latest = passagesRef.current.find((item) => item.id === passageId)
          if (!latest) return
          finished = Math.min(total, finished + chunk.length)
          const analyzedTitle = passageTitle(data.title, '')
          patchPassage(passageId, {
            sentences: mergeAnalyzedSentences(latest.sentences, data.sentences || []),
            status: 'processing',
            statusText: progressLabel(finished),
            ...(latest.title === '课文' && analyzedTitle && !looksLikeErrorDocument(analyzedTitle) ? { title: analyzedTitle } : {}),
          })
        } catch (reason) {
          chunkErrors += 1
          console.error('passage analyze chunk failed:', reason)
        }
      }
      const latest = passagesRef.current.find((item) => item.id === passageId)
      if (!latest) return
      const missing = latest.sentences.filter((sentence) => !hasChineseTranslation(sentence.translation)).length
      patchPassage(passageId, {
        status: missing ? 'error' : 'ready',
        statusText: missing
          ? (chunkErrors ? `还有 ${missing} 句没有中文翻译（${chunkErrors} 批失败），可点重试` : `还有 ${missing} 句没有中文翻译，可点重试`)
          : '',
      })
    } catch (reason) {
      const latest = passagesRef.current.find((item) => item.id === passageId)
      patchPassage(passageId, {
        status: 'error',
        statusText: publicApiMessage(reason instanceof Error ? reason.message : '', '课文解析失败，请稍后重试。'),
        ...(latest && looksLikeErrorDocument(latest.title) ? { title: '课文' } : {}),
        ...(latest && looksLikeErrorDocument(latest.sourceText) ? { sourceText: '' } : {}),
      })
    } finally {
      analyzing.current.delete(passageId)
    }
  }
  fillPassageRef.current = fillPassage

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/passages').then(async (response) => {
      const data = await readApiJson<{ passages?: unknown[]; books?: unknown[]; error?: string }>(response)
      if (cancelled || !response.ok) throw new Error(publicApiMessage(data.error, '读取课文失败'))
      const next = (Array.isArray(data.passages) ? data.passages as unknown[] : []).map(hydratePassage).filter((item): item is Passage => Boolean(item))
      persistEnabled.current = true
      const localKeep = passagesRef.current.filter((item) => (
        ingestingIds.current.has(item.id)
        || item.status === 'processing'
        || isTransientPassage(item)
      ))
      const merged = [
        ...localKeep.filter((item) => !next.some((row) => row.id === item.id)),
        ...next,
      ].slice(0, 50)
      commitPassages(merged)
      setBooks(mergePassageBooks(Array.isArray(data.books) ? data.books as { id: string; name: string }[] : [], merged))
      setSelectedId((current) => merged.some((item) => item.id === current) ? current : (merged[0]?.id || ''))
      setReady(true)
    }).catch(() => {
      if (!cancelled) { setNotice('暂时无法读取已保存的课文'); setReady(true) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || resumed.current) return
    resumed.current = true
    const pending = passages.filter((item) => (
      !isTransientPassage(item)
      && item.sentences.some((sentence) => sentence.text && !isPassagePlaceholder(sentence.text) && sentenceNeedsAnalysis(sentence))
    ))
    void (async () => {
      for (const item of pending) await fillPassageRef.current(item.id)
    })()
  }, [ready, passages])

  useEffect(() => {
    if (!ready || !persistEnabled.current) return
    const timer = window.setTimeout(async () => {
      try {
        const durable = passagesRef.current.filter((item) => !isTransientPassage(item))
        // Never wipe the DB with [] while OCR stubs are still in flight.
        if (!durable.length && passagesRef.current.some((item) => isTransientPassage(item) || ingestingIds.current.has(item.id))) {
          return
        }
        const response = await apiFetch('/api/passages', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passages: durable, books }),
        })
        if (!response.ok) throw new Error('WRITE_FAILED')
        persistError.current = false
      } catch {
        if (!persistError.current) {
          persistError.current = true
          setNotice('课文保存失败，请检查服务状态')
        }
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [passages, books, ready])

  const passage = passages.find((item) => item.id === selectedId) || passages[0]
  const sentence = passage?.sentences[sentenceIndex]
  const visiblePassages = passages.filter((item) => {
    const needle = query.trim()
    if (!needle) return true
    return item.title.includes(needle) || item.sourceText.includes(needle) || (item.bookName || '').includes(needle)
  })
  const summary = passage ? passageProgressSummary(passage) : { total: 0, practiced: 0, average: 0 }

  useEffect(() => {
    setSentenceIndex(0)
    setSourceEditing(false)
    setMode('source')
    setPlayingFull(false)
    stopSpeaking()
  }, [selectedId])

  const queueHandbook = (text: string) => {
    if (!ready) {
      setNotice('课文库还在加载，请稍后再试。')
      return
    }
    const imported = parsePassageHandbook(text)
    if (!imported?.lessons.length) {
      setNotice('未识别到「课文整理」手册格式。请使用下载的 .md 模版（含 ## 课文N 与「原文 / 中文解释」表）。')
      return
    }
    const book = books.find((item) => item.id === draftBookId)
    const lessons = [...imported.lessons].reverse()
    let selected = ''
    for (const [index, lesson] of lessons.entries()) {
      const isLast = index === lessons.length - 1
      const stub: Passage = {
        id: uid(),
        title: passageTitle(lesson.title),
        sourceText: lesson.sourceText,
        createdAt: Date.now(),
        status: 'processing',
        statusText: '手册已导入，正在补全读音…',
        bookId: book?.id || '',
        bookName: book?.name || '',
        sentences: lesson.sentences,
      }
      persistEnabled.current = true
      commitPassages([stub, ...passagesRef.current.filter((item) => item.id !== stub.id)].slice(0, 50))
      selected = stub.id
      ingestingIds.current.add(stub.id)
      void fillPassage(stub.id)
      if (isLast) {
        setSelectedId(stub.id)
        setMode('source')
        setUploadOpen(false)
      }
    }
    if (selected) setSelectedId(selected)
    setNotice(
      imported.lessons.length > 1
        ? `已导入 ${imported.lessons.length} 篇课文（${imported.documentTitle || '手册'}），正在后台补全读音。`
        : '手册已导入，正在后台补全读音。',
    )
  }

  const readUpload = async (file?: File) => {
    if (!file || ingesting.current) return
    if (!ready) { setNotice('课文库还在加载，请稍后再试。'); return }
    ingesting.current = true
    setBusy('正在读取课文手册…')
    setNotice('')
    try {
      const source = await readPassageSource(file)
      queueHandbook(source.text)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '课文读取失败。')
    } finally {
      ingesting.current = false
      setBusy('')
    }
  }

  const goSentence = (index: number, speak = false) => {
    if (!passage || index < 0 || index >= passage.sentences.length) return
    setPlayingFull(false)
    stopSpeaking()
    setSentenceIndex(index)
    const next = passage.sentences[index]
    if (speak) void speakJapanese(next.text, voiceGender, { sentence: true })
  }

  const playFrom = (startIndex = 0) => {
    if (!passage?.sentences.length) return
    if (playingFull) {
      stopSpeaking()
      setPlayingFull(false)
      return
    }
    const start = Math.max(0, Math.min(startIndex, passage.sentences.length - 1))
    setPlayingFull(true)
    setSentenceIndex(start)
    const run = (from: number) => {
      void speakJapaneseQueue(passage.sentences.slice(from).map((item) => item.text), voiceGender, {
        sentence: true,
        speed: playSpeed,
        onIndex: (index) => setSentenceIndex(from + index),
        onAllEnd: () => {
          if (playLoop) run(0)
          else setPlayingFull(false)
        },
      })
    }
    run(start)
  }

  const playAll = () => playFrom(0)

  const playCurrentLine = () => {
    if (!passage?.sentences[sentenceIndex]) return
    if (playingFull) {
      stopSpeaking()
      setPlayingFull(false)
      return
    }
    goSentence(sentenceIndex, true)
  }

  const copySource = async () => {
    if (!passage?.sourceText) return
    try {
      await navigator.clipboard.writeText(passage.sourceText)
      setNotice('原文已复制。')
    } catch {
      setNotice('复制失败，请手动选择原文。')
    }
  }

  const saveSource = () => {
    if (!passage) return
    const sourceText = sourceDraft.trim()
    if (!sourceText) { setNotice('原文不能为空。'); return }
    patchPassage(passage.id, { sourceText })
    setSourceEditing(false)
    setNotice('原文已保存。如需按新原文重新拆句，请点「重新解析」。')
  }

  const reanalyze = () => {
    if (!passage) return
    if (!passage.sentences.length) { setNotice('没有句子可以重新解析。'); return }
    setSourceEditing(false)
    // 保留手册导入的原文/翻译/语法，只重新补读音与逐词。
    patchPassage(passage.id, {
      sentences: passage.sentences.map((item) => ({ ...item, reading: '', tokens: item.tokens?.length ? [] : item.tokens })),
      progress: {},
      status: 'processing',
      statusText: '正在补全读音与逐词注释…',
    })
    setSentenceIndex(0)
    setMode('source')
    void fillPassage(passage.id)
  }

  const createBook = (assignCurrent = false) => {
    const name = window.prompt('课本名称，例如：大家的日语 第1册', '大家的日语 第1册')?.trim().slice(0, 80)
    if (!name) return
    const next = { id: uid(), name }
    setBooks((current) => [...current, next])
    setDraftBookId(next.id)
    if (assignCurrent && passage) patchPassage(passage.id, { bookId: next.id, bookName: next.name })
  }

  const renameBook = (book: PassageBook) => {
    const name = window.prompt('课本名称', book.name)?.trim().slice(0, 80)
    if (!name) return
    setBooks((current) => current.map((item) => item.id === book.id ? { ...item, name } : item))
    commitPassages(passagesRef.current.map((item) => item.bookId === book.id ? { ...item, bookName: name } : item))
  }

  const deleteBook = (book: PassageBook) => {
    if (!window.confirm(`删除课本「${book.name}」？课文会回到未分组，不会被删。`)) return
    setBooks((current) => current.filter((item) => item.id !== book.id))
    commitPassages(passagesRef.current.map((item) => item.bookId === book.id ? { ...item, bookId: '', bookName: '' } : item))
    if (draftBookId === book.id) setDraftBookId('')
  }

  const movePassage = (bookId: string) => {
    if (!passage) return
    const book = books.find((item) => item.id === bookId)
    patchPassage(passage.id, { bookId: book?.id || '', bookName: book?.name || '' })
  }

  const renderPassageButton = (item: Passage) => {
    const progress = passageProgressSummary(item)
    const done = progress.total > 0 && progress.practiced >= progress.total
    return (
      <button key={item.id} type="button" className={`passage-item ${item.id === passage?.id ? 'active' : ''}`} onClick={() => { setSelectedId(item.id); setMode('source') }}>
        <span className="passage-item-status">
          {done ? <CheckCircle2 size={14} strokeWidth={1.6} /> : <Circle size={14} strokeWidth={1.6} />}
        </span>
        <span className="passage-item-copy">
          <strong>{item.title}</strong>
          <small>
            {item.status === 'processing' ? (item.statusText || '处理中…')
              : item.status === 'error' ? (item.statusText || '处理失败')
                : `${item.sentences.length} 句${progress.practiced ? ` · 已跟读 ${progress.practiced}/${progress.total}` : ''}`}
          </small>
        </span>
        <ChevronRight size={14} strokeWidth={1.6} className="passage-item-arrow" />
      </button>
    )
  }

  const orderedPassages = [
    ...books.flatMap((book) => visiblePassages.filter((item) => item.bookId === book.id)),
    ...visiblePassages.filter((item) => !item.bookId),
  ]
  const passageOrderIndex = passage ? orderedPassages.findIndex((item) => item.id === passage.id) : -1
  const nextPassage = passageOrderIndex >= 0 ? orderedPassages[passageOrderIndex + 1] : undefined
  const progressPct = passage?.sentences.length
    ? Math.round(((sentenceIndex + (playingFull ? 0.4 : 0)) / Math.max(passage.sentences.length, 1)) * 100)
    : 0

  const grammarPoints = (() => {
    if (!passage) return [] as NonNullable<PassageSentence['grammar']>
    const seen = new Set<string>()
    return passage.sentences.flatMap((item) => item.grammar || []).filter((point) => {
      const key = `${point.name}|${point.pattern}`
      if (!point.name || seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()

  return (
    <div className="page hub-page passage-page passage-design">
      <section className="hub-hero passage-hero-compact">
        <div>
          <h1>课文学习</h1>
          <p>点选课程目录进入原文；可切换精听与跟读。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" disabled={!ready} onClick={() => setUploadOpen(true)}><UploadCloud size={17} strokeWidth={1.6} />添加课文</button>
        </div>
      </section>

      {notice && <div className="passage-notice">{notice}<button onClick={() => setNotice('')} aria-label="关闭"><X size={14} /></button></div>}

      {passages.length ? (
        <div className={`passage-workspace ${catalogOpen ? '' : 'catalog-hidden'}`.trim()}>
          {catalogOpen && (
            <aside className="passage-nav-col">
              <section className="passage-catalog">
                <header><BookOpen size={15} strokeWidth={1.6} /><b>课程目录</b></header>
                <input className="passage-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或原文" />
                <button type="button" className="passage-book-new" onClick={() => createBook(false)}><BookOpen size={14} strokeWidth={1.6} />新建课本</button>
                <div className="passage-catalog-scroll">
                  {books.map((book) => {
                    const items = visiblePassages.filter((item) => item.bookId === book.id)
                    if (query.trim() && !items.length && !book.name.includes(query.trim())) return null
                    return (
                      <div key={book.id} className="passage-book">
                        <div className="passage-book-head">
                          <strong>{book.name}</strong>
                          <span>
                            <button type="button" onClick={() => renameBook(book)}>改</button>
                            <button type="button" onClick={() => deleteBook(book)}>删</button>
                          </span>
                        </div>
                        {items.map(renderPassageButton)}
                        {!items.length && <small className="passage-list-empty">还没有课文</small>}
                      </div>
                    )
                  })}
                  <div className="passage-book">
                    <div className="passage-book-head"><strong>未分组</strong></div>
                    {visiblePassages.filter((item) => !item.bookId).map(renderPassageButton)}
                  </div>
                  {query.trim() && !visiblePassages.length && <small className="passage-list-empty">没有匹配的课文</small>}
                </div>
              </section>
              {passage && (
                <section className="passage-outline">
                  <header><FileText size={15} strokeWidth={1.6} /><b>课文解析</b></header>
                  <div className="passage-outline-scroll">
                    {passage.sentences.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`passage-outline-item ${index === sentenceIndex ? 'active' : ''}`}
                        onClick={() => goSentence(index, true)}
                      >
                        <em>{index + 1}</em>
                        <span className="jp">{item.text}</span>
                        <ChevronRight size={14} strokeWidth={1.6} />
                      </button>
                    ))}
                    {!passage.sentences.length && <small className="passage-list-empty">暂无句子</small>}
                  </div>
                </section>
              )}
            </aside>
          )}

          {passage ? (
            <section className="passage-stage">
              {passage.status === 'processing' && Date.now() - (passage.createdAt || 0) > 120_000 && (
                <div className="passage-status error">
                  识别时间过长，可删除后重试，或改粘贴正文。
                  <button type="button" onClick={() => setUploadOpen(true)}>重新添加</button>
                </div>
              )}

              <div className="passage-stage-head">
                <label className="passage-title-label">
                  <SquarePen size={14} strokeWidth={1.6} />
                  <input
                    className="passage-title-input"
                    value={passage.title}
                    maxLength={80}
                    aria-label="课文标题"
                    onChange={(event) => patchPassage(passage.id, { title: event.target.value.slice(0, 80) })}
                    onBlur={(event) => patchPassage(passage.id, { title: passageTitle(event.target.value) })}
                  />
                </label>
                <div className="passage-toolbar-actions">
                  <button type="button" className="remove-word" onClick={() => {
                    if (!window.confirm(`删除课文「${passage.title}」？此操作不可恢复。`)) return
                    ingestingIds.current.delete(passage.id)
                    const remaining = passagesRef.current.filter((item) => item.id !== passage.id)
                    commitPassages(remaining)
                    setSelectedId(remaining[0]?.id || '')
                  }}><Trash2 size={15} strokeWidth={1.6} />删除</button>
                </div>
              </div>

              <div className="passage-modes">
                {([
                  ['source', '原文', BookOpen],
                  ['intensive', '精听', Headphones],
                  ['shadow', '跟读', Mic],
                ] as const).map(([id, label, Icon]) => (
                  <button key={id} type="button" className={mode === id ? 'active' : ''} onClick={() => {
                    setMode(id)
                    if (id === 'source') {
                      setSourceDraft(passage.sourceText)
                      setSourceEditing(false)
                      setPlayingFull(false)
                      stopSpeaking()
                    }
                  }}><Icon size={14} strokeWidth={1.6} />{label}</button>
                ))}
                <button
                  type="button"
                  className="passage-reparse"
                  disabled={passage.status === 'processing' || !(sourceEditing ? sourceDraft : passage.sourceText).trim()}
                  onClick={reanalyze}
                >
                  <RefreshCw size={14} strokeWidth={1.6} />重新解析
                </button>
                {!catalogOpen && (
                  <button
                    type="button"
                    className="passage-reparse"
                    onClick={() => setCatalogOpen(true)}
                  >
                    <Eye size={14} strokeWidth={1.6} />显示目录
                  </button>
                )}
                {catalogOpen && (
                  <button
                    type="button"
                    className="passage-reparse"
                    onClick={() => setCatalogOpen(false)}
                  >
                    <Eye size={14} strokeWidth={1.6} />隐藏目录
                  </button>
                )}
              </div>

              <div className="passage-stage-body">
              {mode === 'intensive' ? (
                <PassageIntensive
                  passage={passage}
                  voiceGender={voiceGender}
                  sentenceIndex={sentenceIndex}
                  playing={playingFull}
                  catalogOpen={catalogOpen}
                  onToggleCatalog={() => setCatalogOpen((open) => !open)}
                  onIndex={setSentenceIndex}
                  onPlaying={setPlayingFull}
                  onDictation={(sentenceId, text) => patchPassage(passage.id, {
                    progress: recordSentenceDictation(passage.progress, sentenceId, text),
                  })}
                  onBack={() => { setPlayingFull(false); stopSpeaking(); setMode('source') }}
                />
              ) : mode === 'shadow' && sentence ? (
                <div className="shadow-layout shadow-design">
                  <section className="shadow-list-card">
                    <header>
                      <b><FileText size={15} strokeWidth={1.6} />逐句原文</b>
                      <small>{sentenceIndex + 1} / {passage.sentences.length}</small>
                    </header>
                    <ol className="passage-sentences shadow-list">
                      {passage.sentences.map((item, index) => (
                        <li key={item.id}>
                          <button type="button" className={index === sentenceIndex ? 'active' : ''} onClick={() => { setSentenceIndex(index); void speakJapanese(item.text, voiceGender, { sentence: true }) }}>
                            <em>{index + 1}</em>
                            <span className="intensive-line-play" aria-hidden><Play size={14} strokeWidth={1.6} /></span>
                            <span className="jp">{item.text}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                    <footer>
                      <button type="button" className="intensive-play-all" onClick={playAll}>
                        {playingFull ? <Pause size={15} strokeWidth={1.6} /> : <Play size={15} strokeWidth={1.6} />}
                        {playingFull ? '停止播放' : '播放全部'}
                      </button>
                    </footer>
                  </section>
                  <article className="shadow-panel">
                    <header>
                      <b><Bot size={15} strokeWidth={1.6} />AI 发音评估</b>
                      <small>{sentenceIndex + 1} / {passage.sentences.length}</small>
                    </header>
                    <h3 className="jp shadow-target">{sentence.text}</h3>
                    {sentence.reading && <p className="jp shadow-reading">{sentence.reading}</p>}
                    {hasChineseTranslation(sentence.translation) && <p className="translation">{sentence.translation}</p>}
                    <SentencePronunciation
                      sentence={sentence}
                      onScore={(score) => patchPassage(passage.id, { progress: recordSentenceScore(passage.progress, sentence.id, score) })}
                      resetKey={`${sentence.id}-${shadowRetry}`}
                    />
                    <div className="shadow-footer">
                      <button type="button" className="secondary-button" onClick={() => setShadowRetry((n) => n + 1)}>
                        <RefreshCw size={15} strokeWidth={1.6} />重新跟读
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={sentenceIndex >= passage.sentences.length - 1}
                        onClick={() => setSentenceIndex((i) => i + 1)}
                      >
                        下一句<ChevronRight size={16} strokeWidth={1.6} />
                      </button>
                    </div>
                  </article>
                </div>
              ) : mode === 'source' ? (
                <article className="passage-reader">
                  <div className="passage-audio-bar">
                    <button
                      type="button"
                      className="passage-audio-play"
                      onClick={() => playFrom(sentenceIndex)}
                      aria-label={playingFull ? '暂停' : '播放'}
                    >
                      {playingFull ? <Pause size={18} strokeWidth={1.6} /> : <Play size={18} strokeWidth={1.6} />}
                    </button>
                    <div className="passage-audio-progress" aria-hidden>
                      <i style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
                    </div>
                    <em>{sentenceIndex + 1} / {Math.max(passage.sentences.length, 1)}</em>
                    <select
                      className="passage-speed"
                      value={playSpeed}
                      aria-label="播放速度"
                      onChange={(event) => setPlaySpeed(Number(event.target.value))}
                    >
                      <option value={0.75}>0.75x</option>
                      <option value={1}>1x</option>
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.5x</option>
                    </select>
                    <button
                      type="button"
                      className={`passage-loop ${playLoop ? 'active' : ''}`}
                      onClick={() => setPlayLoop((value) => !value)}
                      aria-label="循环播放"
                    >
                      <Repeat size={15} strokeWidth={1.6} />
                    </button>
                  </div>

                  <div className="passage-source-actions">
                    <button type="button" onClick={() => { setSourceDraft(passage.sourceText); setSourceEditing(true) }}><SquarePen size={15} strokeWidth={1.6} />编辑原文</button>
                    <button type="button" disabled={!passage.sourceText} onClick={() => void copySource()}><Copy size={15} strokeWidth={1.6} />复制原文</button>
                    <label className="passage-book-assign">课本
                      <select value={passage.bookId || ''} onChange={(event) => movePassage(event.target.value)}>
                        <option value="">未分组</option>
                        {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
                      </select>
                    </label>
                  </div>

                  {sourceEditing ? (
                    <>
                      <textarea className="passage-source-editor jp" value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} rows={12} />
                      <div className="passage-source-actions">
                        <button type="button" className="primary-button" onClick={saveSource}>保存原文</button>
                        <button type="button" onClick={() => { setSourceEditing(false); setSourceDraft(passage.sourceText) }}>取消</button>
                      </div>
                    </>
                  ) : passage.sentences.length ? (
                    <>
                      <ol className="passage-bilingual">
                        {passage.sentences.map((item, index) => {
                          const active = index === sentenceIndex
                          return (
                            <li
                              key={item.id}
                              className={`${active ? 'active' : ''} ${playingFull && active ? 'speaking' : ''}`}
                              ref={active ? activeSentenceRef : undefined}
                            >
                              <button type="button" className="passage-bilingual-row" onClick={() => goSentence(index, true)}>
                                <em>{index + 1}</em>
                                <span className="passage-bilingual-jp">
                                  <span className="jp">{item.text}</span>
                                  {item.reading && <small className="jp passage-furi">{item.reading}</small>}
                                </span>
                                {hasChineseTranslation(item.translation) && (
                                  <span className="passage-bilingual-tr">{item.translation}</span>
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ol>

                      <section className="passage-grammar-block" aria-label="本课语法说明">
                        <h4><ScrollText size={15} strokeWidth={1.6} />本课语法说明</h4>
                        {grammarPoints.length ? (
                          <div className="passage-grammar-cards">
                            {grammarPoints.map((point, index) => (
                              <article key={`${point.name}-${index}`}>
                                <b>{index + 1}. {point.pattern || point.name}</b>
                                {point.name && point.pattern && <code>{point.name}</code>}
                                {point.explanation && (
                                  <div className="passage-grammar-tip">
                                    <span>用法提示</span>
                                    <em>{point.explanation}</em>
                                  </div>
                                )}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="passage-grammar-empty">
                            {passage.status === 'processing' ? '语法点整理中，解析完成后会显示在这里。' : '本课暂无语法标注。'}
                          </p>
                        )}
                      </section>
                    </>
                  ) : (
                    <pre className="jp passage-source">{passage.sourceText || '这篇课文还没有可点选的句子。可以点「编辑原文」补上后重新解析。'}</pre>
                  )}
                </article>
              ) : null}
              </div>

              <footer className="passage-lesson-footer">
                <b>{passage.title}</b>
                <div className="passage-lesson-progress">
                  <span>{Math.min(sentenceIndex + 1, passage.sentences.length || 1)} / {Math.max(passage.sentences.length, 1)}</span>
                  <i><em style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} /></i>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!nextPassage}
                  onClick={() => {
                    if (!nextPassage) return
                    setSelectedId(nextPassage.id)
                    setMode('source')
                    setSentenceIndex(0)
                    setPlayingFull(false)
                    stopSpeaking()
                  }}
                >
                  下一课<ChevronRight size={16} strokeWidth={1.6} />
                </button>
              </footer>
            </section>
          ) : (
            <div className="wide-empty compact"><ScrollText /><h2>选择左侧课程</h2><p>从课程目录点开一篇课文开始学习。</p></div>
          )}
        </div>
      ) : (
        <div className="wide-empty">
          <ScrollText />
          <h2>还没有课文</h2>
          <p>请上传「课文整理」Markdown 手册（按模版填写）。系统会按「课文N」拆篇入库，翻译与语法考点原样保留。</p>
          <button onClick={() => setUploadOpen(true)}>添加课文</button>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setUploadOpen(false)}>
          <section className="modal import-modal">
            <button className="modal-close" onClick={() => !busy && setUploadOpen(false)}><X /></button>
            <span className="modal-icon"><FileText /></span>
            <span className="eyebrow">PASSAGE HANDBOOK</span>
            <h2>添加课文</h2>
            <p>仅支持「课文整理」Markdown 模版。不接受 Word、图片、粘贴或自由正文，以保证翻译与语法数据准确。</p>
            <div className="import-template-row">
              <a className="secondary-button import-template-link" href="/templates/课文导入模版.md" download="课文导入模版.md">
                下载导入模版
              </a>
              <small>结构：# 课次 → ## 课文N → 原文/中文表 → 语法考点</small>
            </div>
            <label className="passage-add-title">课本/分组
              <span className="passage-book-row">
                <select value={draftBookId} onChange={(event) => setDraftBookId(event.target.value)}>
                  <option value="">未分组</option>
                  {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
                </select>
                <button type="button" onClick={() => createBook(false)}>新建课本</button>
              </span>
            </label>
            <label
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (!busy) void readUpload(event.dataTransfer.files[0]) }}
            >
              <input type="file" accept=".md,.markdown,text/markdown,text/x-markdown" hidden disabled={Boolean(busy)} onChange={(event) => { void readUpload(event.target.files?.[0]); event.target.value = '' }} />
              {busy ? <span className="spinner dark" /> : <UploadCloud />}
              <b>{busy || '拖入或选择课文整理 .md'}</b>
              <span>不接受 Word / 图片 / 粘贴</span>
            </label>
            {notice && <div className="modal-notice">{notice}</div>}
          </section>
        </div>
      )}
    </div>
  )
}

function SentencePronunciation({ sentence, onScore, compact, resetKey = 0 }: {
  sentence: PassageSentence
  onScore?: (score: number) => void
  compact?: boolean
  resetKey?: number | string
}) {
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const practice = usePronunciationPractice((text) => {
    const next = pronunciationScoreFor(text, sentence.text, sentence.reading)
    setTranscript(text)
    setScore(next)
    onScore?.(next)
  }, sentence.id)

  useEffect(() => {
    setTranscript('')
    setScore(null)
  }, [sentence.id, resetKey])

  const recordButton = (
    <button
      type="button"
      className={`inline-record ${compact ? 'compact' : ''} ${practice.recording ? 'recording' : ''}`}
      disabled={practice.evaluating}
      onClick={() => {
        if (practice.recording) practice.stop()
        else { setScore(null); setTranscript(''); practice.start() }
      }}
      aria-label={practice.evaluating ? '正在分析' : practice.recording ? '结束跟读' : '开始跟读'}
    >
      {practice.evaluating ? <span className="spinner" /> : practice.recording ? <Pause size={compact ? 15 : 22} strokeWidth={1.6} /> : <Mic size={compact ? 15 : 22} strokeWidth={1.6} />}
      {!compact && practice.evaluating && <span>正在分析…</span>}
    </button>
  )

  if (compact) {
    return (
      <div className="inline-practice compact">
        {recordButton}
        {practice.error && <div className="speech-error">{practice.error}</div>}
        {score !== null && (
          <div className={`inline-score ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}>
            <b>{score}<small>分</small></b>
            <span>{score >= 80 ? '跟读很接近课文' : score >= 55 ? '已经听得出大意了' : '请再慢一点、按课文朗读'}<small>识别结果：{transcript}</small></span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inline-practice shadow-practice">
      <div className="shadow-mic-wrap">
        <div className="shadow-wave" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => <i key={`l${i}`} style={{ height: `${8 + ((i * 7) % 18)}px` }} />)}
        </div>
        {recordButton}
        <div className="shadow-wave" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => <i key={`r${i}`} style={{ height: `${8 + ((i * 5) % 18)}px` }} />)}
        </div>
      </div>
      <p className="shadow-hint">{practice.recording ? '正在聆听，说完再点结束' : '点击麦克风开始跟读'}</p>
      {practice.error && <div className="speech-error">{practice.error}</div>}
      {score !== null && (
        <>
          <div className="shadow-metrics">
            <div><b>{score}</b><small>发音准确度</small></div>
            <div><b>{Math.min(100, score + 5)}</b><small>流利度</small></div>
            <div><b>{Math.max(0, score - 5)}</b><small>音调</small></div>
          </div>
          <div className="shadow-overall">
            <span>整体评分</span>
            <div className="shadow-overall-bar"><i style={{ width: `${score}%` }} /></div>
            <b>{score} / 100</b>
          </div>
          <div className="shadow-tokens">
            {(sentence.tokens.length ? sentence.tokens : [{ surface: sentence.text, reading: sentence.reading, meaning: '' }]).map((token, index) => {
              const spoken = normalizeJapanese(transcript)
              const target = normalizeJapanese(token.surface)
              const ok = !spoken || !target || spoken.includes(target) || score >= 70
              return (
                <article key={`${token.surface}-${index}`} className={ok ? 'ok' : 'warn'}>
                  <b className="jp">{token.surface}</b>
                  <span>
                    {ok
                      ? <><CheckCircle2 size={14} strokeWidth={1.6} />发音正确</>
                      : <><TriangleAlert size={14} strokeWidth={1.6} />发音稍有偏差，建议再练</>}
                  </span>
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
