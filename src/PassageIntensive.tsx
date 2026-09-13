import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, ChevronLeft, FileText, Headphones, Pause, Play, SquarePen, Star, X } from 'lucide-react'
import { speakJapanese, speakJapaneseQueue, stopSpeaking } from './speech'
import type { Passage, PassageSentence, VoiceGender } from './types'
import { normalizeJapanese } from './utils'

type Props = {
  passage: Passage
  voiceGender: VoiceGender
  sentenceIndex: number
  playing: boolean
  onIndex: (index: number) => void
  onPlaying: (playing: boolean) => void
  onDictation: (sentenceId: string, text: string) => void
  onBack: () => void
}

type MatchKind = 'exact' | 'close' | 'miss' | 'empty' | 'filled' | null

function lineMatch(input: string, sentence: PassageSentence): 'exact' | 'close' | 'miss' | null {
  const typed = normalizeJapanese(input)
  if (!typed) return null
  const targets = [sentence.text, sentence.reading].map(normalizeJapanese).filter(Boolean)
  if (targets.some((item) => item === typed)) return 'exact'
  if (targets.some((item) => item.includes(typed) || typed.includes(item))) return 'close'
  return 'miss'
}

export function PassageIntensive({
  passage, voiceGender, sentenceIndex, playing, onIndex, onPlaying, onDictation, onBack,
}: Props) {
  const [starredOnly, setStarredOnly] = useState(false)
  const [showSource, setShowSource] = useState(true)
  const [starred, setStarred] = useState<Record<string, boolean>>({})
  const [proof, setProof] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    for (const sentence of passage.sentences) {
      next[sentence.id] = passage.progress?.[sentence.id]?.dictation || ''
    }
    return next
  })

  const sentences = useMemo(() => {
    if (!starredOnly) return passage.sentences
    return passage.sentences.filter((item) => starred[item.id])
  }, [passage.sentences, starred, starredOnly])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const sentence of passage.sentences) {
      next[sentence.id] = drafts[sentence.id] ?? passage.progress?.[sentence.id]?.dictation ?? ''
    }
    setDrafts(next)
    setProof(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage.id])

  const playOne = (index: number) => {
    const absolute = passage.sentences[index]
    if (!absolute) return
    onPlaying(false)
    stopSpeaking()
    onIndex(index)
    void speakJapanese(absolute.text, voiceGender, { sentence: true })
  }

  const playContinuous = (startIndex = sentenceIndex) => {
    if (playing) {
      stopSpeaking()
      onPlaying(false)
      return
    }
    const start = Math.max(0, Math.min(startIndex, passage.sentences.length - 1))
    onPlaying(true)
    onIndex(start)
    void speakJapaneseQueue(passage.sentences.slice(start).map((item) => item.text), voiceGender, {
      sentence: true,
      onIndex: (offset) => onIndex(start + offset),
      onAllEnd: () => onPlaying(false),
    })
  }

  const saveAll = () => {
    for (const sentence of passage.sentences) {
      onDictation(sentence.id, drafts[sentence.id] || '')
    }
  }

  const checkAnswers = () => {
    saveAll()
    setProof(true)
  }

  const visibleIndexes = useMemo(() => {
    if (!starredOnly) return passage.sentences.map((_, index) => index)
    return passage.sentences
      .map((item, index) => (starred[item.id] ? index : -1))
      .filter((index) => index >= 0)
  }, [passage.sentences, starred, starredOnly])

  const rowIndexes = starredOnly ? visibleIndexes : passage.sentences.map((_, index) => index)
  const filledCount = passage.sentences.filter((item) => (drafts[item.id] || '').trim()).length

  const score = useMemo(() => {
    if (!proof) return null
    let exact = 0
    let close = 0
    let miss = 0
    let empty = 0
    for (const index of rowIndexes) {
      const item = passage.sentences[index]
      if (!item) continue
      const typed = drafts[item.id] || ''
      if (!typed.trim()) {
        empty += 1
        continue
      }
      const kind = lineMatch(typed, item)
      if (kind === 'exact') exact += 1
      else if (kind === 'close') close += 1
      else miss += 1
    }
    return { exact, close, miss, empty, total: rowIndexes.length }
  }, [proof, rowIndexes, passage.sentences, drafts])

  return (
    <div className="intensive-page intensive-design">
      <div className="intensive-heading">
        <div>
          <h2><Headphones size={20} strokeWidth={1.6} />精听模式</h2>
          <p>边听边写，提升听力与记忆</p>
        </div>
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={16} strokeWidth={1.6} />返回课文</button>
      </div>

      <div className="intensive-toolbar">
        <label className="intensive-check">
          <input type="checkbox" checked={starredOnly} onChange={(event) => setStarredOnly(event.target.checked)} />
          仅显示标记的句子
        </label>
        <label className="intensive-check">
          <input type="checkbox" checked={showSource} onChange={(event) => setShowSource(event.target.checked)} />
          显示左侧原文
        </label>
      </div>

      <div className={`intensive-dual ${showSource ? '' : 'source-hidden'}`}>
        {showSource && (
        <section className="intensive-col">
          <header>
            <b><FileText size={15} strokeWidth={1.6} />逐句原文</b>
            <small>{sentenceIndex + 1} / {passage.sentences.length}</small>
          </header>
          <div className="intensive-col-body">
            {rowIndexes.map((index) => {
              const item = passage.sentences[index]
              if (!item) return null
              const active = index === sentenceIndex
              const marked = Boolean(starred[item.id])
              return (
                <div key={item.id} className={`intensive-line ${active ? 'active' : ''} ${playing && active ? 'speaking' : ''} ${marked ? 'marked' : ''}`}>
                  <em>{index + 1}</em>
                  <button type="button" className="intensive-line-play" onClick={() => playOne(index)} aria-label="播放这句">
                    {playing && active ? <Pause size={14} strokeWidth={1.6} /> : <Play size={14} strokeWidth={1.6} />}
                  </button>
                  <button type="button" className="intensive-line-text" onClick={() => playOne(index)}>
                    <span className="jp">{item.text}</span>
                  </button>
                  <button
                    type="button"
                    className={`intensive-star ${marked ? 'on' : ''}`}
                    onClick={() => setStarred((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    aria-label={marked ? '取消标记' : '标记句子'}
                    title={marked ? '已标记' : '点击标记'}
                  >
                    <Star size={16} strokeWidth={2} fill={marked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })}
            {!sentences.length && <p className="empty-grammar">没有可精听的句子。可取消「仅显示标记」。</p>}
          </div>
          <footer>
            <button type="button" className="intensive-play-all" onClick={() => playContinuous(0)}>
              {playing ? <Pause size={15} strokeWidth={1.6} /> : <Play size={15} strokeWidth={1.6} />}
              {playing ? '停止播放' : '播放全部'}
            </button>
          </footer>
        </section>
        )}

        <section className="intensive-col">
          <header>
            <b><SquarePen size={15} strokeWidth={1.6} />听写输入</b>
            <small>请听写这句的日文 · 已填 {filledCount}/{passage.sentences.length}</small>
          </header>
          <div className="intensive-col-body">
            {rowIndexes.map((index) => {
              const item = passage.sentences[index]
              if (!item) return null
              const active = index === sentenceIndex
              const typed = drafts[item.id] || ''
              const match: MatchKind = proof
                ? (typed.trim() ? lineMatch(typed, item) : 'empty')
                : (typed.trim() ? 'filled' : null)
              const marked = Boolean(starred[item.id])
              return (
                <div key={item.id} className={`intensive-input-row ${active ? 'active' : ''} ${match || ''} ${marked ? 'marked' : ''}`}>
                  <em>{index + 1}</em>
                  <button type="button" className="intensive-line-play" onClick={() => playOne(index)} aria-label="播放这句">
                    <Play size={14} strokeWidth={1.6} />
                  </button>
                  <div className="intensive-input-main">
                    <input
                      value={typed}
                      placeholder="请听写这句的日文"
                      onChange={(event) => {
                        setProof(false)
                        setDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                      }}
                      onFocus={() => onIndex(index)}
                      onBlur={() => onDictation(item.id, drafts[item.id] || '')}
                    />
                    {proof && match === 'exact' && <small className="intensive-answer-hint ok">正确</small>}
                    {proof && match === 'close' && (
                      <small className="intensive-answer-hint soft">接近 · 参考：<span className="jp">{item.text}</span></small>
                    )}
                    {proof && match === 'miss' && (
                      <small className="intensive-answer-hint bad">不正确 · 原文：<span className="jp">{item.text}</span></small>
                    )}
                    {proof && match === 'empty' && (
                      <small className="intensive-answer-hint bad">未填写 · 原文：<span className="jp">{item.text}</span></small>
                    )}
                  </div>
                  {!showSource && (
                    <button
                      type="button"
                      className={`intensive-star ${marked ? 'on' : ''}`}
                      onClick={() => setStarred((current) => ({ ...current, [item.id]: !current[item.id] }))}
                      aria-label={marked ? '取消标记' : '标记句子'}
                      title={marked ? '已标记' : '点击标记'}
                    >
                      <Star size={16} strokeWidth={2} fill={marked ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  {match === 'exact' && <CheckCircle2 size={16} strokeWidth={1.6} className="intensive-check-icon" />}
                  {match === 'close' && <Check size={16} strokeWidth={1.6} className="intensive-check-icon soft" />}
                  {(match === 'miss' || match === 'empty') && <X size={16} strokeWidth={1.6} className="intensive-check-icon bad" />}
                </div>
              )
            })}
          </div>
          <footer className="intensive-actions">
            {score && (
              <div className="intensive-result" role="status">
                正确 {score.exact} · 接近 {score.close} · 错误 {score.miss} · 未填 {score.empty}
                <span>（共 {score.total} 句）</span>
              </div>
            )}
            <button type="button" className="secondary-button" onClick={checkAnswers}>
              <Check size={15} strokeWidth={1.6} />{proof ? '重新检查' : '检查答案'}
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}
