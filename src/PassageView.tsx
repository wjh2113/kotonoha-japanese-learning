import { useContext, useEffect, useRef, useState, type ClipboardEvent } from 'react'
import {
  BookOpen, BookmarkPlus, ChevronLeft, ChevronRight, Copy, FileText, LoaderCircle, Mic, Pause, Play,
  ScrollText, Sparkles, SquarePen, Trash2, UploadCloud, Volume2, X,
} from 'lucide-react'
import { apiFetch, readApiJson } from './api'
import { clipboardImageFiles, normalizeOcrText } from './clipboard-images'
import { extractDocxPassage, htmlToPassageText, readPassageSource } from './docx'
import { PASSAGE_OCR_PLACEHOLDER, isPassagePlaceholder, looksLikeErrorDocument, publicApiMessage } from './error-text'
import {
  chunkItems, extractPassageVocab, hasChineseTranslation, isPrimarilyChineseLine, isTransientPassage, mergeAnalyzedSentences, mergePassageBooks,
  normalizePassageSentence, passageProgressSummary, recordSentenceDictation, recordSentenceScore,
  recoverInterruptedIngest, sentenceNeedsAnalysis, unusedPassageVocab,
} from './passage'
import { PassageIntensive } from './PassageIntensive'
import { usePronunciationPractice } from './pronunciation-practice'
import { SettingsContext } from './settings-context'
import { speakJapanese, speakJapaneseQueue, stopSpeaking } from './speech'
import type { ImportDraft, Passage, PassageBook, PassageSentence, Unit, Word } from './types'
import { makeFallbackWord, pronunciationScoreFor, splitJapaneseSentences, uid } from './utils'

type Mode = 'read' | 'explain' | 'grammar' | 'source' | 'intensive'

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

function fallbackPassage(sourceText: string): Passage {
  const text = isPassagePlaceholder(sourceText) ? '' : sourceText.trim()
  return {
    id: uid(),
    title: '课文',
    sourceText: text,
    createdAt: Date.now(),
    status: 'processing',
    sentences: text ? splitJapaneseSentences(text).map((line) => ({
      id: uid(), text: line, reading: '', translation: '', tokens: [], grammar: [],
    })) : [],
  }
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

function isPasteField(target: EventTarget | null) {
  const tag = (target as HTMLElement | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

async function fileToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function fileToCompressedJpeg(file: File) {
  try {
    const bitmap = await Promise.race([
      createImageBitmap(file),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('图片处理超时，请换一张更小的照片或直接粘贴正文。')), 15_000)),
    ])
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理图片。')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('图片压缩失败。')), 'image/jpeg', 0.82)
    })
    return fileToBase64(blob)
  } catch (reason) {
    if (reason instanceof Error && /超时/.test(reason.message)) throw reason
    if (file.size > 2 * 1024 * 1024) throw new Error('图片无法压缩，请换一张更小的照片。')
    return fileToBase64(file)
  }
}

