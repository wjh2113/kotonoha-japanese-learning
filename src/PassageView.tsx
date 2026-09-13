import { useContext, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Bot, ChevronLeft, ChevronRight, Copy, FileText, Headphones, LoaderCircle, Mic, Pause, Play,
  RefreshCw, Repeat, ScrollText, SquarePen, Trash2, UploadCloud, Volume2, X,
} from 'lucide-react'
import { apiFetch, readApiJson } from './api'
import { readPassageSource } from './docx'
import { isPassagePlaceholder, looksLikeErrorDocument, publicApiMessage } from './error-text'
import {
  grammarHighlightTerms, hasChineseTranslation, highlightGrammarInText, isTransientPassage, mergePassageBooks,
  normalizePassageSentence, MAX_PASSAGES, parsePassageHandbook, recordSentenceDictation, recordSentenceScore,
  recoverInterruptedIngest, sentenceNeedsAnalysis,
} from './passage'
import { PassageIntensive } from './PassageIntensive'
import { PronunciationPractice } from './PronunciationPractice'
import { SettingsContext } from './settings-context'
import { speakJapanese, speakJapaneseQueue, stopSpeaking } from './speech'
import type { Passage, PassageBook, PassageSentence } from './types'
import { uid } from './utils'

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
  const record = item as Partial<Passage> & { sentences?: unknown[]; sentenceCount?: number }
  const id = String(record.id || '').trim()
  if (!id) return null
  const sentences = Array.isArray(record.sentences) ? record.sentences : []
  const status = record.status === 'processing' || record.status === 'error' ? record.status : 'ready'
  const sentenceCount = Number.isFinite(Number(record.sentenceCount))
    ? Math.max(0, Number(record.sentenceCount))
    : undefined
  const hydrated: Passage = {
    id,
    title: passageTitle(record.title),
    sourceText: String(record.sourceText || ''),
    createdAt: Number(record.createdAt) || Date.now(),
    bookId: String(record.bookId || '').trim(),
    bookName: String(record.bookName || '').trim(),
    progress: hydrateProgress(record.progress),
    status,
    statusText: String(record.statusText || ''),
    ...(sentenceCount !== undefined ? { sentenceCount } : {}),
    sentences: sentences.map((sentence) => {
      const next = normalizePassageSentence(sentence, uid())
      return { ...next, id: next.id || uid() }
    }).filter((sentence) => sentence.text),
  }
  // Light list rows omit sentences/sourceText — do not treat them as failed OCR ingest.
  if (!hydrated.sentences.length && (hydrated.sentenceCount || 0) > 0) return hydrated
  return recoverInterruptedIngest(hydrated)
}

