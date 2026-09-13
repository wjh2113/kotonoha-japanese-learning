import bundledLessonMd from '../content/grammar/L02_電気屋で.md?raw'
import { countGrammarQuestions, flattenGrammarPoints, mergeGrammarLessons, parseGrammarMarkdown } from './grammar'
import type { GrammarLesson, GrammarLessonProgress, GrammarProgressState } from './grammar-types'

const UPLOAD_KEY = 'kotonoha-grammar-lessons-v1'
const PROGRESS_KEY = 'kotonoha-grammar-progress-v1'

export function loadBundledGrammarLessons(): GrammarLesson[] {
  const lesson = parseGrammarMarkdown(bundledLessonMd, 'L02_電気屋で.md')
  return lesson ? [lesson] : []
}

export function loadUploadedGrammarLessons(): GrammarLesson[] {
  try {
    const raw = localStorage.getItem(UPLOAD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GrammarLesson[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && Array.isArray(item.parts)) : []
  } catch {
    return []
  }
}

export function saveUploadedGrammarLessons(lessons: GrammarLesson[]) {
  try {
    localStorage.setItem(UPLOAD_KEY, JSON.stringify(lessons))
  } catch {
    // ignore quota
  }
}

export function loadAllGrammarLessons(): GrammarLesson[] {
  return mergeGrammarLessons(loadBundledGrammarLessons(), loadUploadedGrammarLessons())
}

export function loadGrammarProgress(): GrammarProgressState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as GrammarProgressState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveGrammarProgress(state: GrammarProgressState) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state))
  } catch {
    // ignore
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
  const points = flattenGrammarPoints(lesson)
  const totalPoints = points.length
  const totalQuestions = countGrammarQuestions(lesson)
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
