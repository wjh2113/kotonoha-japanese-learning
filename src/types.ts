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
  starred?: boolean
  reviewStage?: number
  lastReviewedAt?: number
  nextReviewAt?: number
}

export type Unit = {
  id: string
  name: string
  description: string
  color: string
  words: Word[]
}

export type View = 'library' | 'study' | 'test' | 'wordbook' | 'review' | 'settings'

export type VoiceGender = 'female' | 'male'

export type AppSettings = {
  avatar: string
  voiceGender: VoiceGender
}

export type ImportDraft = {
  term: string
  reading?: string
  meaning?: string
}
