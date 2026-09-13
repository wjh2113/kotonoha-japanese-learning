import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, GraduationCap,
  UploadCloud, Volume2, X,
} from 'lucide-react'
import { flattenGrammarPoints, parseGrammarMarkdown } from './grammar'
import {
  fetchGrammarBundle, lessonProgressSummary, markGrammarPointStudied, recordGrammarAnswer,
  syncGrammarProgress, uploadGrammarLesson,
} from './grammar-store'
import type { GrammarBlock, GrammarLesson, GrammarPoint, GrammarProgressState, GrammarQuestion } from './grammar-types'
import { SettingsContext } from './settings-context'
import { speakJapanese } from './speech'

type Screen =
  | { name: 'hub' }
  | { name: 'lesson'; lessonId: string }
  | { name: 'point'; lessonId: string; pointId: string }
  | { name: 'quiz'; lessonId: string; pointId?: string; wrongOnly?: boolean }

function findLesson(lessons: GrammarLesson[], id: string) {
  return lessons.find((item) => item.id === id) || null
}

function findPoint(lesson: GrammarLesson, pointId: string) {
  return flattenGrammarPoints(lesson).find((item) => item.id === pointId) || null
}

function pointStatus(progress: GrammarProgressState, lessonId: string, pointId: string) {
  const row = progress[lessonId]?.points[pointId]
  if (!row) return '未学' as const
  if ((row.wrong || 0) > (row.correct || 0)) return '需复习' as const
  if (row.studiedAt || row.correct > 0 || row.wrong > 0) return '已学' as const
  return '未学' as const
}

