export type Word = {
  id: string
  term: string
  reading: string
  meaning: string
  partOfSpeech: string
  example: string
  exampleReading: string
  translation: string
  mastered: boolean
  createdAt: number
}

export type Unit = {
  id: string
  name: string
  description: string
  color: string
  words: Word[]
}

export type View = 'study' | 'pronunciation' | 'test'

export type ImportDraft = {
  term: string
  reading?: string
  meaning?: string
}
