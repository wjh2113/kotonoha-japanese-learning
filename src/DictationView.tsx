import { useContext, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Check, CheckCircle2, ChevronLeft, ClipboardList, GraduationCap, Headphones,
  Keyboard, Lightbulb, Pencil, RotateCcw, SkipBack, ThumbsUp, X,
} from 'lucide-react'
import { SettingsContext } from './settings-context'
import { speakJapanese } from './speech'
import type { Unit, Word } from './types'
import {
  clampDictationGoal, dictationCandidates, dictationGap, katakanaDiff,
  loadDictationPlan, matchesKatakanaAnswer, pickDictationWords, pickErrorBookWords,
  reinsertAfterMiss, removeCurrent, saveDictationPlan, sessionMissStats, suggestedReviewWords,
  unitStudyProgress, wordKatakana, type DictationPlan,
} from './dictation'

type QueueItem = { word: Word; misses: number }
type Reveal = { ok: boolean; typed: string }
export type DictationMode = 'plan' | 'errors'

export function DictationView({
  unit, units, mode = 'plan', seedWords = [], autoStart = false,
  onUnit, onBack, onCorrect, onMiss, onMaster, onOpenErrorBook, onOpenTest, onOpenStudy,
}: {
  unit: Unit
  units: Unit[]
  mode?: DictationMode
  seedWords?: Word[]
  autoStart?: boolean
  onUnit: (id: string) => void
  onBack: () => void
  onCorrect: (word: Word) => void
  onMiss: (word: Word) => void
  onMaster: (word: Word) => void
  onOpenErrorBook: () => void
  onOpenTest: () => void
  onOpenStudy: () => void
}) {
  const { voiceGender } = useContext(SettingsContext)
  const [plan, setPlan] = useState<DictationPlan>(() => loadDictationPlan())
  const [goalDraft, setGoalDraft] = useState(String(plan.goal))
  const [editingGoal, setEditingGoal] = useState(false)
  const [started, setStarted] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState('')
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [history, setHistory] = useState<QueueItem[]>([])
  const [waitLeft, setWaitLeft] = useState(0)
  const [sessionMastered, setSessionMastered] = useState<string[]>([])
  const [sessionLearned, setSessionLearned] = useState(0)
  const [sessionReviewed, setSessionReviewed] = useState(0)
  const [finished, setFinished] = useState(false)
  const [roundSize, setRoundSize] = useState(0)
  const [missCounts, setMissCounts] = useState<Record<string, number>>({})
  const [nextOpen, setNextOpen] = useState(false)
  const composing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const waitTimer = useRef<number>(0)
  const pendingQueue = useRef<QueueItem[] | null>(null)
  const autoStarted = useRef(false)

  const sourceWords = mode === 'errors' ? (seedWords.length ? seedWords : unit.words) : unit.words
  const candidates = dictationCandidates(sourceWords)
  const reviewWords = suggestedReviewWords(unit.words)
  const errorReview = mode === 'errors'
  const progress = unitStudyProgress(errorReview
    ? units.flatMap((item) => item.words.filter((word) => word.wrongBook))
    : unit.words)
  const missStats = sessionMissStats(missCounts)
  const current = queue[index]?.word
  const expected = current ? wordKatakana(current) : ''
  const dueReview = reviewWords.length
  const learnedToday = plan.learnedIds.length
  const reviewedToday = plan.reviewedIds.length
  const newPercent = plan.goal ? Math.round(Math.min(learnedToday, plan.goal) / plan.goal * 100) : 0

  const persistPlan = (next: DictationPlan) => {
    const saved = { ...next, date: next.date, goal: clampDictationGoal(next.goal) }
    saveDictationPlan(saved)
    setPlan(saved)
  }

  const commitGoal = () => {
    const goal = clampDictationGoal(Number(goalDraft) || plan.goal)
    setGoalDraft(String(goal))
    setEditingGoal(false)
    persistPlan({ ...plan, goal })
  }

  const play = (word?: Word) => {
    if (!word) return
    void speakJapanese(word.term, voiceGender)
  }

  useEffect(() => {
    if (!started || !current || reveal) return
    play(current)
    setTyped('')
    inputRef.current?.focus()
  }, [started, current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearInterval(waitTimer.current), [])

  const clearWait = () => {
    window.clearInterval(waitTimer.current)
    setWaitLeft(0)
  }

  const start = () => {
    const picked = errorReview
      ? pickErrorBookWords(sourceWords)
      : pickDictationWords(unit.words, plan.goal, plan.learnedIds)
    const queueWords = picked.length || errorReview
      ? picked
      : pickDictationWords(unit.words, plan.goal, [])
    if (!queueWords.length) return
    pendingQueue.current = null
    clearWait()
    setQueue(queueWords.map((word) => ({ word, misses: 0 })))
    setIndex(0)
    setTyped('')
    setReveal(null)
    setHistory([])
    setSessionMastered([])
    setSessionLearned(0)
    setSessionReviewed(0)
    setMissCounts({})
    setRoundSize(queueWords.length)
    setNextOpen(false)
    setFinished(false)
    setStarted(true)
  }

  useEffect(() => {
    if (!autoStart || autoStarted.current || started) return
    autoStarted.current = true
    start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = (nextQueue = queue, nextIndex = index) => {
    clearWait()
    setReveal(null)
    setTyped('')
    if (!nextQueue.length || nextIndex >= nextQueue.length) {
      setQueue([])
      setFinished(true)
      return
    }
    setQueue(nextQueue)
    setIndex(nextIndex)
  }

  const markLearned = (word: Word, wasDue: boolean) => {
    persistPlan({
      ...plan,
      learnedIds: plan.learnedIds.includes(word.id) ? plan.learnedIds : [...plan.learnedIds, word.id],
      reviewedIds: wasDue && !plan.reviewedIds.includes(word.id) ? [...plan.reviewedIds, word.id] : plan.reviewedIds,
    })
    setSessionLearned((count) => count + 1)
    if (wasDue) setSessionReviewed((count) => count + 1)
  }

  const finishCard = (ok: boolean) => {
    if (!current || reveal) return
    const item = queue[index]
    setHistory((currentHistory) => [...currentHistory, item])
    setReveal({ ok, typed })
    if (ok) {
      onCorrect(current)
      markLearned(current, getDue(current))
      waitTimer.current = window.setInterval(() => {
        setWaitLeft((seconds) => {
          if (seconds <= 1) {
            window.clearInterval(waitTimer.current)
            goNext(removeCurrent(queue, index), index)
            return 0
          }
          return seconds - 1
        })
      }, 1000)
      setWaitLeft(5)
      return
    }
    onMiss(current)
    setMissCounts((counts) => ({ ...counts, [current.id]: (counts[current.id] || 0) + 1 }))
    const misses = item.misses + 1
    pendingQueue.current = reinsertAfterMiss(
      queue.map((entry, entryIndex) => entryIndex === index ? { ...entry, misses } : entry),
      index,
      dictationGap(misses),
    )
  }

  const check = () => {
    if (!current || reveal || !typed.trim() || composing.current) return
    finishCard(matchesKatakanaAnswer(typed, current))
  }

  const skipWait = () => {
    if (!reveal) return
    if (reveal.ok) {
      pendingQueue.current = null
      goNext(removeCurrent(queue, index), index)
      return
    }
    const nextQueue = pendingQueue.current || queue
    pendingQueue.current = null
    goNext(nextQueue, index)
  }

  useEffect(() => {
    if (!reveal) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      skipWait()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const previous = () => {
    if (!history.length) return
    clearWait()
    const last = history[history.length - 1]
    setHistory((currentHistory) => currentHistory.slice(0, -1))
    setQueue((currentQueue) => {
      const without = currentQueue.filter((_, itemIndex) => !(itemIndex === index && currentQueue[itemIndex]?.word.id === current?.id))
      return [last, ...without]
    })
    setIndex(0)
    setReveal(null)
    setTyped('')
  }

  const masterCurrent = () => {
    if (!current) return
    onMaster(current)
    setSessionMastered((ids) => ids.includes(current.id) ? ids : [...ids, current.id])
    if (!reveal?.ok) markLearned(current, getDue(current))
    goNext(removeCurrent(queue, index).filter((item) => item.word.id !== current.id), index)
  }

  const getDue = (word: Word) => reviewWords.some((item) => item.id === word.id)

  if (!candidates.length) {
    return (
      <div className="page dictation-page">
        <button className="back-link" onClick={onBack}><ChevronLeft size={17} />返回</button>
        <div className="wide-empty">
          <Keyboard />
          <h2>{errorReview ? '错词本里暂时没有可听写的词' : '这个单元还没有可听写的单词'}</h2>
          <p>{errorReview ? '听写写错过的词会自动收进来，也可以先去词库导入带读音的词卡。' : '请先导入带读音的日语词卡，再开始听写。'}</p>
        </div>
      </div>
    )
  }

  if (!started) {
    if (autoStart) {
      return <div className="page dictation-page"><p className="dictation-booting">正在开始复习…</p></div>
    }
    return (
      <div className="page dictation-page">
        <button className="back-link" onClick={onBack}><ChevronLeft size={17} />返回</button>
        <section className="hub-hero">
          <div>
            <span className="eyebrow">{errorReview ? 'ERROR BOOK REVIEW' : 'KATAKANA DICTATION'}</span>
            {!errorReview && (
              <label className="page-unit-select">
                <span>听写单元</span>
                <select aria-label="听写单元" value={unit.id} onChange={(event) => onUnit(event.target.value)}>
                  {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            <h1>{errorReview ? '错词本听写' : '单词听写'}</h1>
            <p>{errorReview ? '只听写还没掌握的错词。写对后仍留在错词本，点掌握或移出才会清掉。' : '先听发音，再写出片假名。写对变绿，写错会标红，错过的词会按间隔在本轮稍后重出。'}</p>
          </div>
        </section>
        <section className="dictation-setup">
          {!errorReview && (
            <label>今日计划学习
              <input type="number" min={5} max={200} value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} onBlur={commitGoal} />
              <span>词</span>
            </label>
          )}
          <p>{errorReview
            ? `本次将复习 ${candidates.length} 个错词`
            : `本单元可听写 ${candidates.length} 词 · 建议复习 ${dueReview} 词 · 今天已完成 ${learnedToday}/${plan.goal}`}</p>
          <button className="primary-button" onClick={start}>{errorReview ? '开始复习错词' : '开始听写'}</button>
        </section>
        {!errorReview && (
          <DictationStats
            plan={plan} dueReview={dueReview} learnedToday={learnedToday} reviewedToday={reviewedToday}
            newPercent={newPercent} editingGoal={editingGoal} goalDraft={goalDraft}
            onEditGoal={() => setEditingGoal(true)} onGoalDraft={setGoalDraft} onCommitGoal={commitGoal}
          />
        )}
      </div>
    )
  }

  if (finished || !current) {
    return (
      <div className="page dictation-page">
        <DictationFinish
          unit={unit}
          roundSize={roundSize || sessionLearned}
          learned={sessionLearned}
          missed={missStats.missed}
          sticky={missStats.sticky}
          mastered={sessionMastered.length}
          progress={progress}
          errorReview={errorReview}
          onDone={onBack}
          onNext={() => setNextOpen(true)}
          onMissed={onOpenErrorBook}
        />
        {nextOpen && (
          <NextStepSheet
            unit={unit}
            missed={missStats.missed}
            errorReview={errorReview}
            onClose={() => setNextOpen(false)}
            onReview={onOpenErrorBook}
            onTest={onOpenTest}
            onDictation={start}
            onStudy={onOpenStudy}
          />
        )}
      </div>
    )
  }

  const remaining = queue.length
  const marks = reveal ? katakanaDiff(reveal.typed, expected) : []

  return (
    <div className="page dictation-page dictation-session">
      <div className="dictation-top">
        <button className="back-link" onClick={() => { clearWait(); setStarted(false); setFinished(false) }}><ChevronLeft size={17} />{errorReview ? '错词本' : unit.name}</button>
        <small>剩余 {remaining} 词{sessionMastered.length ? ` · 本轮掌握 ${sessionMastered.length}` : ''}{sessionReviewed ? ` · 复习 ${sessionReviewed}` : ''}</small>
      </div>

      <article className={`dictation-board ${reveal ? (reveal.ok ? 'correct' : 'wrong') : ''}`}>
        {reveal && (
          <header>
            <div>
              <b className="jp">{current.term}</b>
              <span className="jp">{expected}</span>
              <em>{current.meaning}</em>
            </div>
            {reveal.ok && waitLeft > 0 && <small>{waitLeft}s 后切换下一个 · Enter 跳过</small>}
          </header>
        )}
        {!reveal && (
          <p className="dictation-hint">听发音，写出这个单词的片假名</p>
        )}
        {reveal ? (
          <p className={`dictation-typed jp ${reveal.ok ? 'ok' : 'bad'}`} aria-live="polite">
            {reveal.ok
              ? expected
              : (marks.length ? marks.map((mark, markIndex) => <span key={`${mark.char}-${markIndex}`} className={mark.ok ? '' : 'miss'}>{mark.char}</span>) : '（未输入）')}
          </p>
        ) : (
          <input
            ref={inputRef}
            className="dictation-input jp"
            value={typed}
            lang="ja"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="输入片假名，例如 ミズ"
            onChange={(event) => setTyped(event.target.value)}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={(event) => { composing.current = false; setTyped(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              check()
            }}
          />
        )}
        {reveal?.ok && (
          <button type="button" className="dictation-master" onClick={masterCurrent}><Check size={16} />标记掌握</button>
        )}
        {reveal && !reveal.ok && <p className="dictation-answer">正确答案：<b className="jp">{expected}</b></p>}
      </article>

      <div className="dictation-controls">
        <button type="button" disabled={!history.length} onClick={previous}><SkipBack size={18} />上一个单词</button>
        <button type="button" onClick={() => play(current)}><RotateCcw size={18} />再读一遍</button>
        {reveal
          ? <button type="button" className="primary-button" onClick={skipWait}>{reveal.ok ? (waitLeft ? '跳过等待' : '下一个') : '下一个继续'}</button>
          : <button type="button" className="primary-button" disabled={!typed.trim()} onClick={check}><CheckCircle2 size={18} />核对答案</button>}
      </div>
      <DictationStats
        plan={plan} dueReview={dueReview} learnedToday={learnedToday} reviewedToday={reviewedToday}
        newPercent={newPercent} editingGoal={editingGoal} goalDraft={goalDraft}
        onEditGoal={() => setEditingGoal(true)} onGoalDraft={setGoalDraft} onCommitGoal={commitGoal}
      />
    </div>
  )
}

function DictationFinish({
  unit, roundSize, learned, missed, sticky, mastered, progress, errorReview, onDone, onNext, onMissed,
}: {
  unit: Unit
  roundSize: number
  learned: number
  missed: number
  sticky: number
  mastered: number
  progress: { percent: number }
  errorReview: boolean
  onDone: () => void
  onNext: () => void
  onMissed: () => void
}) {
  return (
    <section className="finish-card">
      <header className="finish-hero">
        <span className="finish-mascot" aria-hidden><ThumbsUp size={36} /></span>
        <div>
          <h1>轻轻松松，完美收工~</h1>
          <p>恭喜完成今天「{errorReview ? '错词本' : unit.name}」的{errorReview ? '错词复习' : '听写任务'}{mastered ? `，本轮标记掌握 ${mastered} 词` : ''}</p>
        </div>
      </header>
      <dl className="finish-stats">
        <div><dt>本次学习了</dt><dd>{roundSize || learned}</dd></div>
        <div>
          <dt>拼错单词</dt>
          <dd>
            {missed ? (
              <button type="button" className="finish-miss-link" onClick={onMissed}>{missed}<ClipboardList size={14} /></button>
            ) : 0}
          </dd>
        </div>
        <div><dt>超标单词</dt><dd>{sticky}</dd></div>
      </dl>
      {missed > 0 && (
        <p className="finish-hint"><Lightbulb size={16} />拼错单词已经收录进《错词本》啦，记得去练习哦！</p>
      )}
      <div className="finish-progress">
        <b>词书学习进度</b>
        <div className="finish-bar"><i style={{ width: `${progress.percent}%` }} /></div>
        <small>已学 {progress.percent}%</small>
      </div>
      <div className="finish-actions">
        <button type="button" onClick={onDone}>{errorReview ? '返回错词本' : '美美结束学习'}</button>
        <button type="button" className="primary-button" onClick={onNext}>看看下一步练啥</button>
      </div>
    </section>
  )
}

function NextStepSheet({
  unit, missed, errorReview, onClose, onReview, onTest, onDictation, onStudy,
}: {
  unit: Unit
  missed: number
  errorReview: boolean
  onClose: () => void
  onReview: () => void
  onTest: () => void
  onDictation: () => void
  onStudy: () => void
}) {
  const steps = [
    { id: 'review', n: 1, icon: <BookOpen size={28} />, title: '复习', copy: missed ? `还有 ${missed} 个拼错词，建议先过一遍` : '错词不多，巩固一下记得更牢', action: '去复习', onClick: onReview },
    { id: 'test', n: 2, icon: <GraduationCap size={28} />, title: '测试', copy: '测一测刚才的学习效果', action: '去测试', onClick: onTest },
    { id: 'dictation', n: 3, icon: <Headphones size={28} />, title: '再听写', copy: errorReview ? '错词再听一轮，听写更稳' : '按今天的计划再听写一轮', action: errorReview ? '再练错词' : '再听写一轮', onClick: onDictation },
    { id: 'study', n: 4, icon: <Keyboard size={28} />, title: '学习', copy: `回到「${unit.name}」看词卡和例句`, action: '去学习', onClick: onStudy },
  ]
  return (
    <div className="modal-backdrop finish-next-backdrop" onClick={onClose}>
      <section className="finish-next" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <header>
          <span className="eyebrow">下一步练什么</span>
          <h2>练完这本词书，下一步该练什么？</h2>
          <p>先复习错词，再测试，听写和学习可以穿插着练。</p>
        </header>
        <div className="finish-next-grid">
          {steps.map((step) => (
            <article key={step.id} className="finish-next-card">
              <em>{step.n}</em>
              <span>{step.icon}</span>
              <b>{step.title}</b>
              <p>{step.copy}</p>
              <button type="button" className="primary-button" onClick={step.onClick}>{step.action}</button>
            </article>
          ))}
        </div>
        <div className="finish-next-plan">
          <div>
            <b>想看完整的学习安排？</b>
            <p>听写、错词本、测试和学习可以按这个顺序循环，对照自己的进度继续往下练。</p>
          </div>
          <button type="button" onClick={onStudy}>查看学习页</button>
        </div>
      </section>
    </div>
  )
}

function DictationStats({
  plan, dueReview, learnedToday, reviewedToday, newPercent, editingGoal, goalDraft,
  onEditGoal, onGoalDraft, onCommitGoal,
}: {
  plan: DictationPlan
  dueReview: number
  learnedToday: number
  reviewedToday: number
  newPercent: number
  editingGoal: boolean
  goalDraft: string
  onEditGoal: () => void
  onGoalDraft: (value: string) => void
  onCommitGoal: () => void
}) {
  return (
    <footer className="dictation-stats">
      <span>今日计划学习：
        {editingGoal
          ? <input type="number" min={5} max={200} value={goalDraft} autoFocus onChange={(event) => onGoalDraft(event.target.value)} onBlur={onCommitGoal} onKeyDown={(event) => event.key === 'Enter' && onCommitGoal()} />
          : <b>{plan.goal}</b>}
        词
        <button type="button" onClick={onEditGoal} aria-label="修改今日计划"><Pencil size={13} /></button>
      </span>
      <span>建议今日复习：<b>{dueReview}</b> 词</span>
      <span>已复习/今日计划复习：<b>{reviewedToday}/{dueReview}</b>{dueReview ? ` ${Math.round(reviewedToday / Math.max(dueReview, 1) * 100)}%` : ''}</span>
      <span>已学习/今日计划新词：<b>{Math.min(learnedToday, plan.goal)}/{plan.goal}</b> {newPercent}%</span>
    </footer>
  )
}
