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
  /** Last saved score from DB — shown by default until a new take. */
  initialScore?: number | null
  bestScore?: number | null
}

function normalizeSavedScore(value?: number | null) {
  const score = Math.round(Number(value) || 0)
  return score > 0 && score <= 100 ? score : null
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

  const startOrStop = () => {
    if (practice.recording) practice.stop()
    else {
      // Keep last score visible until the new take finishes evaluating.
      setTranscript('')
      practice.start()
    }
  }

  const busy = practice.recording || practice.evaluating
  const showScore = score !== null && !busy

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
      {variant === 'shadow' && practice.evaluating && <span>正在解析语音…</span>}
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
          <div className="shadow-wave" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => <i key={`l${i}`} style={{ height: `${8 + ((i * 7) % 18)}px` }} />)}
          </div>
          {recordButton}
          <div className="shadow-wave" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => <i key={`r${i}`} style={{ height: `${8 + ((i * 5) % 18)}px` }} />)}
          </div>
        </div>
        <p className="shadow-hint">
          {practice.evaluating
            ? '正在解析语音，请稍候…'
            : practice.recording
              ? '正在聆听，说完再点结束'
              : (showScore ? '可再次点击麦克风重新跟读' : '点击麦克风开始跟读')}
        </p>
        {practice.evaluating && <span className="shadow-analyzing-note">识别中，完成后会给出评分并保存</span>}
        {practice.error && <div className="speech-error">{practice.error}</div>}
        {showScore && (
          <>
            <div className="shadow-metrics">
              <div>
                <b>{score}</b>
                <small>{fromHistory ? '上次得分' : '发音准确度'}</small>
              </div>
              {savedBest !== null && (
                <div>
                  <b>{savedBest}</b>
                  <small>历史最高</small>
                </div>
              )}
            </div>
            <div className="shadow-overall">
              <span>整体评分</span>
              <div className="shadow-overall-bar"><i style={{ width: `${score}%` }} /></div>
              <b>{score} / 100</b>
            </div>
            {!fromHistory && (
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
            )}
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
