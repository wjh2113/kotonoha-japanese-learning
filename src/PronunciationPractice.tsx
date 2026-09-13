import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AudioLines, CheckCircle2, MessageCircle, Mic, Music2, Pause, Target, TriangleAlert,
} from 'lucide-react'
import { usePronunciationPractice } from './pronunciation-practice'
import { normalizeJapanese, pronunciationScoreFor } from './utils'
import type { PassageToken } from './types'

type Variant = 'inline' | 'compact' | 'shadow'

type PronunciationPracticeProps = {
  referenceText: string
  referenceReading?: string
  resetKey?: string | number
  onScore?: (score: number) => void
  /** Custom scorer; defaults to pronunciationScoreFor(reference). */
  scoreFn?: (transcript: string) => number
  variant?: Variant
  header?: ReactNode
  tokens?: PassageToken[]
  /** Last saved score from DB — shown by default until a new take. */
  initialScore?: number | null
  bestScore?: number | null
}

function normalizeSavedScore(value?: number | null) {
  const score = Math.round(Number(value) || 0)
  return score > 0 && score <= 100 ? score : null
}

function deriveMetrics(score: number) {
  return {
    accuracy: score,
    fluency: Math.min(100, Math.max(0, Math.round(score + (score >= 70 ? 5 : 2)))),
    intonation: Math.min(100, Math.max(0, Math.round(score - (score >= 70 ? 5 : 3)))),
  }
}

function tokenWarnTip(token: PassageToken) {
  const reading = String(token.reading || token.surface || '')
  const kana = reading.match(/[ぁ-んァ-ン]/)?.[0]
  if (kana) return `发音稍有偏差，建议加强「${kana}」的发音`
  return '发音稍有偏差，建议再练'
}