export function PassageView({ units, onAddWords }: { units: Unit[]; onAddWords: (unitId: string, words: Word[]) => void }) {
  const { voiceGender } = useContext(SettingsContext)
  const [passages, setPassages] = useState<Passage[]>([])
  const [books, setBooks] = useState<PassageBook[]>([])
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<Mode>('source')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [showTranslations, setShowTranslations] = useState(false)
  const [raw, setRaw] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBookId, setDraftBookId] = useState('')
  const [query, setQuery] = useState('')
  const [sourceEditing, setSourceEditing] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [vocabUnitId, setVocabUnitId] = useState('')
  const [vocabPicked, setVocabPicked] = useState<Record<string, boolean>>({})
  const [playingFull, setPlayingFull] = useState(false)
  const persistError = useRef(false)
  const persistEnabled = useRef(false)
  const ingesting = useRef(false)
  const analyzing = useRef(new Set<string>())
  const ingestingIds = useRef(new Set<string>())
  const resumed = useRef(false)
  const passagesRef = useRef<Passage[]>([])
  const fillPassageRef = useRef<(id: string) => Promise<void>>(async () => undefined)

  useEffect(() => () => stopSpeaking(), [])

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
      let finished = total - work.length
      let chunkErrors = 0
      for (const chunk of chunkItems(work)) {
        if (!passagesRef.current.some((item) => item.id === passageId)) return
        patchPassage(passageId, { status: 'processing', statusText: `正在生成整句翻译 ${finished}/${total}` })
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
            statusText: `正在生成整句翻译 ${finished}/${total}`,
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
  const vocabUnit = units.find((item) => item.id === vocabUnitId) || units[0]

  useEffect(() => {
    setSentenceIndex(0)
    setSourceEditing(false)
    setMode('source')
    setPlayingFull(false)
    stopSpeaking()
  }, [selectedId])

  const addPassage = (next: Passage) => {
    persistEnabled.current = true
    const following = [next, ...passagesRef.current.filter((item) => item.id !== next.id)].slice(0, 50)
    commitPassages(following)
    setSelectedId(next.id)
    setMode('source')
    setUploadOpen(false)
    setRaw('')
    setDraftTitle('')
  }

  const processIngest = async (passageId: string, text: string, images: Blob[]) => {
    ingestingIds.current.add(passageId)
    try {
      const parts: string[] = []
      const ocrFailures: string[] = []
      if (text.trim() && !isPassagePlaceholder(text) && !looksLikeErrorDocument(text)) parts.push(text.trim())
      if (!images.length && !parts.length) throw new Error('没有识别到日语课文，请换一份 Word、更清晰的照片，或直接粘贴正文。')
      for (const [index, image] of images.slice(0, 4).entries()) {
        if (!ingestingIds.current.has(passageId)) return
        if (!passagesRef.current.some((item) => item.id === passageId)) return
        patchPassage(passageId, { status: 'processing', statusText: `正在识别课文图片 ${index + 1}/${Math.min(images.length, 4)}…` })
        try {
          const recognized = await ocrImage(image)
          if (recognized) parts.push(recognized)
        } catch (reason) {
          ocrFailures.push(reason instanceof Error ? reason.message : '图片识别失败')
        }
      }
      if (!ingestingIds.current.has(passageId)) return
      const sourceText = parts.join('\n\n').trim()
      if (!sourceText || looksLikeErrorDocument(sourceText)) {
        throw new Error(ocrFailures[0] || '没有识别到日语课文，请换一份 Word、更清晰的照片，或直接粘贴正文。')
      }
      const sentences = fallbackPassage(sourceText).sentences
      if (!sentences.length) throw new Error('没有识别到可拆分的日语句子，请检查图片是否清晰。')
      // Sync ref before analyze so fillPassage never sees a stale empty stub.
      patchPassage(passageId, {
        sourceText,
        sentences,
        status: 'processing',
        statusText: `正在生成整句翻译 0/${sentences.length}`,
      })
      if (ocrFailures.length) setNotice(`有 ${ocrFailures.length} 张图片识别失败，已用其余内容继续。`)
      await fillPassage(passageId)
    } catch (reason) {
      if (!ingestingIds.current.has(passageId)) return
      patchPassage(passageId, {
        status: 'error',
        statusText: publicApiMessage(reason instanceof Error ? reason.message : '', '课文读取失败。'),
        sourceText: '',
        sentences: [],
      })
      setNotice(publicApiMessage(reason instanceof Error ? reason.message : '', '课文读取失败。'))
    } finally {
      ingestingIds.current.delete(passageId)
    }
  }

  const queueIngest = (text: string, images: Blob[] = [], title?: string) => {
    if (!ready) {
      setNotice('课文库还在加载，请稍后再试。')
      return
    }
    const book = books.find((item) => item.id === draftBookId)
    const sourceText = isPassagePlaceholder(text) ? '' : text.trim()
    const stub = {
      ...fallbackPassage(sourceText),
      title: passageTitle(title),
      status: 'processing' as const,
      statusText: images.length ? '正在识别课文图片…' : '正在生成整句翻译…',
      bookId: book?.id || '',
      bookName: book?.name || '',
    }
    addPassage(stub)
    ingestingIds.current.add(stub.id)
    void processIngest(stub.id, sourceText, images)
  }

  const ocrImage = async (blob: Blob) => {
    const file = blob instanceof File ? blob : new File([blob], 'paste.jpg', { type: blob.type || 'image/jpeg' })
    const imageBase64 = await fileToCompressedJpeg(file)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await apiFetch('/api/passage/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
        signal: controller.signal,
      })
      const data = await readApiJson<{ text?: string; error?: string }>(response)
      if (!response.ok) throw new Error(publicApiMessage(data.error, '图片识别失败，请稍后重试。'))
      const text = normalizeOcrText(data.text)
      if (!text || looksLikeErrorDocument(text) || text === PASSAGE_OCR_PLACEHOLDER) {
        throw new Error('没有识别到日语课文，请换更清晰的照片或直接粘贴文本。')
      }
      return text
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        throw new Error('图片识别超时（约 90 秒）。请换更清晰的照片，或直接粘贴正文。')
      }
      throw reason
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const readUpload = async (file?: File) => {
    if (!file || ingesting.current) return
    if (!ready) { setNotice('课文库还在加载，请稍后再试。'); return }
    ingesting.current = true
    setBusy('正在读取课文…')
    setNotice('')
    try {
      const source = await readPassageSource(file)
      queueIngest(source.text, source.images, draftTitle)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '课文读取失败。')
    } finally {
      ingesting.current = false
      setBusy('')
    }
  }

  const pasteClipboard = async (event: ClipboardEvent<HTMLElement>, immediate = true) => {
    event.stopPropagation()
    if (ingesting.current) return
    const clipboard = event.clipboardData
    if (!clipboard) return
    const imageFiles = clipboardImageFiles(clipboard)
    const files = Array.from(clipboard.files || [])
    const wordFile = files.find((file) => file.name.toLowerCase().endsWith('.docx') || file.type.includes('wordprocessingml'))
      || Array.from(clipboard.items || []).map((item) => item.getAsFile()).find((file) => file && (file.name.toLowerCase().endsWith('.docx') || file.type.includes('wordprocessingml'))) || undefined
    const html = clipboard.getData('text/html')
    const plain = clipboard.getData('text/plain')
    const htmlText = html ? htmlToPassageText(html) : ''
    const text = (htmlText.length > plain.trim().length ? htmlText : plain).trim()
    if (!imageFiles.length && !wordFile && !(immediate && text)) {
      if (!immediate && !text) setNotice('没有检测到图片或课文文字。请用 Ctrl+V 贴到上方虚线框，或点选上传图片/Word。')
      return
    }
    ingesting.current = true
    event.preventDefault()
    setNotice('')
    try {
      if (wordFile) {
        const source = await extractDocxPassage(wordFile)
        queueIngest(source.text, source.images, draftTitle)
        return
      }
      // Prefer images when present: screenshot pastes often also carry useless HTML/plain fragments.
      if (imageFiles.length) {
        setNotice(`已收到 ${imageFiles.length} 张图片，正在识别…`)
        queueIngest('', imageFiles, draftTitle)
        return
      }
      queueIngest(text, [], draftTitle)
    } catch (reason) {
      if (plain.trim()) setRaw(plain)
      setNotice(reason instanceof Error ? reason.message : '粘贴内容无法识别。')
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
    void speakJapaneseQueue(passage.sentences.slice(start).map((item) => item.text), voiceGender, {
      sentence: true,
      onIndex: (index) => setSentenceIndex(start + index),
      onAllEnd: () => setPlayingFull(false),
    })
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
    const sourceText = (sourceEditing ? sourceDraft : passage.sourceText).trim()
    if (!sourceText || looksLikeErrorDocument(sourceText)) { setNotice('没有原文可以重新解析。'); return }
    setSourceEditing(false)
    patchPassage(passage.id, {
      sourceText,
      sentences: fallbackPassage(sourceText).sentences,
      progress: {},
      status: 'processing',
      statusText: '正在按原文重新翻译…',
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

  const openVocab = () => {
    if (!passage) return
    if (passage.status === 'processing') { setNotice('整句翻译还在生成，完成后再抽生词。'); return }
    const drafts = unusedPassageVocab(passage, vocabUnit?.words.map((word) => word.term) || [])
    if (!drafts.length) { setNotice(extractPassageVocab(passage).length ? '这些词已经在当前词库里了。' : '这一课还没有可抽出的生词。'); return }
    setVocabUnitId(vocabUnit?.id || units[0]?.id || '')
    setVocabPicked(Object.fromEntries(drafts.map((draft) => [draft.term, true])))
    setVocabOpen(true)
  }

  const addDrafts = (drafts: ImportDraft[]) => {
    const unit = units.find((item) => item.id === (vocabUnitId || vocabUnit?.id)) || units[0]
    if (!unit) { setNotice('请先创建一个词库单元。'); return }
    const have = new Set(unit.words.map((word) => word.term))
    const words = drafts.filter((draft) => draft.term && !have.has(draft.term)).map(makeFallbackWord)
    if (!words.length) { setNotice('这些词已经在词库里了。'); return }
    onAddWords(unit.id, words)
    setVocabOpen(false)
    setNotice(`已把 ${words.length} 张词卡放入「${unit.name}」`)
  }

  const vocabDrafts = passage && vocabUnit ? unusedPassageVocab(passage, vocabUnit.words.map((word) => word.term)) : []

  const renderPassageButton = (item: Passage) => {
    const progress = passageProgressSummary(item)
    return (
      <button key={item.id} className={`passage-item ${item.id === passage?.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
        <span>{item.title}</span>
        <small>
          {item.status === 'processing' ? (item.statusText || '处理中…')
            : item.status === 'error' ? (item.statusText || '处理失败')
              : `${item.sentences.length} 句${progress.practiced ? ` · 已跟读 ${progress.practiced}/${progress.total}` : ''}`}
        </small>
      </button>
    )
  }

  return (
    <div className="page hub-page passage-page">
      <section className="hub-hero">
        <div>
          <span className="eyebrow">TEXTBOOK PASSAGE</span>
          <h1>课文学习</h1>
          <p>上传后默认看全文：点某一行可听、可跟读。也可切换逐句跟读、逐词解释与语法标注。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" disabled={!ready} onClick={() => setUploadOpen(true)}><UploadCloud size={17} />添加课文</button>
        </div>
      </section>

      {notice && <div className="passage-notice">{notice}<button onClick={() => setNotice('')} aria-label="关闭"><X size={14} /></button></div>}

      {passages.length ? (
        <div className="passage-layout">
          <aside className="passage-list">
            <b>课文库 {passages.length}</b>
            <input className="passage-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或原文" />
            <button type="button" className="passage-book-new" onClick={() => createBook(false)}><BookOpen size={14} />新建课本</button>
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
          </aside>
          {passage && (
            <section className="passage-stage">
              {passage.status === 'processing' && (
                <div className="passage-status processing"><LoaderCircle size={16} className="spin" />{passage.statusText || '正在后台处理课文…'}</div>
              )}
              {passage.status === 'error' && (
                <div className="passage-status error">
                  {passage.statusText || '处理失败'}
                  {passage.sentences.some((item) => item.text && !isPassagePlaceholder(item.text)) ? (
                    <button type="button" onClick={() => void fillPassage(passage.id)}>重试</button>
                  ) : (
                    <button type="button" onClick={() => setUploadOpen(true)}>重新添加</button>
                  )}
                </div>
              )}
              {passage.status === 'processing' && Date.now() - (passage.createdAt || 0) > 120_000 && (
                <div className="passage-status error">
                  识别时间过长，可删除后重试，或改粘贴正文。
                  <button type="button" onClick={() => setUploadOpen(true)}>重新添加</button>
                </div>
              )}
              <div className="passage-toolbar">
                <div>
                  <label className="passage-title-label">
                    <SquarePen size={14} />
                    <input
                      className="passage-title-input"
                      value={passage.title}
                      maxLength={80}
                      aria-label="课文标题"
                      onChange={(event) => patchPassage(passage.id, { title: event.target.value.slice(0, 80) })}
                      onBlur={(event) => patchPassage(passage.id, { title: passageTitle(event.target.value) })}
                    />
                  </label>
                  <small>{passage.sentences.length} 句 · 已跟读 {summary.practiced}/{summary.total}{summary.practiced ? ` · 平均最高分 ${summary.average}` : ''} · 可改标题</small>
                  <label className="passage-book-assign">课本
                    <select value={passage.bookId || ''} onChange={(event) => movePassage(event.target.value)}>
                      <option value="">未分组</option>
                      {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
                    </select>
                    <button type="button" onClick={() => createBook(true)}>新建</button>
                  </label>
                </div>
                <div className="passage-toolbar-actions">
                  <button type="button" onClick={playAll}>{playingFull ? '停止朗读' : '朗读全文'}</button>
                  <button type="button" onClick={openVocab}><BookmarkPlus size={15} />抽生词</button>
                  <button type="button" onClick={() => { setMode('source'); setSourceDraft(passage.sourceText); setSourceEditing(false) }}>原文</button>
                  <button className="remove-word" onClick={() => {
                    if (!window.confirm(`删除课文「${passage.title}」？此操作不可恢复。`)) return
                    ingestingIds.current.delete(passage.id)
                    const remaining = passagesRef.current.filter((item) => item.id !== passage.id)
                    commitPassages(remaining)
                    setSelectedId(remaining[0]?.id || '')
                    setSelectedId(remaining[0]?.id || '')
                  }}><Trash2 size={15} />删除</button>
                </div>
              </div>
              <div className="passage-modes">
                {([['source', '原文全文'], ['intensive', '精听'], ['read', '逐句跟读'], ['explain', '逐词解释'], ['grammar', '语法标识']] as const).map(([id, label]) => (
                  <button key={id} className={mode === id ? 'active' : ''} onClick={() => {
                    setMode(id)
                    if (id === 'source') { setSourceDraft(passage.sourceText); setSourceEditing(false) }
                    if (id !== 'intensive') { setPlayingFull(false); stopSpeaking() }
                  }}>{label}</button>
                ))}
              </div>
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
              ) : mode === 'source' ? (
                <article className="passage-card passage-transcript-card">
                  <div className="passage-source-actions">
                    <button type="button" onClick={() => { setSourceDraft(passage.sourceText); setSourceEditing(true) }}><SquarePen size={15} />编辑原文</button>
                    <button type="button" disabled={!passage.sourceText} onClick={() => void copySource()}><Copy size={15} />复制原文</button>
                    <button type="button" disabled={passage.status === 'processing' || !(sourceEditing ? sourceDraft : passage.sourceText).trim()} onClick={reanalyze}>重新解析</button>
                    <label className="passage-toggle">
                      <span>译文</span>
                      <input type="checkbox" checked={showTranslations} onChange={(event) => setShowTranslations(event.target.checked)} />
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
                      <ol className="passage-transcript">
                        {passage.sentences.map((item, index) => {
                          const active = index === sentenceIndex
                          const practice = passage.progress?.[item.id]
                          return (
                            <li
                              key={item.id}
                              className={`${active ? 'active' : ''} ${playingFull && active ? 'speaking' : ''}`}
                              ref={active ? (node) => { node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } : undefined}
                            >
                              <button
                                type="button"
                                className="passage-transcript-line"
                                onClick={() => goSentence(index, true)}
                              >
                                <em>{index + 1}</em>
                                <span className="passage-transcript-body">
                                  <span className="jp">{item.text}</span>
                                  {showTranslations && hasChineseTranslation(item.translation) && (
                                    <small className="passage-transcript-tr">{item.translation}</small>
                                  )}
                                </span>
                                {practice?.attempts ? <small className="sentence-progress done">{practice.bestScore}分</small> : null}
                              </button>
                              {active && (
                                <div className="passage-transcript-practice">
                                  <div className="passage-transcript-meta">
                                    <span className="jp reading">{item.reading || '—'}</span>
                                    <button
                                      type="button"
                                      className="volume-button"
                                      onClick={() => void speakJapanese(item.text, voiceGender, { sentence: true })}
                                      aria-label="再听一遍"
                                    >
                                      <Volume2 size={18} />
                                    </button>
                                  </div>
                                  <SentencePronunciation
                                    sentence={item}
                                    onScore={(score) => patchPassage(passage.id, { progress: recordSentenceScore(passage.progress, item.id, score) })}
                                  />
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                      <div className="passage-transcript-bar" role="toolbar" aria-label="课文听读控制">
                        <button
                          type="button"
                          className="passage-transcript-play"
                          onClick={() => {
                            if (playingFull) playFrom(sentenceIndex)
                            else playCurrentLine()
                          }}
                          aria-label={playingFull ? '停止' : '听当前句'}
                        >
                          {playingFull ? <Pause size={20} /> : <Play size={20} />}
                        </button>
                        <button type="button" disabled={sentenceIndex <= 0} onClick={() => goSentence(sentenceIndex - 1, true)}>
                          <ChevronLeft size={16} />上一句
                        </button>
                        <span>{sentenceIndex + 1} / {passage.sentences.length}</span>
                        <button type="button" disabled={sentenceIndex >= passage.sentences.length - 1} onClick={() => goSentence(sentenceIndex + 1, true)}>
                          下一句<ChevronRight size={16} />
                        </button>
                        <button type="button" className="passage-transcript-cont" onClick={() => playFrom(sentenceIndex)}>
                          {playingFull ? '停止连读' : '从此连读'}
                        </button>
                        <button type="button" className="primary-button passage-go-intensive" onClick={() => { setPlayingFull(false); stopSpeaking(); setMode('intensive') }}>
                          前往精听页面
                        </button>
                      </div>
                    </>
                  ) : (
                    <pre className="jp passage-source">{passage.sourceText || '这篇课文还没有可点选的句子。可以点「编辑原文」补上后重新解析。'}</pre>
                  )}
                </article>
              ) : sentence ? (
              <>
              <ol className="passage-sentences">
                {passage.sentences.map((item, index) => {
                  const practice = passage.progress?.[item.id]
                  return (
                    <li key={item.id}>
                      <button className={`${index === sentenceIndex ? 'active' : ''} ${playingFull && index === sentenceIndex ? 'speaking' : ''}`} onClick={() => goSentence(index, mode === 'read')}>
                        <em>{index + 1}</em>
                        <span className="jp">{item.text}</span>
                        <small className={`sentence-progress ${practice?.attempts ? 'done' : ''}`}>
                          {practice?.attempts ? `${practice.bestScore}分` : '未跟读'}
                        </small>
                      </button>
                    </li>
                  )
                })}
              </ol>
              <article className="passage-card">
                <div className="passage-card-head">
                  <span className="jp reading">{sentence.reading || '—'}</span>
                  <button className="volume-button" onClick={() => void speakJapanese(sentence.text, voiceGender, { sentence: true })} aria-label="朗读这句"><Volume2 size={19} /></button>
                </div>
                <h3 className="jp">{sentence.text}</h3>
                {(mode === 'read' || mode === 'explain') && (
                  hasChineseTranslation(sentence.translation)
                    ? <p className="translation">{sentence.translation}</p>
                    : (passage.status === 'processing'
                      ? null
                      : <p className="translation muted">{passage.status === 'error' ? '整句翻译还没生成成功，请点上方红色提示里的「重试」。' : '暂无整句翻译'}</p>)
                )}
                {mode === 'read' && (
                  <SentencePronunciation
                    sentence={sentence}
                    onScore={(score) => patchPassage(passage.id, { progress: recordSentenceScore(passage.progress, sentence.id, score) })}
                  />
                )}
                {mode === 'explain' && (
                  <div className="passage-explain">
                    <div className="token-grid">
                      {(sentence.tokens.length ? sentence.tokens : [{ surface: sentence.text, reading: sentence.reading, meaning: sentence.translation || '待补充' }]).map((token, index) => (
                        <div key={`${token.surface}-${index}`}>
                          <b className="jp">{token.surface}</b>
                          <small className="jp">{token.reading}</small>
                          <span>{token.meaning}</span>
                          <button type="button" className="token-add" onClick={() => addDrafts([{ term: token.surface, reading: token.reading, meaning: token.meaning }])}>做成词卡</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mode === 'grammar' && (
                  <div className="grammar-list">
                    {sentence.grammar.length ? sentence.grammar.map((point, index) => (
                      <article key={`${point.name}-${index}`}>
                        <b>{point.name}</b>
                        {point.pattern && <code className="jp">{point.pattern}</code>}
                        <p>{point.explanation}</p>
                      </article>
                    )) : <p className="empty-grammar">{passage.status === 'processing' ? '语法标注稍后出现。' : '这一句没有标出特别的语法点。'}</p>}
                  </div>
                )}
                <div className="detail-nav">
                  <button disabled={sentenceIndex <= 0} onClick={() => goSentence(sentenceIndex - 1, mode === 'read')}><ChevronLeft size={16} />上一句</button>
                  <span>{sentenceIndex + 1} / {passage.sentences.length}</span>
                  <button disabled={sentenceIndex >= passage.sentences.length - 1} onClick={() => goSentence(sentenceIndex + 1, mode === 'read')}>下一句<ChevronRight size={16} /></button>
                </div>
              </article>
              </>
              ) : <p className="empty-grammar">这篇课文还没有可学习的句子，请打开「原文全文」检查或重新解析。</p>}
            </section>
          )}
        </div>
      ) : (
        <div className="wide-empty">
          <ScrollText />
          <h2>还没有课文</h2>
          <p>粘贴日语课文、上传 Word 文档，或拍一张教材照片。会先进入课文库，再在后台拆句并补整句翻译。</p>
          <button onClick={() => setUploadOpen(true)}>添加课文</button>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setUploadOpen(false)}>
          <section className="modal import-modal" onPaste={(event) => { if (!isPasteField(event.target)) void pasteClipboard(event) }}>
            <button className="modal-close" onClick={() => !busy && setUploadOpen(false)}><X /></button>
            <span className="modal-icon"><FileText /></span>
            <span className="eyebrow">PASSAGE IMPORT</span>
            <h2>添加课文</h2>
            <p>粘贴后会马上出现在课文库，翻译在后台完成，不用盯着弹窗等。</p>
            <label className="passage-add-title">课文标题
              <input value={draftTitle} maxLength={80} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：第一课 自己紹介（可不填，由 AI 归纳）" disabled={Boolean(busy)} />
            </label>
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
              <input type="file" accept="image/jpeg,image/png,image/webp,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain" hidden disabled={Boolean(busy)} onChange={(event) => { void readUpload(event.target.files?.[0]); event.target.value = '' }} />
              {busy ? <span className="spinner dark" /> : <UploadCloud />}
              <b>{busy || '拖入、点击或直接粘贴'}</b>
              <span>支持截图 Ctrl+V、Word / JPG / PNG；Word 内嵌图片也会识别</span>
            </label>
            <div className="or"><span />或粘贴课文<span /></div>
            <textarea
              className="import-textarea"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              onPaste={(event) => { void pasteClipboard(event, false) }}
              placeholder="在这里粘贴日语课文，例如：昨日、学校で日本語を勉強しました。"
              disabled={Boolean(busy)}
            />
            <button className="primary-button modal-submit" disabled={Boolean(busy) || ingesting.current || !raw.trim()} onClick={() => {
              if (ingesting.current || !raw.trim()) return
              ingesting.current = true
              queueIngest(raw, [], draftTitle)
              ingesting.current = false
            }}>{busy ? busy : <><Sparkles size={18} />生成学习内容</>}</button>
          </section>
        </div>
      )}

      {vocabOpen && passage && vocabUnit && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setVocabOpen(false)}>
          <section className="modal import-modal vocab-modal">
            <button className="modal-close" onClick={() => setVocabOpen(false)}><X /></button>
            <span className="eyebrow">PASSAGE VOCAB</span>
            <h2>抽生词进词库</h2>
            <p>把「{passage.title}」里的单词做成词卡，例如 友達、学校。</p>
            <label className="passage-add-title">放入单元
              <select value={vocabUnit.id} onChange={(event) => setVocabUnitId(event.target.value)}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <div className="vocab-pick-list">
              {vocabDrafts.map((draft) => (
                <label key={draft.term}>
                  <input type="checkbox" checked={Boolean(vocabPicked[draft.term])} onChange={(event) => setVocabPicked((current) => ({ ...current, [draft.term]: event.target.checked }))} />
                  <b className="jp">{draft.term}</b>
                  <span>{draft.reading}</span>
                  <em>{draft.meaning}</em>
                </label>
              ))}
            </div>
            <button className="primary-button modal-submit" onClick={() => addDrafts(vocabDrafts.filter((draft) => vocabPicked[draft.term]))}>做成词卡</button>
          </section>
        </div>
      )}
    </div>
  )
}

function SentencePronunciation({ sentence, onScore }: { sentence: PassageSentence; onScore?: (score: number) => void }) {
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
  }, [sentence.id])

  return (
    <div className="inline-practice">
      <button
        className={`inline-record ${practice.recording ? 'recording' : ''}`}
        disabled={practice.evaluating}
        onClick={() => {
          if (practice.recording) practice.stop()
          else { setScore(null); setTranscript(''); practice.start() }
        }}
      >
        {practice.evaluating ? <span className="spinner" /> : practice.recording ? <Pause size={18} /> : <Mic size={18} />}
        <span>{practice.evaluating ? '正在分析…' : practice.recording ? '结束跟读' : '开始跟读'}</span>
      </button>
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
