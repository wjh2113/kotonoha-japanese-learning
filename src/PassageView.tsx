import { useContext, useEffect, useRef, useState, type ClipboardEvent } from 'react'
import {
  ChevronLeft, ChevronRight, FileText, Mic, Pause,
  ScrollText, Sparkles, Trash2, UploadCloud, Volume2, X,
} from 'lucide-react'
import { apiFetch } from './api'
import { extractDocxPassage, htmlToPassageText, readPassageSource } from './docx'
import { SettingsContext } from './settings-context'
import { speakJapanese } from './speech'
import type { Passage, PassageSentence } from './types'
import { pronunciationScoreFor, splitJapaneseSentences, uid } from './utils'

type Mode = 'read' | 'explain' | 'grammar'

function normalizeAnalyzed(parsed: Partial<Passage> & { sentences?: any[] }, sourceText: string): Passage {
  const sentences = Array.isArray(parsed.sentences) ? parsed.sentences.slice(0, 80) : []
  return {
    id: uid(),
    title: String(parsed.title || '课文').trim().slice(0, 80) || '课文',
    sourceText,
    createdAt: Date.now(),
    sentences: sentences.map((item) => ({
      id: uid(),
      text: String(item?.text || '').trim(),
      reading: String(item?.reading || '').trim(),
      translation: String(item?.translation || '').trim(),
      tokens: Array.isArray(item?.tokens) ? item.tokens.slice(0, 60).map((token: any) => ({
        surface: String(token?.surface || '').trim(),
        reading: String(token?.reading || '').trim(),
        meaning: String(token?.meaning || '').trim(),
      })).filter((token: { surface: string }) => token.surface) : [],
      grammar: Array.isArray(item?.grammar) ? item.grammar.slice(0, 8).map((point: any) => ({
        name: String(point?.name || '').trim(),
        pattern: String(point?.pattern || '').trim(),
        explanation: String(point?.explanation || '').trim(),
      })).filter((point: { name: string }) => point.name) : [],
    })).filter((item) => item.text),
  }
}

function fallbackPassage(sourceText: string): Passage {
  return {
    id: uid(),
    title: '课文',
    sourceText,
    createdAt: Date.now(),
    sentences: splitJapaneseSentences(sourceText).map((text) => ({
      id: uid(), text, reading: '', translation: '', tokens: [], grammar: [],
    })),
  }
}

function hydratePassage(item: unknown): Passage | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Partial<Passage> & { sentences?: unknown[] }
  const id = String(record.id || '').trim()
  const title = String(record.title || '').trim()
  if (!id || !title) return null
  const sentences = Array.isArray(record.sentences) ? record.sentences : []
  return {
    id,
    title,
    sourceText: String(record.sourceText || ''),
    createdAt: Number(record.createdAt) || Date.now(),
    sentences: sentences.map((sentence) => {
      const row = (sentence && typeof sentence === 'object') ? sentence as Record<string, any> : {}
      return {
        id: String(row.id || uid()),
        text: String(row.text || '').trim(),
        reading: String(row.reading || '').trim(),
        translation: String(row.translation || '').trim(),
        tokens: Array.isArray(row.tokens) ? row.tokens.slice(0, 60).map((token: any) => ({
          surface: String(token?.surface || '').trim(),
          reading: String(token?.reading || '').trim(),
          meaning: String(token?.meaning || '').trim(),
        })).filter((token: { surface: string }) => token.surface) : [],
        grammar: Array.isArray(row.grammar) ? row.grammar.slice(0, 8).map((point: any) => ({
          name: String(point?.name || '').trim(),
          pattern: String(point?.pattern || '').trim(),
          explanation: String(point?.explanation || '').trim(),
        })).filter((point: { name: string }) => point.name) : [],
      }
    }).filter((sentence) => sentence.text),
  }
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
    const bitmap = await createImageBitmap(file)
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
  } catch {
    if (file.size > 2 * 1024 * 1024) throw new Error('图片无法压缩，请换一张更小的照片。')
    return fileToBase64(file)
  }
}

