import { apiFetch, readApiJson } from './api'
import { mergeGrammarLessons, parseGrammarMarkdown } from './grammar'
import type { GrammarLesson, GrammarLessonProgress, GrammarProgressState } from './grammar-types'
import bundledLessonMd from '../content/grammar/L02_電気屋で.md?raw'

const PROGRESS_KEY = 'kotonoha-grammar-progress-v1'

function loadLocalProgress(): GrammarProgressState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as GrammarProgressState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveLocalProgress(state: GrammarProgressState) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function loadBundledGrammarLessons(): GrammarLesson[] {
  const lesson = parseGrammarMarkdown(bundledLessonMd, 'L02_電気屋で.md')
  return lesson ? [lesson] : []
}

export async function fetchGrammarBundle(): Promise<{ lessons: GrammarLesson[]; progress: GrammarProgressState }> {
  try {
    const response = await apiFetch('/api/grammar')
    const data = await readApiJson<{ lessons?: GrammarLesson[]; progress?: GrammarProgressState }>(response)
    if (!response.ok) throw new Error('GRAMMAR_FETCH_FAILED')
    const lessons = Array.isArray(data.lessons) ? data.lessons.filter((item) => item?.id && Array.isArray(item.parts)) : []
    const progress = data.progress && typeof data.progress === 'object' ? data.progress : {}
    if (lessons.length) {
      saveLocalProgress(progress)
      return { lessons, progress }
    }
  } catch {
    // fall through to local/bundled
  }
  const localProgress = loadLocalProgress()
  return {
    lessons: loadBundledGrammarLessons(),
    progress: localProgress,
  }
}

export async function uploadGrammarLesson(lesson: GrammarLesson, sourceMarkdown: string) {
  const response = await apiFetch(`/api/grammar/${encodeURIComponent(lesson.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lesson,
      sourceMarkdown,
      replaceProgress: false,
      sortOrder: lesson.lesson || 0,
    }),
  })
  const data = await readApiJson<{ lesson?: GrammarLesson; progress?: GrammarLessonProgress; error?: string }>(response)
  if (!response.ok || !data.lesson) {
    throw new Error(data.error || '语法课保存失败。')
  }
  return data
}

export async function syncGrammarProgress(lessonId: string, progress: GrammarLessonProgress) {
  saveLocalProgress({ ...loadLocalProgress(), [lessonId]: progress })
  try {
    const response = await apiFetch(`/api/grammar/${encodeURIComponent(lessonId)}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress }),
    })
    if (!response.ok) throw new Error('PROGRESS_SYNC_FAILED')
  } catch {
    // keep local cache; retry next change
  }
}

export function emptyPointProgress() {
  return { correct: 0, wrong: 0, wrongQuestionIds: [] as string[] }
}

export function markGrammarPointStudied(state: GrammarProgressState, lessonId: string, pointId: string): GrammarProgressState {
  const lesson = state[lessonId] || { points: {} }
  const point = lesson.points[pointId] || emptyPointProgress()
  return {
    ...state,
    [lessonId]: {
      points: {
        ...lesson.points,
        [pointId]: { ...point, studiedAt: Date.now() },
      },
    },
  }
}

export function recordGrammarAnswer(
  state: GrammarProgressState,
  lessonId: string,
  pointId: string,
  questionId: string,
  correct: boolean,
): GrammarProgressState {
  const lesson = state[lessonId] || { points: {} }
  const point = lesson.points[pointId] || emptyPointProgress()
  const wrongQuestionIds = correct
    ? point.wrongQuestionIds.filter((id) => id !== questionId)
    : Array.from(new Set([...point.wrongQuestionIds, questionId]))
  return {
    ...state,
    [lessonId]: {
      points: {
        ...lesson.points,
        [pointId]: {
          ...point,
          studiedAt: point.studiedAt || Date.now(),
          correct: point.correct + (correct ? 1 : 0),
          wrong: point.wrong + (correct ? 0 : 1),
          wrongQuestionIds,
        },
      },
    },
  }
}

export function lessonProgressSummary(lesson: GrammarLesson, progress?: GrammarLessonProgress) {
  const points = lesson.parts.flatMap((part) => part.points)
  const totalPoints = points.length
  const totalQuestions = points.reduce((sum, point) => sum + point.questions.length, 0)
  let studied = 0
  let correct = 0
  let wrong = 0
  const weakPointIds: string[] = []
  for (const point of points) {
    const row = progress?.points[point.id]
    if (row?.studiedAt || (row && (row.correct > 0 || row.wrong > 0))) studied += 1
    correct += row?.correct || 0
    wrong += row?.wrong || 0
    if ((row?.wrong || 0) > (row?.correct || 0)) weakPointIds.push(point.id)
  }
  const answered = correct + wrong
  return {
    totalPoints,
    studied,
    totalQuestions,
    answered,
    correct,
    wrong,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    weakPointIds,
  }
}

export { mergeGrammarLessons }