function BlockView({ block }: { block: GrammarBlock }) {
  const { voiceGender } = useContext(SettingsContext)
  if (block.type === 'section') {
    return <h3 className={`grammar-section-title kind-${block.kind}`}>{block.title}</h3>
  }
  if (block.type === 'paragraph') {
    return <p className="grammar-paragraph">{block.text}</p>
  }
  if (block.type === 'list') {
    return (
      <ul className="grammar-list">
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    )
  }
  if (block.type === 'notes') {
    return (
      <div className="grammar-notes">
        <b>注意</b>
        <ul>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
    )
  }
  if (block.type === 'examples') {
    return (
      <div className="grammar-examples">
        {block.items.map((item) => (
          <button
            key={`${item.jp}-${item.zh}`}
            type="button"
            className="grammar-example"
            onClick={() => void speakJapanese(item.jp, voiceGender, { sentence: true })}
          >
            <span className="jp">{item.jp}</span>
            <small>{item.zh}</small>
            <Volume2 size={15} strokeWidth={1.7} aria-hidden />
          </button>
        ))}
      </div>
    )
  }
  if (block.type === 'table') {
    return (
      <div className="grammar-table-wrap">
        <table className="grammar-table">
          <thead>
            <tr>{block.headers.map((cell) => <th key={cell}>{cell}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}

function QuizSession({
  lesson,
  questions,
  title,
  onAnswer,
  onExit,
}: {
  lesson: GrammarLesson
  questions: Array<{ point: GrammarPoint; question: GrammarQuestion }>
  title: string
  onAnswer: (pointId: string, questionId: string, correct: boolean) => void
  onExit: () => void
}) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})
  const current = questions[index]

  useEffect(() => {
    setPicked(null)
  }, [index])

  if (!questions.length) {
    return (
      <div className="page grammar-page">
        <button type="button" className="back-link" onClick={onExit}><ChevronLeft size={17} />返回</button>
        <div className="wide-empty"><ClipboardList /><h2>暂无题目</h2><p>这一范围还没有测验题。</p></div>
      </div>
    )
  }

  if (finished) {
    const correct = questions.filter(({ question }) => results[question.id] === question.answer).length
    return (
      <div className="page grammar-page">
        <div className="result-card grammar-result">
          <span className="result-icon"><GraduationCap size={28} strokeWidth={1.6} /></span>
          <h1>{correct >= questions.length * 0.8 ? 'よくできました！' : 'もう一度、確認しよう。'}</h1>
          <p>{title}已完成 <b>{questions.length}</b> 题，答对 {correct} 题。</p>
          <div className="result-score">{questions.length ? Math.round((correct / questions.length) * 100) : 0}<small>分</small></div>
          <div className="result-actions">
            <button type="button" onClick={onExit}>返回课次</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setIndex(0)
                setPicked(null)
                setResults({})
                setFinished(false)
              }}
            >
              再测一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  const letters = ['A', 'B', 'C', 'D']
  const selected = picked
  const answered = Boolean(selected)
  const correctLetter = current.question.answer

  return (
    <div className="page grammar-page quiz-session grammar-quiz">
      <header className="quiz-session-top">
        <button type="button" className="quiz-exit" onClick={onExit}><X size={15} />退出</button>
        <div className="quiz-session-progress">
          <ClipboardList size={15} />
          <b>{index + 1} / {questions.length}</b>
          <i className="quiz-progress-mini">
            <em style={{ width: `${((index + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
          </i>
        </div>
        <span className="grammar-quiz-lesson">{lesson.title}</span>
      </header>
      <p className="quiz-prompt"><GraduationCap size={16} />{title}</p>
      <section className="quiz-card quiz-card-design">
        <div className="grammar-quiz-stem">
          <small>{current.point.title}</small>
          <h2>{current.question.stem}</h2>
        </div>
        <div className="quiz-options quiz-options-design">
          {current.question.choices.map((choice, i) => {
            const letter = letters[i]
            const isSelected = selected === letter
            const showCorrect = answered && letter === correctLetter
            const wrong = answered && isSelected && letter !== correctLetter
            return (
              <button
                key={`${current.question.id}-${letter}`}
                type="button"
                className={`${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${wrong ? 'wrong' : ''}`}
                onClick={() => {
                  if (selected) return
                  setPicked(letter)
                  const ok = letter === correctLetter
                  setResults((prev) => ({ ...prev, [current.question.id]: letter }))
                  onAnswer(current.point.id, current.question.id, ok)
                }}
              >
                <em>{letter}</em>
                <span>{choice}</span>
                {showCorrect && <CheckCircle2 size={20} strokeWidth={1.7} />}
                {wrong && <X size={18} strokeWidth={1.8} />}
              </button>
            )
          })}
        </div>
        {answered && (
          <div className={`answer-feedback ${selected === correctLetter ? 'correct' : 'wrong'}`}>
            <b>{selected === correctLetter ? '回答正确' : '再记一次'}</b>
            <small>{current.question.explain || `正确答案：${correctLetter}`}</small>
          </div>
        )}
        <button
          type="button"
          className="primary-button quiz-next"
          disabled={!answered}
          onClick={() => {
            if (index >= questions.length - 1) setFinished(true)
            else setIndex((value) => value + 1)
          }}
        >
          {index >= questions.length - 1 ? '查看结果' : '下一题'}
          <ChevronRight size={18} />
        </button>
      </section>
    </div>
  )
}

export function GrammarView({ practiceOnly = false }: { practiceOnly?: boolean }) {
  const [lessons, setLessons] = useState<GrammarLesson[]>([])
  const [progress, setProgress] = useState<GrammarProgressState>({})
  const [screen, setScreen] = useState<Screen>({ name: 'hub' })
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const progressRef = useRef(progress)
  progressRef.current = progress

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const bundle = await fetchGrammarBundle()
      if (cancelled) return
      setLessons(bundle.lessons)
      setProgress(bundle.progress)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => {
      const state = progressRef.current
      for (const [lessonId, row] of Object.entries(state)) {
        void syncGrammarProgress(lessonId, row)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [progress, loading])

  const activeLesson = screen.name === 'hub' ? null : findLesson(lessons, screen.lessonId)
  const activePoint = screen.name === 'point' && activeLesson
    ? findPoint(activeLesson, screen.pointId)
    : null

  const quizPack = useMemo(() => {
    if (screen.name !== 'quiz' || !activeLesson) return null
    const points = flattenGrammarPoints(activeLesson)
    const scoped = screen.pointId
      ? points.filter((point) => point.id === screen.pointId)
      : points
    const rows = scoped.flatMap((point) => point.questions.map((question) => ({ point, question })))
    if (!screen.wrongOnly) return rows
    const wrongIds = new Set(
      Object.values(progress[activeLesson.id]?.points || {})
        .flatMap((row) => row.wrongQuestionIds || []),
    )
    return rows.filter((row) => wrongIds.has(row.question.id))
  }, [screen, activeLesson, progress])

  const onUpload = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      const lesson = parseGrammarMarkdown(text, file.name)
      if (!lesson) {
        setNotice('无法解析该语法文件，请确认是带测验的 Markdown 课包。')
        return
      }
      const saved = await uploadGrammarLesson(lesson, text)
      const bundle = await fetchGrammarBundle()
      setLessons(bundle.lessons)
      setProgress(bundle.progress)
      setNotice(`已保存到数据库：${saved.lesson?.title || lesson.title}（${flattenGrammarPoints(lesson).length} 个语法点）`)
      setScreen({ name: 'lesson', lessonId: lesson.id })
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '上传失败。')
    }
  }

  if (loading) {
    return <div className="page grammar-page"><div className="wide-empty compact"><b>加载语法课…</b></div></div>
  }

  if (screen.name === 'quiz' && activeLesson && quizPack) {
    return (
      <QuizSession
        lesson={activeLesson}
        questions={quizPack}
        title={screen.pointId ? '语法点测验' : screen.wrongOnly ? '错题回看' : '本课综合测验'}
        onExit={() => setScreen({ name: 'lesson', lessonId: activeLesson.id })}
        onAnswer={(pointId, questionId, correct) => {
          setProgress((prev) => recordGrammarAnswer(prev, activeLesson.id, pointId, questionId, correct))
        }}
      />
    )
  }

  if (screen.name === 'point' && activeLesson && activePoint) {
    return (
      <div className="page grammar-page">
        <button type="button" className="back-link" onClick={() => setScreen({ name: 'lesson', lessonId: activeLesson.id })}>
          <ChevronLeft size={17} />返回课次
        </button>
        <header className="grammar-point-hero">
          <em>{String(activePoint.index).padStart(2, '0')}</em>
          <div>
            <h1>{activePoint.title}</h1>
            <p>{activeLesson.title} · {activePoint.questions.length} 道测验</p>
          </div>
        </header>
        <article className="grammar-point-card">
          {activePoint.blocks.map((block, index) => (
            <BlockView key={`${activePoint.id}-${index}`} block={block} />
          ))}
        </article>
        <div className="grammar-point-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setProgress((prev) => markGrammarPointStudied(prev, activeLesson.id, activePoint.id))
              const points = flattenGrammarPoints(activeLesson)
              const next = points.find((item) => item.index === activePoint.index + 1)
              if (next) setScreen({ name: 'point', lessonId: activeLesson.id, pointId: next.id })
              else setScreen({ name: 'lesson', lessonId: activeLesson.id })
            }}
          >
            标记已学{flattenGrammarPoints(activeLesson).some((item) => item.index === activePoint.index + 1) ? '并下一语法点' : '并返回'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!activePoint.questions.length}
            onClick={() => {
              setProgress((prev) => markGrammarPointStudied(prev, activeLesson.id, activePoint.id))
              setScreen({ name: 'quiz', lessonId: activeLesson.id, pointId: activePoint.id })
            }}
          >
            开始本点测验（{activePoint.questions.length}）
          </button>
        </div>
      </div>
    )
  }

  if (screen.name === 'lesson' && activeLesson) {
    const summary = lessonProgressSummary(activeLesson, progress[activeLesson.id])
    const points = flattenGrammarPoints(activeLesson)
    const firstPoint = points[0]
    return (
      <div className="page grammar-page">
        <button type="button" className="back-link" onClick={() => setScreen({ name: 'hub' })}>
          <ChevronLeft size={17} />语法目录
        </button>
        <section className="grammar-lesson-hero">
          <span className="eyebrow">{activeLesson.course}</span>
          <h1>{activeLesson.title}</h1>
          <p>
            单元{activeLesson.unit}{activeLesson.unitTitle ? `「${activeLesson.unitTitle}」` : ''}
            · {summary.totalPoints} 语法点 · {summary.totalQuestions} 题
          </p>
          {activeLesson.summary && <p className="grammar-summary">{activeLesson.summary}</p>}
          <div className="grammar-lesson-progress">
            <span>已学 {summary.studied}/{summary.totalPoints}</span>
            <i><em style={{ width: `${(summary.studied / Math.max(summary.totalPoints, 1)) * 100}%` }} /></i>
            <span>正确率 {summary.accuracy}%</span>
          </div>
        </section>

        {activeLesson.parts.map((part) => (
          <section key={part.id} className="grammar-part">
            <header><b>{part.title}</b><small>{part.points.length} 点</small></header>
            <div className="grammar-point-list">
              {part.points.map((point) => {
                const status = pointStatus(progress, activeLesson.id, point.id)
                const row = progress[activeLesson.id]?.points[point.id]
                const answered = (row?.correct || 0) + (row?.wrong || 0)
                return (
                  <button
                    key={point.id}
                    type="button"
                    className={`grammar-point-row status-${status}`}
                    onClick={() => setScreen({ name: 'point', lessonId: activeLesson.id, pointId: point.id })}
                  >
                    <em>{point.index}</em>
                    <div>
                      <b>{point.title}</b>
                      <small>{point.questions.length} 题 · {status}{answered ? ` · 练过 ${answered}` : ''}</small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        <div className="grammar-lesson-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!firstPoint}
            onClick={() => firstPoint && setScreen({ name: 'point', lessonId: activeLesson.id, pointId: firstPoint.id })}
          >
            按顺序学习
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setScreen({ name: 'quiz', lessonId: activeLesson.id })}
          >
            本课综合测验（{summary.totalQuestions}）
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!summary.wrong}
            onClick={() => setScreen({ name: 'quiz', lessonId: activeLesson.id, wrongOnly: true })}
          >
            错题回看
          </button>
        </div>
      </div>
    )
  }

  const grouped = lessons.reduce<Record<string, GrammarLesson[]>>((acc, lesson) => {
    const key = `${lesson.course} · 单元${lesson.unit}${lesson.unitTitle ? ` ${lesson.unitTitle}` : ''}`
    acc[key] = acc[key] || []
    acc[key].push(lesson)
    return acc
  }, {})

  return (
    <div className="page grammar-page hub-page">
      <section className="hub-hero">
        <div>
          <span className="eyebrow">GRAMMAR</span>
          <h1>语法学习</h1>
          <p>按课学习语法点、看例句，再用上传讲义里的题库自测。内容保存在数据库，不使用 AI 生成。</p>
        </div>
        {!practiceOnly && (
          <label className="primary-button grammar-upload">
            <UploadCloud size={17} />
            上传语法 Markdown
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                event.target.value = ''
                void onUpload(file)
              }}
            />
          </label>
        )}
      </section>
      {notice && <p className="grammar-notice">{notice}</p>}
      {lessons.length ? (
        Object.entries(grouped).map(([group, items]) => (
          <section key={group} className="grammar-group">
            <header><BookOpen size={16} /><b>{group}</b></header>
            <div className="grammar-lesson-cards">
              {items.map((lesson) => {
                const summary = lessonProgressSummary(lesson, progress[lesson.id])
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    className="grammar-lesson-card"
                    onClick={() => setScreen({ name: 'lesson', lessonId: lesson.id })}
                  >
                    <div>
                      <em>第{lesson.lesson || '?'}课</em>
                      <b>{lesson.title}</b>
                      <small>{summary.totalPoints} 语法点 · {summary.totalQuestions} 题</small>
                    </div>
                    <div className="grammar-lesson-card-meta">
                      <span>已学 {summary.studied}/{summary.totalPoints}</span>
                      <i><em style={{ width: `${(summary.studied / Math.max(summary.totalPoints, 1)) * 100}%` }} /></i>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))
      ) : (
        <div className="wide-empty">
          <ClipboardList />
          <h2>还没有语法课</h2>
          <p>{practiceOnly ? '请先在电脑端上传语法 Markdown。' : '上传讲义 Markdown 后即可学习与测验。'}</p>
        </div>
      )}
    </div>
  )
}
