import {
  BookOpen, CheckCircle2, ChevronRight, ClipboardList, Flame, Headphones, Target, Zap,
} from 'lucide-react'
import type { AppSettings, Unit, View, Word } from './types'
import { getReviewState, REVIEW_INTERVAL_DAYS } from './utils'

type Props = {
  units: Unit[]
  unit: Unit | undefined
  settings: AppSettings
  onView: (view: View) => void
}

function calendarMarks(words: Word[], year: number, month: number) {
  const marks = new Map<number, 'due' | 'done' | 'planned'>()
  const now = Date.now()
  for (const word of words) {
    if (!Number.isFinite(word.nextReviewAt)) continue
    const d = new Date(Number(word.nextReviewAt))
    if (d.getFullYear() !== year || d.getMonth() !== month) continue
    const day = d.getDate()
    const state = getReviewState(word, now)
    const kind = state.due ? 'due' : word.mastered ? 'done' : 'planned'
    const prev = marks.get(day)
    if (!prev || (kind === 'due' && prev !== 'due') || (kind === 'done' && prev === 'planned')) marks.set(day, kind)
  }
  return marks
}

export function HomeView({ units, unit, settings, onView }: Props) {
  const allWords = units.flatMap((item) => item.words)
  const dueCount = allWords.filter((word) => getReviewState(word).due).length
  const unmastered = (unit?.words || []).filter((word) => !word.mastered)
  const planTarget = Math.min(30, Math.max(unmastered.length, 1))
  const todayMastered = (unit?.words || []).filter((word) => {
    if (!word.lastReviewedAt) return false
    const d = new Date(word.lastReviewedAt)
    const now = new Date()
    return word.mastered && d.toDateString() === now.toDateString()
  }).length
  const completed = Math.min(planTarget, todayMastered || (unit?.words.filter((w) => w.mastered).length || 0) % planTarget)
  const learned = unit?.words.filter((w) => w.mastered).length || 0
  const total = unit?.words.length || 0
  const percent = Math.round(learned / Math.max(total, 1) * 100)
  const streak = settings.streakDays || 0

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const marks = calendarMarks(allWords, year, month)
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const dueToday = allWords.filter((w) => getReviewState(w).due).length
  const plannedSoon = allWords.filter((w) => {
    const s = getReviewState(w)
    return !s.due && s.daysUntil !== null && s.daysUntil <= 7
  }).length
  const masteredCount = allWords.filter((w) => w.mastered).length
  const notDue = Math.max(0, allWords.length - dueToday - plannedSoon)

  const monthLabel = `${year}年${month + 1}月`

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div>
          <h1>欢迎回来，今日继续学习</h1>
          <p>一词一句，把日语学得更稳、更喜欢。</p>
        </div>
      </section>

      <div className="home-stats">
        <article><span className="home-stat-icon plan"><Target size={18} /></span><div><b>{planTarget} 词</b><small>今日计划</small><em>目标学习量</em></div></article>
        <article><span className="home-stat-icon done"><CheckCircle2 size={18} /></span><div><b>{completed} 词</b><small>已完成</small><em>今日已掌握/复习</em></div></article>
        <article><span className="home-stat-icon review"><ClockIcon /></span><div><b>{dueCount} 词</b><small>待复习</small><em>已到期提醒</em></div></article>
        <article><span className="home-stat-icon streak"><Flame size={18} /></span><div><b>{streak} 天</b><small>连续学习</small><em>保持节奏</em></div></article>
      </div>

      <div className="home-mid">
        <section className="home-card continue-card">
          <header>
            <div><BookOpen size={18} /><b>继续学习</b></div>
            <button type="button" onClick={() => onView('study')}>进入学习 <ChevronRight size={14} /></button>
          </header>
          <div className="continue-body">
            <div className="continue-thumb" aria-hidden />
            <div>
              <em>{unit?.name || '未选择单元'}</em>
              <p>{unit ? (unit.description || '继续巩固本单元单词') : '请先创建或选择一个单元'}</p>
              <div className="continue-bar"><i style={{ width: `${percent}%` }} /></div>
              <small>已学 {learned} / {total} 词 · 还剩 {Math.max(0, total - learned)} 词</small>
            </div>
          </div>
        </section>

        <section className="home-card review-card">
          <header>
            <div><ClipboardList size={18} /><b>今日复习</b></div>
            <button type="button" onClick={() => onView('review')}>查看全部 <ChevronRight size={14} /></button>
          </header>
          <div className="home-calendar-wrap">
            <div className="home-calendar">
              <div className="home-cal-head">{monthLabel}</div>
              <div className="home-cal-week">{['日', '一', '二', '三', '四', '五', '六'].map((d) => <span key={d}>{d}</span>)}</div>
              <div className="home-cal-grid">
                {cells.map((day, i) => (
                  <span key={i} className={day ? `day mark-${marks.get(day) || 'none'}${day === now.getDate() ? ' today' : ''}` : 'empty'}>
                    {day || ''}
                  </span>
                ))}
              </div>
            </div>
            <ul className="home-cal-legend">
              <li><i className="due" />今日复习 <b>{dueToday}</b></li>
              <li><i className="done" />已掌握 <b>{masteredCount}</b></li>
              <li><i className="planned" />近期待复习 <b>{plannedSoon}</b></li>
              <li><i className="none" />未安排 <b>{notDue}</b></li>
            </ul>
          </div>
          <p className="home-srs-tip">按艾宾浩斯间隔（{REVIEW_INTERVAL_DAYS.join('/')} 天）安排复习，记得越牢，间隔越长。</p>
        </section>
      </div>

      <section className="home-shortcuts">
        <h2><Zap size={16} />快捷入口</h2>
        <div className="home-shortcut-grid">
          <button type="button" onClick={() => onView('study')}><span><BookOpen size={20} /></span><b>单词学习</b><small>卡片记忆与跟读</small><ChevronRight size={14} /></button>
          <button type="button" onClick={() => onView('passage')}><span><BookOpen size={20} /></span><b>课文学习</b><small>精听 · 跟读 · 语法</small><ChevronRight size={14} /></button>
          <button type="button" onClick={() => onView('test')}><span><ClipboardList size={20} /></span><b>测试</b><small>听力与词义四选一</small><ChevronRight size={14} /></button>
          <button type="button" onClick={() => onView('dictation')}><span><Headphones size={20} /></span><b>听写</b><small>听音写词巩固记忆</small><ChevronRight size={14} /></button>
        </div>
      </section>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  )
}
