import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, ChevronLeft, Eye, FileText, Headphones, Pause, Play, SquarePen, Star } from 'lucide-react'
import { hasChineseTranslation } from './passage'
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

function lineMatch(input: string, sentence: PassageSentence) {
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
  const [showOriginal, setShowOriginal] = useState(true)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loopPlay, setLoopPlay] = useState(false)
  const [autoNext, setAutoNext] = useState(true)
  const [starredOnly, setStarredOnly] = useState(false)
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
    if (!autoNext) {
      playOne(startIndex)
      return
    }
    const start = Math.max(0, Math.min(startIndex, passage.sentences.length - 1))
    onPlaying(true)
    onIndex(start)
    const run = (from: number) => {
      void speakJapaneseQueue(passage.sentences.slice(from).map((item) => item.text), voiceGender, {
        sentence: true,
        onIndex: (offset) => onIndex(from + offset),
        onAllEnd: () => {
          if (loopPlay) run(0)
          else onPlaying(false)
        },
      })
    }
    run(start)
  }

  const saveAll = () => {
    for (const sentence of passage.sentences) {
      onDictation(sentence.id, drafts[sentence.id] || '')
    }
  }

  const visibleIndexes = useMemo(() => {
    if (!starredOnly) return passage.sentences.map((_, index) => index)
    return passage.sentences
      .map((item, index) => (starred[item.id] ? index : -1))
      .filter((index) => index >= 0)
  }, [passage.sentences, starred, starredOnly])

  const rowIndexes = starredOnly ? visibleIndexes : passage.sentences.map((_, index) => index)
  const filledCount = passage.sentences.filter((item) => (drafts[item.id] || '').trim()).length

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
          <input type="checkbox" checked={!autoNext} onChange={(event) => setAutoNext(!event.target.checked)} />
          当句播完不自动下一句
        </label>
        <label className="intensive-check">
          <input type="checkbox" checked={loopPlay} onChange={(event) => setLoopPlay(event.target.checked)} />
          循环播放
        </label>
        <label className="intensive-check">
          <input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)} />
          显示译文
        </label>
      </div>

      <div className="intensive-dual">
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
              return (
                <div key={item.id} className={`intensive-line ${active ? 'active' : ''} ${playing && active ? 'speaking' : ''}`}>
                  <em>{index + 1}</em>
                  <button type="button" className="intensive-line-play" onClick={() => playOne(index)} aria-label="播放这句">
                    {playing && active ? <Pause size={14} strokeWidth={1.6} /> : <Play size={14} strokeWidth={1.6} />}
                  </button>
                  <button type="button" className="intensive-line-text" onClick={() => playOne(index)}>
                    {showOriginal
                      ? <span className="jp">{item.text}</span>
                      : <span className="intensive-hidden">原文已隐藏</span>}
                    {showTranslation && hasChineseTranslation(item.translation) && <small>{item.translation}</small>}
                  </button>
                  <button
                    type="button"
                    className={`intensive-star ${starred[item.id] ? 'on' : ''}`}
                    onClick={() => setStarred((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    aria-label="标记句子"
                  >
                    <Star size={14} strokeWidth={1.6} />
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
              const match = proof ? lineMatch(typed, item) : (typed.trim() ? 'filled' : null)
              return (
                <label key={item.id} className={`intensive-input-row ${active ? 'active' : ''} ${match || ''}`}>
                  <em>{index + 1}</em>
                  <button type="button" className="intensive-line-play" onClick={() => playOne(index)} aria-label="播放这句">
                    <Play size={14} strokeWidth={1.6} />
                  </button>
                  <input
                    value={typed}
                    placeholder="请听写这句的日文"
                    onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    onFocus={() => onIndex(index)}
                    onBlur={() => onDictation(item.id, drafts[item.id] || '')}
                  />
                  {(match === 'exact' || match === 'filled') && <CheckCircle2 size={16} strokeWidth={1.6} className="intensive-check-icon" />}
                  {match === 'close' && <Check size={16} strokeWidth={1.6} className="intensive-check-icon soft" />}
                </label>
              )
            })}
          </div>
          <footer className="intensive-actions">
            <button type="button" className="secondary-button" onClick={() => { setProof(true); saveAll() }}>
              <Check size={15} strokeWidth={1.6} />检查答案
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setShowOriginal((value) => !value)}
            >
              <Eye size={15} strokeWidth={1.6} />{showOriginal ? '隐藏原文' : '显示原文'}
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}

