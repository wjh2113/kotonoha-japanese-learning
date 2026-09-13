import { useState } from 'react'
import {
  BookOpen, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Flame, Headphones, Leaf, Target, Zap,
} from 'lucide-react'
import type { AppSettings, Unit, View, Word } from './types'
import { getReviewState, REVIEW_INTERVAL_DAYS } from './utils'

type Props = {
  units: Unit[]
  unit: Unit | undefined
  settings: AppSettings
  onView: (view: View) => void
}

type DayMark = 'due' | 'done' | 'planned'

function sameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function calendarMarks(words: Word[], year: number, month: number, nowMs = Date.now()) {
  const marks = new Map<number, DayMark>()
  for (const word of words) {
    if (!Number.isFinite(word.nextReviewAt)) continue
    const d = new Date(Number(word.nextReviewAt))
    if (d.getFullYear() !== year || d.getMonth() !== month) continue
    const day = d.getDate()
    const state = getReviewState(word, nowMs)
    const kind: DayMark = state.due ? 'due' : word.mastered ? 'done' : 'planned'
    const prev = marks.get(day)
    if (!prev || (kind === 'due' && prev !== 'due') || (kind === 'done' && prev === 'planned')) marks.set(day, kind)
  }
  return marks
}

function wordsOnDay(words: Word[], year: number, month: number, day: number) {
  return words.filter((word) => {
    if (!Number.isFinite(word.nextReviewAt)) return false
    const d = new Date(Number(word.nextReviewAt))
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
  })
}

function reviewedToday(word: Word, now = new Date()) {
  if (!word.lastReviewedAt) return false
  return new Date(word.lastReviewedAt).toDateString() === now.toDateString()
}

