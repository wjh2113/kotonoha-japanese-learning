import {
  BookOpen, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, FileText, Flame, Headphones, Leaf, Target, Zap,
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
  const planTarget = Math.min(30, Math.max(unmastered.length || planFallback(unit), 1))
  const todayMastered = (unit?.words || []).filter((word) => {
    if (!word.lastReviewedAt) return false
    const d = new Date(word.lastReviewedAt)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  }).length
  const learned = unit?.words.filter((w) => w.mastered).length || 0
  const total = unit?.words.length || 0
  const percent = Math.round(learned / Math.max(total, 1) * 100)
  const remaining = Math.max(0, total - learned)
  const streak = settings.streakDays || 0
  const completed = Math.min(planTarget, todayMastered)

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

  const dueToday = dueCount
  const plannedSoon = allWords.filter((w) => {
    const s = getReviewState(w)
    return !s.due && s.daysUntil !== null && s.daysUntil > 0 && s.daysUntil <= 7
  }).length
  const masteredCount = allWords.filter((w) => w.mastered).length
  const notDue = Math.max(0, allWords.length - dueToday - plannedSoon - masteredCount + allWords.filter((w) => w.mastered && getReviewState(w).due).length)

  const unitIndex = Math.max(1, units.findIndex((item) => item.id === unit?.id) + 1)
  const unitTitle = unit ? `第${unitIndex}单元 ${unit.name}` : '未选择单元'
  const unitTheme = unit ? (unit.description || '继续巩固本单元') : '请先创建单元'

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div>
          <h1>欢迎回来，今日继续学习</h1>
          <p>每天一点点，日语会变得更简单</p>
        </div>
        <div className="home-hero-deco" aria-hidden>
          <svg viewBox="0 0 180 100" className="home-torii">
            <circle cx="132" cy="28" r="16" fill="currentColor" opacity=".12" />
            <path d="M48 42 H150 M55 42 V78 M143 42 V78 M42 36 H156 M48 48 H150" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity=".22" />
            <path d="M20 88 C50 70 70 78 90 66 C110 54 130 70 160 58" stroke="currentColor" strokeWidth="2" fill="none" opacity=".14" />
          </svg>
        </div>
      </section>

      <div className="home-stats">
        <article>
          <span className="home-stat-icon plan"><Target size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{planTarget} <i>词</i></strong>
            <b>今日计划</b>
            <em>目标学习量</em>
          </div>
        </article>
        <article>
          <span className="home-stat-icon done"><CheckCircle2 size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{completed} <i>词</i></strong>
            <b>已完成</b>
            <em>今日已学习</em>
          </div>
        </article>
        <article className="review-stat">
          <span className="home-stat-icon review"><CalendarDays size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{dueCount} <i>词</i></strong>
            <b>待复习</b>
            <em>已到期提醒</em>
          </div>
        </article>
        <article>
          <span className="home-stat-icon streak"><Flame size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{streak} <i>天</i></strong>
            <b>连续学习</b>
            <em>保持节奏</em>
          </div>
        </article>
      </div>

      <div className="home-mid">
        <section className="home-card continue-card">
          <header>
            <div><BookOpen size={17} strokeWidth={1.6} /><b>继续学习</b></div>
            <button type="button" onClick={() => onView('study')}>进入学习 <ChevronRight size={14} /></button>
          </header>
          <div className="continue-body">
            <div className="continue-thumb" aria-hidden>
              <span />
            </div>
            <div className="continue-copy">
              <em>{unitTitle}</em>
              <p>{unitTheme}</p>
              <div className="continue-bar-row">
                <div className="continue-bar"><i style={{ width: `${percent}%` }} /></div>
                <b>{percent}%</b>
              </div>
              <small>已学 {learned} / {total} 词 · 预计还需 {remaining} 词</small>
            </div>
          </div>
        </section>

        <section className="home-card review-card">
          <header>
            <div><ClipboardList size={17} strokeWidth={1.6} /><b>今日复习</b></div>
            <button type="button" onClick={() => onView('review')}>查看全部 <ChevronRight size={14} /></button>
          </header>
          <div className="home-calendar-wrap">
            <div className="home-calendar">
              <div className="home-cal-head">{year}年{month + 1}月</div>
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
              <li><i className="due" /><span>今日复习</span><b>{dueToday}</b></li>
              <li><i className="done" /><span>已完成</span><b>{masteredCount}</b></li>
              <li><i className="planned" /><span>待复习</span><b>{plannedSoon}</b></li>
              <li><i className="none" /><span>未到期</span><b>{Math.max(0, notDue)}</b></li>
            </ul>
          </div>
          <p className="home-srs-tip">
            <Leaf size={14} strokeWidth={1.6} />
            <span>复习是记忆的最佳方式 · 坚持 SRS（{REVIEW_INTERVAL_DAYS.join('/')} 天），让记忆更牢固！</span>
          </p>
        </section>
      </div>

      <section className="home-shortcuts">
        <h2><Zap size={15} strokeWidth={1.6} />快捷入口</h2>
        <div className="home-shortcut-grid">
          <button type="button" onClick={() => onView('study')}>
            <span className="sc-vocab"><BookOpen size={18} strokeWidth={1.6} /></span>
            <b>单词学习</b>
            <small>背单词 · 记词义 · 练发音</small>
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={() => onView('passage')}>
            <span className="sc-passage"><FileText size={18} strokeWidth={1.6} /></span>
            <b>课文学习</b>
            <small>精读课文 · 语法解析 · 例句</small>
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={() => onView('test')}>
            <span className="sc-test"><ClipboardList size={18} strokeWidth={1.6} /></span>
            <b>测试</b>
            <small>巩固知识 · 检验成果</small>
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={() => onView('dictation')}>
            <span className="sc-dict"><Headphones size={18} strokeWidth={1.6} /></span>
            <b>听写</b>
            <small>听音写词 · 提升听力</small>
            <ChevronRight size={14} />
          </button>
        </div>
      </section>
    </div>
  )
}

function planFallback(unit?: Unit) {
  return unit?.words.length ? Math.min(30, unit.words.length) : 30
}
