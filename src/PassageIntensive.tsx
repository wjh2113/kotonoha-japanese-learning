import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Pause, Play, Star } from 'lucide-react'
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

  const total = Math.max(1, passage.sentences.length)
  const progressPct = Math.round(((sentenceIndex + (playing ? 0.55 : 0)) / total) * 1000) / 10

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

  return (
    <div className="intensive-page">
      <div className="intensive-top">
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={16} />返回课文</button>
        <div className="intensive-player">
          <span>音频播放</span>
          <button
            type="button"
            className="intensive-play"
            onClick={() => playContinuous(sentenceIndex)}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div className="intensive-progress" aria-label="播放进度">
            <i style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
          </div>
          <em>{sentenceIndex + 1} / {passage.sentences.length}</em>
          <label className="intensive-check">
            <input type="checkbox" checked={starredOnly} onChange={(event) => setStarredOnly(event.target.checked)} />
            仅显示标记的句子
          </label>
          <label className="intensive-check">
            <input type="checkbox" checked={!autoNext} onChange={(event) => setAutoNext(!event.target.checked)} />
            当句播完不自动下一句
          </label>
        </div>
      </div>

      <div className="intensive-layout">
        <section className="intensive-main">
          <div className="intensive-cols-head">
            <div>
              <b>逐句原文</b>
              <small>{sentenceIndex + 1} / {passage.sentences.length}</small>
            </div>
            <div>
              <b>听写输入</b>
              <small>请听写这句的日文</small>
            </div>
          </div>
          <div className="intensive-rows">
            {(starredOnly ? visibleIndexes : passage.sentences.map((_, index) => index)).map((index) => {
              const item = passage.sentences[index]
              if (!item) return null
              const active = index === sentenceIndex
              const typed = drafts[item.id] || ''
              const match = proof ? lineMatch(typed, item) : null
              return (
                <div key={item.id} className={`intensive-row ${active ? 'active' : ''} ${playing && active ? 'speaking' : ''}`}>
                  <button
                    type="button"
                    className="intensive-source"
                    onClick={() => playOne(index)}
                  >
                    <span
                      className={`intensive-star ${starred[item.id] ? 'on' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setStarred((current) => ({ ...current, [item.id]: !current[item.id] }))
                      }}
                      role="presentation"
                    >
                      <Star size={14} />
                    </span>
                    <em>{index + 1}</em>
                    <span className="intensive-source-text">
                      {showOriginal
                        ? <span className="jp">{item.text}</span>
                        : <span className="intensive-hidden">原文已隐藏</span>}
                      {showTranslation && hasChineseTranslation(item.translation) && (
                        <small>{item.translation}</small>
                      )}
                    </span>
                  </button>
                  <label className={`intensive-dictation ${match || ''}`}>
                    <input
                      value={typed}
                      placeholder="在此输入听写内容，Tab 进入下一格"
                      onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                      onFocus={() => onIndex(index)}
                      onBlur={() => onDictation(item.id, drafts[item.id] || '')}
                    />
                  </label>
                </div>
              )
            })}
            {!sentences.length && <p className="empty-grammar">没有可精听的句子。可取消「仅显示标记」。 </p>}
          </div>
        </section>

        <aside className="intensive-side">
          <button type="button" className="primary-button" onClick={saveAll}>保存听写</button>
          <button type="button" className={loopPlay ? 'active' : ''} onClick={() => setLoopPlay((value) => !value)}>循环播放</button>
          <button type="button" className={playing ? 'active' : ''} onClick={() => playContinuous(sentenceIndex)}>
            {playing ? '暂停播放' : '开始播放'}
          </button>
          <button type="button" disabled={sentenceIndex <= 0} onClick={() => playOne(sentenceIndex - 1)}>上一句</button>
          <button type="button" disabled={sentenceIndex >= passage.sentences.length - 1} onClick={() => playOne(sentenceIndex + 1)}>下一句</button>
          <button type="button" className={!showOriginal ? 'active' : ''} onClick={() => setShowOriginal((value) => !value)}>
            {showOriginal ? '隐藏原文' : '显示原文'}
          </button>
          <button type="button" className={showTranslation ? 'active' : ''} onClick={() => setShowTranslation((value) => !value)}>
            {showTranslation ? '隐藏译文' : '显示译文'}
          </button>
          <button type="button" className={proof ? 'active proof' : 'proof'} onClick={() => setProof((value) => !value)}>
            {proof ? '关闭校对' : '一键校对'}
          </button>
          <button type="button" className="back-quiet" onClick={onBack}><ChevronLeft size={14} />返回课文全文</button>
        </aside>
      </div>
    </div>
  )
}