export function HomeView({ units, unit, settings, onView }: Props) {
  const allWords = units.flatMap((item) => item.words)
  const unitWords = unit?.words || []
  const now = new Date()
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(now.getDate())

  // 待复习：全库口径；今日计划/已练：当前单元口径
  const dueCount = allWords.filter((word) => getReviewState(word).due).length
  const unmasteredUnit = unitWords.filter((word) => !word.mastered)
  const unitDue = unitWords.filter((word) => getReviewState(word).due).length
  const planTarget = unitWords.length === 0
    ? 0
    : Math.min(30, Math.max(unmasteredUnit.length, unitDue, 1))
  const todayDone = unitWords.filter((word) => reviewedToday(word, now)).length
  const completed = Math.min(planTarget || todayDone, todayDone)

  const learned = unitWords.filter((w) => w.mastered).length
  const total = unitWords.length
  const percent = Math.round(learned / Math.max(total, 1) * 100)
  const remaining = Math.max(0, total - learned)
  const streak = settings.streakDays || 0

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const marks = calendarMarks(allWords, year, month, now.getTime())
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const viewingTodayMonth = year === now.getFullYear() && month === now.getMonth()
  const selectedDate = new Date(year, month, Math.min(selectedDay, daysInMonth))
  const dayWords = wordsOnDay(allWords, year, month, selectedDate.getDate())
  const dayDue = dayWords.filter((word) => getReviewState(word, now.getTime()).due).length

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1)
    const nextDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    setCursor(next)
    setSelectedDay((day) => Math.min(day, nextDays))
  }

  const dueToday = dueCount
  const upcomingWeek = allWords.filter((w) => {
    const s = getReviewState(w)
    return !s.due && s.daysUntil !== null && s.daysUntil > 0 && s.daysUntil <= 7
  }).length
  const masteredCount = allWords.filter((w) => w.mastered).length
  const notScheduled = allWords.filter((w) => {
    if (w.mastered) return false
    const s = getReviewState(w)
    if (s.due) return false
    if (s.daysUntil !== null && s.daysUntil > 0 && s.daysUntil <= 7) return false
    return true
  }).length

  const unitIndex = Math.max(1, units.findIndex((item) => item.id === unit?.id) + 1)
  const unitTitle = unit ? `第${unitIndex}单元 ${unit.name}` : '未选择单元'
  const unitTheme = unit ? (unit.description || '继续巩固本单元') : '请先到词库创建单元'
  const selectedLabel = sameCalendarDay(selectedDate, now)
    ? '今天'
    : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div>
          <h1>欢迎回来，今日继续学习</h1>
          <p>每天一点点，日语会变得更简单</p>
        </div>
        <div className="home-hero-deco" aria-hidden>
          <svg viewBox="0 0 220 120" className="home-torii" fill="none">
            <circle cx="168" cy="32" r="22" fill="currentColor" opacity=".16" />
            <circle cx="168" cy="32" r="12" fill="currentColor" opacity=".08" />
            <path d="M42 48 H178" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".28" />
            <path d="M36 40 H184" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".22" />
            <path d="M58 48 V92 M162 48 V92" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".26" />
            <path d="M50 58 H170" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity=".2" />
            <path d="M18 102 C48 82 72 92 96 78 C118 66 140 84 178 70 C192 64 204 68 214 62" stroke="currentColor" strokeWidth="2.2" opacity=".18" />
            <path d="M28 108 C55 90 78 98 102 86" stroke="currentColor" strokeWidth="1.6" opacity=".12" />
          </svg>
        </div>
      </section>

      <div className="home-stats">
        <article>
          <span className="home-stat-icon plan"><Target size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{planTarget} <i>词</i></strong>
            <b>今日计划</b>
            <em>当前单元待学</em>
          </div>
        </article>
        <article>
          <span className="home-stat-icon done"><CheckCircle2 size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{completed} <i>词</i></strong>
            <b>今日已练</b>
            <em>本单元今日复习过</em>
          </div>
        </article>
        <article className="review-stat">
          <span className="home-stat-icon review"><CalendarDays size={18} strokeWidth={1.6} /></span>
          <div>
            <strong>{dueCount} <i>词</i></strong>
            <b>待复习</b>
            <em>全库已到期</em>
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
              <svg viewBox="0 0 160 120" className="continue-scene" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dce8c8" />
                    <stop offset="55%" stopColor="#b7c99a" />
                    <stop offset="100%" stopColor="#8fa676" />
                  </linearGradient>
                  <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d9cbb0" />
                    <stop offset="100%" stopColor="#c2b08e" />
                  </linearGradient>
                </defs>
                <rect width="160" height="120" fill="url(#sky)" />
                <circle cx="128" cy="28" r="14" fill="#f0e2b8" opacity=".7" />
                <path d="M0 78 C30 62 50 70 72 58 C94 46 112 56 160 48 L160 120 L0 120 Z" fill="#7d9160" opacity=".35" />
                <rect x="18" y="48" width="28" height="42" rx="2" fill="#efe6d2" />
                <rect x="22" y="54" width="8" height="10" rx="1" fill="#9aaf7a" opacity=".7" />
                <rect x="34" y="54" width="8" height="10" rx="1" fill="#9aaf7a" opacity=".55" />
                <rect x="52" y="40" width="34" height="50" rx="2" fill="#e8dcc4" />
                <rect x="58" y="46" width="10" height="12" rx="1" fill="#6f8458" opacity=".45" />
                <rect x="72" y="46" width="10" height="12" rx="1" fill="#6f8458" opacity=".35" />
                <path d="M48 40 H90 L86 34 H52 Z" fill="#c4a574" />
                <rect x="102" y="52" width="26" height="38" rx="2" fill="#dde6cb" />
                <rect x="108" y="58" width="7" height="9" rx="1" fill="#5f7350" opacity=".4" />
                <rect x="118" y="58" width="7" height="9" rx="1" fill="#5f7350" opacity=".3" />
                <path d="M0 88 H160 V120 H0 Z" fill="url(#road)" />
                <path d="M0 88 H160" stroke="#b7a888" strokeWidth="1.5" opacity=".5" />
                <path d="M78 88 V120" stroke="#efe6d2" strokeWidth="3" strokeDasharray="6 5" opacity=".55" />
                <path d="M132 70 H148 M135 70 V88 M145 70 V88 M130 66 H150" stroke="#687a45" strokeWidth="2" strokeLinecap="round" opacity=".45" />
              </svg>
            </div>
            <div className="continue-copy">
              <em>{unitTitle}</em>
              <p>{unitTheme}</p>
              <div className="continue-bar-row">
                <div className="continue-bar"><i style={{ width: `${percent}%` }} /></div>
                <b>{percent}%</b>
              </div>
              <small>本单元已学 {learned} / {total} 词 · 预计还需 {remaining} 词</small>
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
              <div className="home-cal-head">
                <button type="button" className="home-cal-nav" onClick={() => shiftMonth(-1)} aria-label="上个月">
                  <ChevronLeft size={16} strokeWidth={1.8} />
                </button>
                <b>{year}年{month + 1}月</b>
                <button type="button" className="home-cal-nav" onClick={() => shiftMonth(1)} aria-label="下个月">
                  <ChevronRight size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className="home-cal-week">{['日', '一', '二', '三', '四', '五', '六'].map((d) => <span key={d}>{d}</span>)}</div>
              <div className="home-cal-grid" role="grid" aria-label="复习日历">
                {cells.map((day, i) => {
                  if (!day) return <span key={i} className="empty" />
                  const isToday = viewingTodayMonth && day === now.getDate()
                  const isSelected = day === selectedDate.getDate()
                  return (
                    <button
                      key={i}
                      type="button"
                      role="gridcell"
                      aria-pressed={isSelected}
                      aria-label={`${month + 1}月${day}日${marks.get(day) ? `，有复习安排` : ''}`}
                      className={`day mark-${marks.get(day) || 'none'}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
                      onClick={() => setSelectedDay(day)}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>
            <ul className="home-cal-legend">
              <li><i className="due" /><span>已到期</span><b>{dueToday}</b></li>
              <li><i className="done" /><span>已掌握</span><b>{masteredCount}</b></li>
              <li><i className="planned" /><span>7天内</span><b>{upcomingWeek}</b></li>
              <li><i className="none" /><span>未排期</span><b>{notScheduled}</b></li>
            </ul>
          </div>
          <div className="home-cal-day">
            <header>
              <b>{selectedLabel}安排</b>
              <small>{dayWords.length ? `${dayWords.length} 词` : '暂无排期'}{dayDue > 0 ? ` · ${dayDue} 词已到期` : ''}</small>
            </header>
            {dayWords.length ? (
              <ul>
                {dayWords.slice(0, 4).map((word) => {
                  const state = getReviewState(word, now.getTime())
                  return (
                    <li key={word.id}>
                      <span className="jp">{word.term}</span>
                      <em>{state.due ? '已到期' : word.mastered ? '已掌握' : '待复习'}</em>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p>这一天还没有安排复习，点其他日期或去学习后会自动排期。</p>
            )}
            {dayWords.length > 4 && <small className="home-cal-more">还有 {dayWords.length - 4} 词…</small>}
            {(dayDue > 0 || sameCalendarDay(selectedDate, now)) && (
              <button type="button" className="home-cal-go" onClick={() => onView('review')}>
                去复习 <ChevronRight size={14} />
              </button>
            )}
          </div>
          <p className="home-srs-tip"><Leaf size={14} strokeWidth={1.6} />复习是记忆的最佳方式 · 坚持 SRS（{REVIEW_INTERVAL_DAYS.join('/')} 天），让记忆更牢固！</p>
        </section>
      </div>

      <section className="home-card home-shortcuts">
        <h2>快捷入口</h2>
        <div className="home-shortcut-grid">
          <button type="button" onClick={() => onView('study')}><Zap size={18} /><span>单词学习</span><small>背单词 · 记词义 · 练发音</small></button>
          <button type="button" onClick={() => onView('library')}><BookOpen size={18} /><span>词库</span><small>管理单元 · 导入手册</small></button>
          <button type="button" onClick={() => onView('passage')}><FileText size={18} /><span>课文学习</span><small>精读课文 · 语法解析 · 例句</small></button>
          <button type="button" onClick={() => onView('test')}><Target size={18} /><span>测试</span><small>巩固知识 · 检验成果</small></button>
          <button type="button" onClick={() => onView('dictation')}><Headphones size={18} /><span>听写</span><small>听音写词 · 提升听力</small></button>
        </div>
      </section>
    </div>
  )
}