export function PassageView() {
  const { voiceGender } = useContext(SettingsContext)
  const [passages, setPassages] = useState<Passage[]>([])
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<Mode>('read')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const persistError = useRef(false)
  const persistEnabled = useRef(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/passages').then(async (response) => {
      const data = await response.json()
      if (cancelled || !response.ok) throw new Error(data.error || '读取课文失败')
      const next = (Array.isArray(data.passages) ? data.passages as unknown[] : []).map(hydratePassage).filter((item): item is Passage => Boolean(item))
      persistEnabled.current = true
      setPassages(next)
      setSelectedId(next[0]?.id || '')
      setReady(true)
    }).catch(() => {
      if (!cancelled) { setNotice('暂时无法读取已保存的课文'); setReady(true) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || !persistEnabled.current) return
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch('/api/passages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passages }) })
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
  }, [passages, ready])

  const passage = passages.find((item) => item.id === selectedId) || passages[0]
  const sentence = passage?.sentences[sentenceIndex]

  useEffect(() => { setSentenceIndex(0) }, [selectedId])

  const addPassage = (next: Passage) => {
    persistEnabled.current = true
    setPassages((current) => [next, ...current].slice(0, 50))
    setSelectedId(next.id)
    setUploadOpen(false)
    setRaw('')
    setNotice('')
  }

  const analyzeText = async (text: string) => {
    const sourceText = text.trim()
    if (!sourceText) return
    setBusy('AI 正在拆句、释义并标注语法…')
    setNotice('')
    try {
      const response = await apiFetch('/api/passage/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: sourceText }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '解析失败')
      addPassage(normalizeAnalyzed(data, sourceText))
    } catch (reason) {
      const fallback = fallbackPassage(sourceText)
      if (!fallback.sentences.length) {
        setNotice(reason instanceof Error ? reason.message : '课文解析失败。')
        return
      }
      addPassage(fallback)
      setNotice('AI 解析暂不可用，已按句号拆开。你可以稍后重试。')
    } finally { setBusy('') }
  }

  const ocrImage = async (blob: Blob) => {
    const file = blob instanceof File ? blob : new File([blob], 'paste.jpg', { type: blob.type || 'image/jpeg' })
    const imageBase64 = await fileToCompressedJpeg(file)
    const response = await apiFetch('/api/passage/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '识别失败')
    return String(data.text || '').trim()
  }

  const ingestSource = async (text: string, images: Blob[] = []) => {
    const parts: string[] = []
    if (text.trim()) parts.push(text.trim())
    const pictureCount = images.length
    for (const [index, image] of images.slice(0, 4).entries()) {
      setBusy(pictureCount > 1 ? `正在识别课文图片 ${index + 1}/${Math.min(pictureCount, 4)}…` : '正在识别课文图片…')
      const recognized = await ocrImage(image)
      if (recognized) parts.push(recognized)
    }
    const sourceText = parts.join('\n\n').trim()
    if (!sourceText) throw new Error('没有识别到日语课文，请换一份 Word、更清晰的照片，或直接粘贴正文。')
    setRaw(sourceText)
    await analyzeText(sourceText)
  }

  const readUpload = async (file?: File) => {
    if (!file || busy) return
    setBusy('正在读取课文…')
    setNotice('')
    try {
      const source = await readPassageSource(file)
      await ingestSource(source.text, source.images)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '课文读取失败。')
      setBusy('')
    }
  }

  const pasteClipboard = async (event: ClipboardEvent<HTMLElement>, immediate = true) => {
    if (busy) return
    const clipboard = event.clipboardData
    if (!clipboard) return
    const files = Array.from(clipboard.files || [])
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    const wordFile = files.find((file) => file.name.toLowerCase().endsWith('.docx') || file.type.includes('wordprocessingml'))
    const html = clipboard.getData('text/html')
    const plain = clipboard.getData('text/plain')
    const htmlText = html ? htmlToPassageText(html) : ''
    const text = (htmlText.length > plain.trim().length ? htmlText : plain).trim()
    if (!imageFiles.length && !wordFile && !(immediate && text)) return
    event.preventDefault()
    setBusy('正在读取粘贴内容…')
    setNotice('')
    try {
      if (wordFile) {
        const source = await extractDocxPassage(wordFile)
        await ingestSource(source.text, source.images)
        return
      }
      await ingestSource(text, imageFiles)
    } catch (reason) {
      if (plain.trim()) setRaw(plain)
      setNotice(reason instanceof Error ? reason.message : '粘贴内容无法识别。')
      setBusy('')
    }
  }

  const goSentence = (index: number, speak = false) => {
    if (!passage || index < 0 || index >= passage.sentences.length) return
    setSentenceIndex(index)
    const next = passage.sentences[index]
    if (speak) void speakJapanese(next.text, voiceGender, { sentence: true })
  }

  return (
    <div className="page hub-page passage-page">
      <section className="hub-hero">
        <div>
          <span className="eyebrow">TEXTBOOK PASSAGE</span>
          <h1>课文学习</h1>
          <p>粘贴课文、上传 Word（可含图片）或教材照片。AI 拆成句子后可跟读纠音、逐词中文解释，并标出语法。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setUploadOpen(true)}><UploadCloud size={17} />添加课文</button>
        </div>
      </section>

      {notice && <div className="passage-notice">{notice}<button onClick={() => setNotice('')} aria-label="关闭"><X size={14} /></button></div>}

      {passages.length ? (
        <div className="passage-layout">
          <aside className="passage-list">
            <b>我的课文</b>
            {passages.map((item) => (
              <button key={item.id} className={item.id === passage?.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
                <span>{item.title}</span>
                <small>{item.sentences.length} 句</small>
              </button>
            ))}
          </aside>
          {passage && sentence && (
            <section className="passage-stage">
              <div className="passage-toolbar">
                <div>
                  <h2>{passage.title}</h2>
                  <small>{sentenceIndex + 1} / {passage.sentences.length} 句</small>
                </div>
                <button className="remove-word" onClick={() => {
                  if (!window.confirm(`删除课文「${passage.title}」？`)) return
                  const remaining = passages.filter((item) => item.id !== passage.id)
                  setPassages(remaining)
                  setSelectedId(remaining[0]?.id || '')
                }}><Trash2 size={15} />删除</button>
              </div>
              <div className="passage-modes">
                {([['read', '逐句跟读'], ['explain', '逐词解释'], ['grammar', '语法标识']] as const).map(([id, label]) => (
                  <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>
                ))}
              </div>
              <ol className="passage-sentences">
                {passage.sentences.map((item, index) => (
                  <li key={item.id}>
                    <button className={index === sentenceIndex ? 'active' : ''} onClick={() => goSentence(index, mode === 'read')}>
                      <em>{index + 1}</em>
                      <span className="jp">{item.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <article className="passage-card">
                <div className="passage-card-head">
                  <span className="jp reading">{sentence.reading || '读音由 AI 生成'}</span>
                  <button className="volume-button" onClick={() => void speakJapanese(sentence.text, voiceGender, { sentence: true })} aria-label="朗读这句"><Volume2 size={19} /></button>
                </div>
                <h3 className="jp">{sentence.text}</h3>
                {mode === 'read' && <SentencePronunciation sentence={sentence} />}
                {mode === 'explain' && (
                  <div className="passage-explain">
                    <p className="translation">{sentence.translation || '暂无整句翻译'}</p>
                    <div className="token-grid">
                      {(sentence.tokens.length ? sentence.tokens : [{ surface: sentence.text, reading: sentence.reading, meaning: sentence.translation || '待补充' }]).map((token, index) => (
                        <div key={`${token.surface}-${index}`}>
                          <b className="jp">{token.surface}</b>
                          <small className="jp">{token.reading}</small>
                          <span>{token.meaning}</span>
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
                    )) : <p className="empty-grammar">这一句没有标出特别的语法点。</p>}
                  </div>
                )}
                <div className="detail-nav">
                  <button disabled={sentenceIndex <= 0} onClick={() => goSentence(sentenceIndex - 1, mode === 'read')}><ChevronLeft size={16} />上一句</button>
                  <span>{sentenceIndex + 1} / {passage.sentences.length}</span>
                  <button disabled={sentenceIndex >= passage.sentences.length - 1} onClick={() => goSentence(sentenceIndex + 1, mode === 'read')}>下一句<ChevronRight size={16} /></button>
                </div>
              </article>
            </section>
          )}
        </div>
      ) : (
        <div className="wide-empty">
          <ScrollText />
          <h2>还没有课文</h2>
          <p>粘贴日语课文、上传 Word 文档，或拍一张教材照片。AI 会帮你拆句、释义并标出语法。</p>
          <button onClick={() => setUploadOpen(true)}>添加课文</button>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setUploadOpen(false)}>
          <section className="modal import-modal" onPaste={(event) => { if ((event.target as HTMLElement).tagName !== 'TEXTAREA') void pasteClipboard(event) }}>
            <button className="modal-close" onClick={() => !busy && setUploadOpen(false)}><X /></button>
            <span className="modal-icon"><FileText /></span>
            <span className="eyebrow">PASSAGE IMPORT</span>
            <h2>添加课文</h2>
            <p>可以直接复制粘贴日语正文；也支持 Word（里面的图片会自动识别）和教材照片。</p>
            <label
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (!busy) void readUpload(event.dataTransfer.files[0]) }}
              onPaste={(event) => { void pasteClipboard(event) }}
            >
              <input type="file" accept="image/jpeg,image/png,image/webp,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain" hidden disabled={Boolean(busy)} onChange={(event) => { void readUpload(event.target.files?.[0]); event.target.value = '' }} />
              {busy ? <span className="spinner dark" /> : <UploadCloud />}
              <b>{busy || '拖入、点击或直接粘贴'}</b>
              <span>Word / JPG / PNG / WEBP，Word 内嵌图片也会识别</span>
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
            <button className="primary-button modal-submit" disabled={Boolean(busy) || !raw.trim()} onClick={() => analyzeText(raw)}>{busy ? busy : <><Sparkles size={18} />生成学习内容</>}</button>
          </section>
        </div>
      )}
    </div>
  )
}

function SentencePronunciation({ sentence }: { sentence: PassageSentence }) {
  const [recording, setRecording] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [error, setError] = useState('')
  const recognition = useRef<SpeechRecognition | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const browserFallback = useRef(false)

  useEffect(() => {
    setTranscript(''); setScore(null); setError(''); setRecording(false); setEvaluating(false)
    recognition.current?.stop()
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach((track) => track.stop())
  }, [sentence.id])

  const finish = (text: string) => {
    setTranscript(text)
    setScore(pronunciationScoreFor(text, sentence.text, sentence.reading))
    setRecording(false)
    setEvaluating(false)
  }
  const recordInBrowser = () => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) { setError('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。'); return }
    const instance = new Constructor()
    recognition.current = instance
    instance.lang = 'ja-JP'; instance.interimResults = false; instance.continuous = false
    instance.onresult = (event) => finish(event.results[0][0].transcript)
    instance.onerror = (event) => { setError(event.error === 'not-allowed' ? '请允许浏览器使用麦克风。' : '没有听清，请再读一次。'); setRecording(false) }
    instance.onend = () => setRecording(false)
    setError(''); setScore(null); setTranscript(''); setRecording(true); instance.start()
  }
  const send = async (blob: Blob) => {
    setEvaluating(true)
    try {
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const response = await apiFetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64, mimeType: blob.type || 'audio/webm', filename: 'passage.webm' }) })
      const data = await response.json()
      if (!response.ok || !data.text) throw new Error(data.error || '网关没有返回转写文本。')
      finish(data.text)
    } catch (reason) {
      setEvaluating(false); browserFallback.current = true
      setError(`${reason instanceof Error ? reason.message : '语音转写失败。'} 已切换到浏览器识别，请再试一次。`)
    }
  }
  const start = async () => {
    if (browserFallback.current || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { recordInBrowser(); return }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = mediaStream
      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const mediaRecorder = new MediaRecorder(mediaStream, supported ? { mimeType: supported } : undefined)
      recorder.current = mediaRecorder; chunks.current = []
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      mediaRecorder.onstop = () => {
        mediaStream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' })
        setRecording(false); if (blob.size) send(blob)
      }
      setError(''); setScore(null); setTranscript(''); setRecording(true); mediaRecorder.start()
    } catch { browserFallback.current = true; setError('无法开始录音，已切换到浏览器识别。'); recordInBrowser() }
  }
  const stop = () => recorder.current?.state === 'recording' ? recorder.current.stop() : recognition.current?.stop()

  return (
    <div className="inline-practice">
      <p>先听标准朗读，再跟读这一句。系统会把转写结果和课文对比，提示发音差距。</p>
      <button className={`inline-record ${recording ? 'recording' : ''}`} disabled={evaluating} onClick={() => recording ? stop() : start()}>
        {evaluating ? <span className="spinner" /> : recording ? <Pause size={18} /> : <Mic size={18} />}
        <span>{evaluating ? '正在分析…' : recording ? '结束跟读' : '开始跟读'}</span>
      </button>
      {error && <div className="speech-error">{error}</div>}
      {score !== null && (
        <div className={`inline-score ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}>
          <b>{score}<small>分</small></b>
          <span>{score >= 80 ? '跟读很接近课文' : score >= 55 ? '已经听得出大意了' : '请再慢一点、按课文朗读'}<small>识别结果：{transcript}</small></span>
        </div>
      )}
    </div>
  )
}
