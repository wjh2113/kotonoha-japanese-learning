import { useContext, useEffect, useRef, useState } from 'react'
import {
  Check, CheckCircle2, ChevronLeft, Keyboard, Pencil, RotateCcw, SkipBack,
} from 'lucide-react'
import { SettingsContext } from './settings-context'
import { speakJapanese } from './speech'
import type { Unit, Word } from './types'
import {
  clampDictationGoal, dictationCandidates, dictationGap, katakanaDiff,
  loadDictationPlan, matchesKatakanaAnswer, pickDictationWords, reinsertAfterMiss, removeCurrent,
  saveDictationPlan, suggestedReviewWords, wordKatakana, type DictationPlan,
} from './dictation'

type QueueItem = { word: Word; misses: number }
type Reveal = { ok: boolean; typed: string }

export function DictationView({
  unit, units, onUnit, onBack, onCorrect, onMiss, onMaster,
}: {
  unit: Unit
  units: Unit[]
  onUnit: (id: string) => void
  onBack: () => void
  onCorrect: (word: Word) => void
  onMiss: (word: Word) => void
  onMaster: (word: Word) => void
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
  const composing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const waitTimer = useRef<number>(0)
  const pendingQueue = useRef<QueueItem[] | null>(null)

  const candidates = dictationCandidates(unit.words)
  const reviewWords = suggestedReviewWords(unit.words)
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
    const picked = pickDictationWords(unit.words, plan.goal, plan.learnedIds)
    const queueWords = picked.length ? picked : pickDictationWords(unit.words, plan.goal, [])
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
    setFinished(false)
    setStarted(true)
  }

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
          <h2>这个单元还没有可听写的单词</h2>
          <p>请先导入带读音的日语词卡，再开始听写。</p>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="page dictation-page">
        <button className="back-link" onClick={onBack}><ChevronLeft size={17} />返回</button>
        <section className="hub-hero">
          <div>
            <span className="eyebrow">KATAKANA DICTATION</span>
            <label className="page-unit-select">
              <span>听写单元</span>
              <select aria-label="听写单元" value={unit.id} onChange={(event) => onUnit(event.target.value)}>
                {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <h1>单词听写</h1>
            <p>先听发音，再写出片假名。写对变绿，写错会标红，错过的词会按间隔在本轮稍后重出。</p>
          </div>
        </section>
        <section className="dictation-setup">
          <label>今日计划学习
            <input type="number" min={5} max={200} value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} onBlur={commitGoal} />
            <span>词</span>
          </label>
          <p>本单元可听写 {candidates.length} 词 · 建议复习 {dueReview} 词 · 今天已完成 {learnedToday}/{plan.goal}</p>
          <button className="primary-button" onClick={start}>开始听写</button>
        </section>
        <DictationStats
          plan={plan} dueReview={dueReview} learnedToday={learnedToday} reviewedToday={reviewedToday}
          newPercent={newPercent} editingGoal={editingGoal} goalDraft={goalDraft}
          onEditGoal={() => setEditingGoal(true)} onGoalDraft={setGoalDraft} onCommitGoal={commitGoal}
        />
      </div>
    )
  }

  if (finished || (started && !current)) {
    return (
      <div className="page dictation-page">
        <div className="result-card">
          <span className="result-icon"><CheckCircle2 /></span>
          <span className="eyebrow">DICTATION COMPLETE</span>
          <h1>本轮听写完成</h1>
          <p>本轮写对 {sessionLearned} 词，标记掌握 {sessionMastered.length} 词。错过的词已在本轮按间隔重出直到写对。</p>
          <div className="result-actions">
            <button onClick={onBack}>返回学习</button>
            <button className="primary-button" onClick={start}>再听写一轮</button>
          </div>
        </div>
        <DictationStats
          plan={plan} dueReview={dueReview} learnedToday={learnedToday} reviewedToday={reviewedToday}
          newPercent={newPercent} editingGoal={editingGoal} goalDraft={goalDraft}
          onEditGoal={() => setEditingGoal(true)} onGoalDraft={setGoalDraft} onCommitGoal={commitGoal}
        />
      </div>
    )
  }

  const remaining = queue.length
  const marks = reveal ? katakanaDiff(reveal.typed, expected) : []

  return (
    <div className="page dictation-page dictation-session">
      <div className="dictation-top">
        <button className="back-link" onClick={() => { clearWait(); setStarted(false); setFinished(false) }}><ChevronLeft size={17} />{unit.name}</button>
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