export function PronunciationPractice({
  referenceText,
  referenceReading = '',
  resetKey,
  onScore,
  scoreFn,
  variant = 'inline',
  header,
  tokens = [],
  initialScore = null,
  bestScore = null,
}: PronunciationPracticeProps) {
  const savedScore = normalizeSavedScore(initialScore)
  const savedBest = normalizeSavedScore(bestScore) || savedScore
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(savedScore)
  const [fromHistory, setFromHistory] = useState(Boolean(savedScore))
  const holdRef = useRef(false)
  const pendingStopRef = useRef(false)
  const practice = usePronunciationPractice((text) => {
    const next = scoreFn
      ? scoreFn(text)
      : pronunciationScoreFor(text, referenceText, referenceReading)
    setTranscript(text)
    setScore(next)
    setFromHistory(false)
    onScore?.(next)
  }, String(resetKey ?? referenceText))

  useEffect(() => {
    setTranscript('')
    setScore(savedScore)
    setFromHistory(Boolean(savedScore))
  }, [referenceText, resetKey, savedScore])

  useEffect(() => {
    if (!practice.recording || !pendingStopRef.current) return
    pendingStopRef.current = false
    practice.stop()
  }, [practice.recording, practice])

  const startOrStop = () => {
    if (practice.recording) practice.stop()
    else {
      // Keep last score visible until the new take finishes evaluating.
      setTranscript('')
      practice.start()
    }
  }

  const beginHold = () => {
    if (practice.evaluating || practice.recording) return
    holdRef.current = true
    pendingStopRef.current = false
    setTranscript('')
    practice.start()
  }

  const endHold = () => {
    if (!holdRef.current) return
    holdRef.current = false
    if (practice.recording) practice.stop()
    else pendingStopRef.current = true
  }

  const busy = practice.recording || practice.evaluating
  const showScore = score !== null && !busy
  const metrics = showScore ? deriveMetrics(score) : null

  const recordButton = (
    <button
      type="button"
      className={`inline-record ${variant === 'compact' ? 'compact' : ''} ${practice.recording ? 'recording' : ''}`}
      disabled={practice.evaluating}
      onClick={variant === 'shadow' ? undefined : startOrStop}
      onPointerDown={variant === 'shadow' ? (event) => {
        event.preventDefault()
        beginHold()
      } : undefined}
      onPointerUp={variant === 'shadow' ? endHold : undefined}
      onPointerCancel={variant === 'shadow' ? endHold : undefined}
      onPointerLeave={variant === 'shadow' ? endHold : undefined}
      onContextMenu={variant === 'shadow' ? (event) => event.preventDefault() : undefined}
      aria-label={practice.evaluating ? '正在分析' : practice.recording ? '松开结束跟读' : '按住跟读'}
    >
      {practice.evaluating
        ? <span className="spinner" />
        : practice.recording
          ? <Pause size={variant === 'compact' ? 15 : variant === 'shadow' ? 28 : 18} strokeWidth={1.6} />
          : <Mic size={variant === 'compact' ? 15 : variant === 'shadow' ? 28 : 18} strokeWidth={1.6} />}
      {variant === 'inline' && (
        <span>{practice.evaluating ? '正在分析…' : practice.recording ? '结束录音' : '开始朗读'}</span>
      )}
    </button>
  )

  const scoreBanner = showScore && (
    <div className={`inline-score ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}>
      <b>{score}<small>分</small></b>
      <span>
        {fromHistory
          ? '上次跟读得分'
          : variant === 'inline'
            ? (score >= 80 ? '发音很自然' : score >= 55 ? '已经很接近了' : '请跟读后再试')
            : (score >= 80 ? '跟读很接近课文' : score >= 55 ? '已经听得出大意了' : '请再慢一点、按课文朗读')}
        {transcript && <small>识别结果：{transcript}</small>}
        {fromHistory && savedBest && savedBest !== score && <small>历史最高：{savedBest} 分</small>}
      </span>
    </div>
  )

  if (variant === 'compact') {
    return (
      <div className="inline-practice compact">
        {recordButton}
        {practice.error && <div className="speech-error">{practice.error}</div>}
        {scoreBanner}
      </div>
    )
  }

  if (variant === 'shadow') {
    const tokenRows = tokens.length ? tokens : [{ surface: referenceText, reading: referenceReading, meaning: '' }]
    return (
      <div className="inline-practice shadow-practice">
        <div className="shadow-mic-wrap">
          <div className={`shadow-wave${practice.recording ? ' active' : ''}`} aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <i key={`l${i}`} style={{ height: `${12 + ((i * 9) % 28)}px` }} />
            ))}
          </div>
          {recordButton}
          <div className={`shadow-wave shadow-wave-flip${practice.recording ? ' active' : ''}`} aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <i key={`r${i}`} style={{ height: `${12 + ((i * 7) % 28)}px` }} />
            ))}
          </div>
        </div>
        <p className="shadow-hint">
          {practice.evaluating
            ? '正在解析语音，请稍候…'
            : practice.recording
              ? '正在聆听，松开结束'
              : '按住跟读'}
        </p>
        {practice.evaluating && <span className="shadow-analyzing-note">识别中，完成后会给出评分并保存</span>}
        {practice.error && <div className="speech-error">{practice.error}</div>}

        {showScore && metrics && (
          <div className="shadow-score-card">
            <div className="shadow-metrics">
              <div>
                <span><Target size={14} strokeWidth={1.7} />发音准确度</span>
                <b>{metrics.accuracy}<small>分</small></b>
              </div>
              <div>
                <span><AudioLines size={14} strokeWidth={1.7} />流畅度</span>
                <b>{metrics.fluency}<small>分</small></b>
              </div>
              <div>
                <span><Music2 size={14} strokeWidth={1.7} />音调</span>
                <b>{metrics.intonation}<small>分</small></b>
              </div>
            </div>
            <div className="shadow-overall">
              <div className="shadow-overall-bar" aria-hidden>
                <i style={{ width: `${score}%` }} />
                <em style={{ left: `${score}%` }} />
              </div>
              <p>整体评分：{score} / 100</p>
            </div>
          </div>
        )}

        {showScore && !fromHistory && (
          <section className="shadow-tokens-block" aria-label="逐字反馈">
            <header>
              <MessageCircle size={15} strokeWidth={1.7} />
              <b>逐字反馈</b>
            </header>
            <div className="shadow-tokens">
              {tokenRows.map((token, index) => {
                const spoken = normalizeJapanese(transcript)
                const target = normalizeJapanese(token.surface)
                const ok = !spoken || !target || spoken.includes(target) || score >= 70
                return (
                  <article key={`${token.surface}-${index}`} className={ok ? 'ok' : 'warn'}>
                    <b className="jp">{token.surface}</b>
                    <span>
                      {ok
                        ? <><CheckCircle2 size={14} strokeWidth={1.7} />发音正确</>
                        : <><TriangleAlert size={14} strokeWidth={1.7} />{tokenWarnTip(token)}</>}
                    </span>
                  </article>
                )
              })}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="inline-practice">
      {header}
      {recordButton}
      {practice.error && <div className="speech-error">{practice.error}</div>}
      {scoreBanner}
    </div>
  )
}
