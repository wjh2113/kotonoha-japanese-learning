export type GrammarExample = {
  jp: string
  zh: string
}

export type GrammarQuestion = {
  id: string
  stem: string
  choices: string[]
  answer: string
  explain: string
}

export type GrammarBlock =
  | { type: 'section'; title: string; kind: 'formula' | 'rules' | 'notes' | 'other' }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'examples'; items: GrammarExample[] }
  | { type: 'notes'; items: string[] }

export type GrammarPoint = {
  id: string
  index: number
  title: string
  blocks: GrammarBlock[]
  questions: GrammarQuestion[]
}

export type GrammarPart = {
  id: string
  title: string
  points: GrammarPoint[]
}

export type GrammarLesson = {
  id: string
  course: string
  unit: number
  unitTitle: string
  lesson: number
  title: string
  summary: string
  parts: GrammarPart[]
  sourceName?: string
}

export type GrammarPointProgress = {
  studiedAt?: number
  correct: number
  wrong: number
  wrongQuestionIds: string[]
}

export type GrammarLessonProgress = {
  points: Record<string, GrammarPointProgress>
}

export type GrammarProgressState = Record<string, GrammarLessonProgress>