export function PassageView() {
  const { voiceGender } = useContext(SettingsContext)
  const [passages, setPassages] = useState<Passage[]>([])
  const [books, setBooks] = useState<PassageBook[]>([])
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<Mode>('source')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [draftBookId, setDraftBookId] = useState('')
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
  const persistBusy = useRef(false)
  const pendingFlush = useRef(false)
  const dirtyUpserts = useRef(new Set<string>())
  const dirtyProgress = useRef(new Set<string>())
  const dirtyBooks = useRef(false)
  const deletedIds = useRef(new Set<string>())
  const ingesting = useRef(false)
  const ingestingIds = useRef(new Set<string>())
  const detailLoading = useRef(new Set<string>())
  const passagesRef = useRef<Passage[]>([])
  const booksRef = useRef<PassageBook[]>([])
  const activeSentenceRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => () => {
    stopSpeaking()
  }, [])

  // Only follow the active line when the index changes — not on every render.
  // An inline callback ref would re-fire scrollIntoView after any state update and fight the wheel.
  useEffect(() => {
    activeSentenceRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [sentenceIndex, mode, selectedId])

  const durableCount = () => passagesRef.current.filter((item) => !isTransientPassage(item)).length

  const commitPassages = (next: Passage[]) => {
    passagesRef.current = next
    setPassages(next)
  }

  const commitBooks = (next: PassageBook[]) => {
    booksRef.current = next
    setBooks(next)
    dirtyBooks.current = true
  }

  const markUpsert = (id: string) => {
    dirtyUpserts.current.add(id)
    dirtyProgress.current.delete(id)
  }

  const markProgress = (id: string) => {
    if (!dirtyUpserts.current.has(id)) dirtyProgress.current.add(id)
  }

  const patchPassage = (id: string, changes: Partial<Passage>) => {
    commitPassages(passagesRef.current.map((item) => item.id === id ? { ...item, ...changes } : item))
    const keys = Object.keys(changes)
    if (keys.length === 1 && keys[0] === 'progress') markProgress(id)
    else markUpsert(id)
  }

  const flushPersist = async () => {
    if (!persistEnabled.current) return
    pendingFlush.current = true
    while (persistBusy.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 40))
    }
    if (!pendingFlush.current
      && !dirtyUpserts.current.size
      && !dirtyProgress.current.size
      && !dirtyBooks.current
      && !deletedIds.current.size) {
      return
    }
    persistBusy.current = true
    try {
      while (
        pendingFlush.current
        || dirtyUpserts.current.size
        || dirtyProgress.current.size
        || dirtyBooks.current
        || deletedIds.current.size
      ) {
        pendingFlush.current = false
        const upsertIds = [...dirtyUpserts.current]
        const progressIds = [...dirtyProgress.current]
        const removeIds = [...deletedIds.current]
        const booksNeedSave = dirtyBooks.current
        dirtyUpserts.current.clear()
        dirtyProgress.current.clear()
        deletedIds.current.clear()
        dirtyBooks.current = false

        for (const id of removeIds) {
          const response = await apiFetch(`/api/passages/${encodeURIComponent(id)}`, { method: 'DELETE' })
          if (!response.ok && response.status !== 404) throw new Error('DELETE_FAILED')
        }

        for (const id of upsertIds) {
          const passage = passagesRef.current.find((item) => item.id === id)
          if (!passage || isTransientPassage(passage)) continue
          const response = await apiFetch(`/api/passages/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(passage),
          })
          if (!response.ok) throw new Error('UPSERT_FAILED')
        }

        for (const id of progressIds) {
          const passage = passagesRef.current.find((item) => item.id === id)
          if (!passage || isTransientPassage(passage)) continue
          const response = await apiFetch(`/api/passages/${encodeURIComponent(id)}/progress`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ progress: passage.progress || {} }),
          })
          if (!response.ok) throw new Error('PROGRESS_FAILED')
        }

        if (booksNeedSave) {
          const response = await apiFetch('/api/passage-books', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ books: booksRef.current }),
          })
          if (!response.ok) throw new Error('BOOKS_FAILED')
        }
        persistError.current = false
      }
    } catch {
      if (!persistError.current) {
        persistError.current = true
        setNotice('课文保存失败，请检查服务状态')
      }
    } finally {
      persistBusy.current = false
    }
  }


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
      ]
      if (merged.length > MAX_PASSAGES) {
        setNotice(`课文库最多 ${MAX_PASSAGES} 篇，已只保留最新 ${MAX_PASSAGES} 篇。`)
      }
      commitPassages(merged.slice(0, MAX_PASSAGES))
      const nextBooks = mergePassageBooks(Array.isArray(data.books) ? data.books as { id: string; name: string }[] : [], merged)
      booksRef.current = nextBooks
      setBooks(nextBooks)
      dirtyBooks.current = false
      setSelectedId((current) => merged.some((item) => item.id === current) ? current : (merged[0]?.id || ''))
      setReady(true)
    }).catch(() => {
      if (!cancelled) { setNotice('暂时无法读取已保存的课文'); setReady(true) }
    })
    return () => { cancelled = true }
  }, [])

  // Lazy-load full passage detail when the selected item only has a light list payload.
  useEffect(() => {
    if (!ready || !selectedId) return
    const current = passagesRef.current.find((item) => item.id === selectedId)
    if (!current) return
    const status = current.status === 'processing' || current.status === 'error' ? current.status : 'ready'
    const needsDetail = (!current.sentences || current.sentences.length === 0)
      && ((current.sentenceCount || 0) > 0 || status === 'ready' || status === 'processing' || status === 'error')
      && !ingestingIds.current.has(current.id)
      && !isTransientPassage(current)
    if (!needsDetail) return
    if (detailLoading.current.has(selectedId)) return
    detailLoading.current.add(selectedId)
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch(`/api/passages/${encodeURIComponent(selectedId)}`)
        const data = await readApiJson<{ passage?: unknown; error?: string }>(response)
        if (cancelled || !response.ok) return
        const full = hydratePassage(data.passage)
        if (!full || cancelled) return
        commitPassages(passagesRef.current.map((item) => item.id === full.id ? {
          ...item,
          ...full,
          // Keep any in-flight local progress if newer upserts are pending.
          progress: dirtyUpserts.current.has(full.id) || dirtyProgress.current.has(full.id)
            ? item.progress
            : full.progress,
        } : item))
      } catch { /* keep light row */ }
      finally {
        detailLoading.current.delete(selectedId)
      }
    })()
    return () => { cancelled = true }
  }, [ready, selectedId])

  useEffect(() => {
    if (!ready || !persistEnabled.current) return
    const timer = window.setTimeout(() => { void flushPersist() }, 400)
    return () => window.clearTimeout(timer)
  }, [passages, books, ready])

  // Keep booksRef in sync when setBooks is used without commitBooks (legacy paths).
  useEffect(() => { booksRef.current = books }, [books])

  // Upload modal defaults to the first textbook in the catalog.
  useEffect(() => {
    if (draftBookId) return
    const firstBookId = books[0]?.id
    if (firstBookId) setDraftBookId(firstBookId)
  }, [books, draftBookId])

  const passage = passages.find((item) => item.id === selectedId) || passages[0]
  const sentence = passage?.sentences[sentenceIndex]

  useEffect(() => {
    setSentenceIndex(0)
    setSourceEditing(false)
    setMode('source')
    setPlayingFull(false)
    stopSpeaking()
  }, [selectedId])

  const queueHandbook = async (text: string) => {
    if (!ready) {
      setNotice('课文库还在加载，请稍后再试。')
      return
    }
    const imported = parsePassageHandbook(text)
    if (!imported?.lessons.length) {
      setNotice('未识别到「课文整理」手册格式。请使用下载的 .md 模版（含 ## 课文N 与「原文 / 假名注音 / 中文解释」表）。')
      return
    }
    const room = MAX_PASSAGES - durableCount()
    if (room <= 0) {
      setNotice(`课文库已满（最多 ${MAX_PASSAGES} 篇），请先删除旧课文再导入。`)
      return
    }
    let lessonList = imported.lessons
    let truncated = false
    if (lessonList.length > room) {
      lessonList = lessonList.slice(0, room)
      truncated = true
    }
    const book = books.find((item) => item.id === draftBookId)
    // 倒序加入，使「课文1」排在列表最前并被选中
    const lessons = [...lessonList].reverse()
    const created: Passage[] = []
    let selected = ''
    for (const lesson of lessons) {
      const incomplete = lesson.sentences.filter(sentenceNeedsAnalysis).length
      const stub: Passage = {
        id: uid(),
        title: passageTitle(lesson.title),
        sourceText: lesson.sourceText,
        createdAt: Date.now(),
        status: incomplete ? 'error' : 'ready',
        statusText: incomplete
          ? `有 ${incomplete} 句缺少假名注音或中文解释，请补全模版后重新上传。`
          : '',
        bookId: book?.id || '',
        bookName: book?.name || '',
        sentences: lesson.sentences,
      }
      persistEnabled.current = true
      commitPassages([stub, ...passagesRef.current.filter((item) => item.id !== stub.id)])
      markUpsert(stub.id)
      selected = stub.id
      created.push(stub)
    }
    if (selected) {
      setSelectedId(selected)
      setMode('source')
    }
    setBusy('正在保存到数据库…')
    await flushPersist()
    setBusy('')
    setUploadOpen(false)
    const incompleteLessons = created.filter((item) => item.status !== 'ready')
    if (truncated) {
      setNotice(`课文库最多 ${MAX_PASSAGES} 篇，本次仅导入 ${lessonList.length} / ${imported.lessons.length} 篇。${incompleteLessons.length ? `其中 ${incompleteLessons.length} 篇核心列不完整。` : ''}`)
    } else if (incompleteLessons.length) {
      setNotice(`已导入 ${lessonList.length} 篇，但有 ${incompleteLessons.length} 篇缺少假名或中文解释，请按模版补全后重传。`)
    } else {
      setNotice(
        lessonList.length > 1
          ? `已导入 ${lessonList.length} 篇课文（${imported.documentTitle || '手册'}），内容已原样写入数据库。`
          : '手册已导入，内容已原样写入数据库。',
      )
    }
  }

  const readUpload = async (file?: File) => {
    if (!file || ingesting.current) return
    if (!ready) { setNotice('课文库还在加载，请稍后再试。'); return }
    ingesting.current = true
    setBusy('正在读取课文手册…')
    setNotice('')
    try {
      const source = await readPassageSource(file)
      await queueHandbook(source.text)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '课文读取失败。')
      setBusy('')
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
    setNotice('原文已保存。')
  }

  const createBook = (assignCurrent = false) => {
    const name = window.prompt('课本名称，例如：大家的日语 第1册', '大家的日语 第1册')?.trim().slice(0, 80)
    if (!name) return
    const next = { id: uid(), name }
    commitBooks([...booksRef.current, next])
    setDraftBookId(next.id)
    if (assignCurrent && passage) patchPassage(passage.id, { bookId: next.id, bookName: next.name })
  }

  const renameBook = (book: PassageBook) => {
    const name = window.prompt('课本名称', book.name)?.trim().slice(0, 80)
    if (!name) return
    commitBooks(booksRef.current.map((item) => item.id === book.id ? { ...item, name } : item))
    const nextPassages = passagesRef.current.map((item) => item.bookId === book.id ? { ...item, bookName: name } : item)
    commitPassages(nextPassages)
    nextPassages.filter((item) => item.bookId === book.id).forEach((item) => markUpsert(item.id))
  }

  const deleteBook = (book: PassageBook) => {
    if (!window.confirm(`删除课本「${book.name}」？课文会回到未分组，不会被删。`)) return
    const affected = passagesRef.current.filter((item) => item.bookId === book.id).map((item) => item.id)
    const remaining = booksRef.current.filter((item) => item.id !== book.id)
    commitBooks(remaining)
    commitPassages(passagesRef.current.map((item) => item.bookId === book.id ? { ...item, bookId: '', bookName: '' } : item))
    affected.forEach((id) => markUpsert(id))
    if (draftBookId === book.id) setDraftBookId(remaining[0]?.id || '')
  }

  const movePassage = (bookId: string) => {
    if (!passage) return
    const book = books.find((item) => item.id === bookId)
    patchPassage(passage.id, { bookId: book?.id || '', bookName: book?.name || '' })
  }

  const orderedPassages = [
    ...books.flatMap((book) => passages.filter((item) => item.bookId === book.id)),
    ...passages.filter((item) => !item.bookId),
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
  const grammarTerms = grammarHighlightTerms(grammarPoints)

  const openUpload = () => {
    const firstBookId = books[0]?.id
    if (firstBookId) setDraftBookId((current) => current || firstBookId)
    setUploadOpen(true)
  }

  const selectPassage = (id: string) => {
    if (!id || id === selectedId) return
    setSelectedId(id)
    setPlayingFull(false)
    stopSpeaking()
  }

  return (
    <div className="page hub-page passage-page passage-design">
      <section className="hub-hero passage-hero-compact">
        <div>
          <h1>课文学习</h1>
          <p>在上方目录选择课文，可切换原文、精听与跟读。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" disabled={!ready} onClick={openUpload}><UploadCloud size={17} strokeWidth={1.6} />添加课文</button>
        </div>
      </section>

      {notice && <div className="passage-notice">{notice}<button onClick={() => setNotice('')} aria-label="关闭"><X size={14} /></button></div>}

      {passages.length ? (
        <div className="passage-workspace catalog-hidden">
          {passage ? (
            <section className="passage-stage">
              <div className="passage-picker">
                <label className="passage-picker-select">
                  <BookOpen size={15} strokeWidth={1.6} />
                  <span>课程目录</span>
                  <select
                    value={passage.id}
                    aria-label="选择课文"
                    onChange={(event) => selectPassage(event.target.value)}
                  >
                    {books.map((book) => {
                      const items = passages.filter((item) => item.bookId === book.id)
                      if (!items.length) return null
                      return (
                        <optgroup key={book.id} label={book.name}>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}（{item.sentences.length || item.sentenceCount || 0} 句）
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
                    {passages.some((item) => !item.bookId) && (
                      <optgroup label="未分组">
                        {passages.filter((item) => !item.bookId).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}（{item.sentences.length || item.sentenceCount || 0} 句）
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <div className="passage-picker-actions">
                  <button type="button" onClick={() => createBook(false)}>新建课本</button>
                  {passage.bookId && books.some((book) => book.id === passage.bookId) && (
                    <>
                      <button type="button" onClick={() => {
                        const book = books.find((item) => item.id === passage.bookId)
                        if (book) renameBook(book)
                      }}>改课本</button>
                      <button type="button" onClick={() => {
                        const book = books.find((item) => item.id === passage.bookId)
                        if (book) deleteBook(book)
                      }}>删课本</button>
                    </>
                  )}
                </div>
              </div>

              {passage.status === 'processing' && Date.now() - (passage.createdAt || 0) > 120_000 && (
                <div className="passage-status error">
                  识别时间过长，可删除后重试，或改粘贴正文。
                  <button type="button" onClick={openUpload}>重新添加</button>
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
                    deletedIds.current.add(passage.id)
                    dirtyUpserts.current.delete(passage.id)
                    dirtyProgress.current.delete(passage.id)
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
              </div>

              <div className="passage-stage-body">
              {mode === 'intensive' ? (
                <PassageIntensive
                  passage={passage}
                  voiceGender={voiceGender}
                  sentenceIndex={sentenceIndex}
                  playing={playingFull}
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
                    <PronunciationPractice
                      variant="shadow"
                      referenceText={sentence.text}
                      referenceReading={sentence.reading}
                      tokens={sentence.tokens}
                      resetKey={`${sentence.id}-${shadowRetry}`}
                      onScore={(score) => patchPassage(passage.id, { progress: recordSentenceScore(passage.progress, sentence.id, score) })}
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
                                  <span className="jp">
                                    {highlightGrammarInText(item.reading || item.text, grammarTerms).map((part, partIndex) => (
                                      part.hit
                                        ? <span key={`${item.id}-g-${partIndex}`} className="grammar-hit">{part.text}</span>
                                        : <span key={`${item.id}-t-${partIndex}`}>{part.text}</span>
                                    ))}
                                  </span>
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
                    <pre className="jp passage-source">{passage.sourceText || '这篇课文还没有可点选的句子。可以点「编辑原文」补上内容。'}</pre>
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
            <div className="wide-empty compact"><ScrollText /><h2>请选择课文</h2><p>用上方课程目录下拉选择一篇课文开始学习。</p></div>
          )}
        </div>
      ) : (
        <div className="wide-empty">
          <ScrollText />
          <h2>还没有课文</h2>
          <p>请上传「课文整理」Markdown 手册（含原文、假名注音、中文解释）。系统按「课文N」拆篇入库，不调用模型。</p>
          <button onClick={openUpload}>添加课文</button>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setUploadOpen(false)}>
          <section className="modal import-modal">
            <button className="modal-close" onClick={() => !busy && setUploadOpen(false)}><X /></button>
            <span className="modal-icon"><FileText /></span>
            <span className="eyebrow">PASSAGE HANDBOOK</span>
            <h2>添加课文</h2>
            <p>仅支持「课文整理」Markdown 模版（含假名注音列）。上传内容原样入库，不再调用模型补全。</p>
            <div className="import-template-row">
              <a className="secondary-button import-template-link" href="/templates/课文导入模版.md" download="课文导入模版.md">
                下载导入模版
              </a>
              <small>结构：# 课次 → ## 课文N → 原文/假名注音/中文解释表 → 语法考点（上传原样入库，不调用模型）</small>
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


