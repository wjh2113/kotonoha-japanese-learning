import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Mic, Pause, TriangleAlert } from 'lucide-react'
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
}: PronunciationPracticeProps) {
  const [transcript, setTranscript] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const practice = usePronunciationPractice((text) => {
    const next = scoreFn
      ? scoreFn(text)
      : pronunciationScoreFor(text, referenceText, referenceReading)
    setTranscript(text)
    setScore(next)
    onScore?.(next)
  }, String(resetKey ?? referenceText))

  useEffect(() => {
    setTranscript('')
    setScore(null)
  }, [referenceText, resetKey])

  const startOrStop = () => {
    if (practice.recording) practice.stop()
    else {
      setScore(null)
      setTranscript('')
      practice.start()
    }
  }

  const recordButton = (
    <button
      type="button"
      className={`inline-record ${variant === 'compact' ? 'compact' : ''} ${practice.recording ? 'recording' : ''}`}
      disabled={practice.evaluating}
      onClick={startOrStop}
      aria-label={practice.evaluating ? '正在分析' : practice.recording ? '结束跟读' : '开始跟读'}
    >
      {practice.evaluating
        ? <span className="spinner" />
        : practice.recording
          ? <Pause size={variant === 'compact' ? 15 : variant === 'shadow' ? 22 : 18} strokeWidth={1.6} />
          : <Mic size={variant === 'compact' ? 15 : variant === 'shadow' ? 22 : 18} strokeWidth={1.6} />}
      {variant === 'inline' && (
        <span>{practice.evaluating ? '正在分析…' : practice.recording ? '结束录音' : '开始朗读'}</span>
      )}
      {variant === 'shadow' && practice.evaluating && <span>正在分析…</span>}
    </button>
  )

  const scoreBanner = score !== null && (
    <div className={`inline-score ${score >= 80 ? 'great' : score >= 55 ? 'okay' : 'retry'}`}>
      <b>{score}<small>分</small></b>
      <span>
        {variant === 'inline'
          ? (score >= 80 ? '发音很自然' : score >= 55 ? '已经很接近了' : '请跟读后再试')
          : (score >= 80 ? '跟读很接近课文' : score >= 55 ? '已经听得出大意了' : '请再慢一点、按课文朗读')}
        <small>识别结果：{transcript}</small>
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
            </div>
            <div className="shadow-overall">
              <span>整体评分</span>
              <div className="shadow-overall-bar"><i style={{ width: `${score}%` }} /></div>
              <b>{score} / 100</b>
            </div>
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

  return (
    <div className="inline-practice">
      {header}
      {recordButton}
      {practice.error && <div className="speech-error">{practice.error}</div>}
      {scoreBanner}
    </div>
  )
}
