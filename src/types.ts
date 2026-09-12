export type Word = {
  id: string
  term: string
  reading: string
  meaning: string
  partOfSpeech: string
  example: string
  exampleReading: string
  translation: string
  romaji?: string
  pronunciationNote?: string
  memoryTip?: string
  synonyms?: string
  similarWords?: string
  mastered: boolean
  createdAt: number
  starred?: boolean
  wrongBook?: boolean
  dictationMisses?: number
  errorReviewed?: boolean
  reviewStage?: number
  lastReviewedAt?: number
  nextReviewAt?: number
  listeningWrong?: number
  meaningWrong?: number
  listeningCorrect?: number
  meaningCorrect?: number
}

export type Unit = {
  id: string
  name: string
  description: string
  color: string
  words: Word[]
}

export type PassageBook = {
  id: string
  name: string
}

export type View = 'library' | 'study' | 'passage' | 'test' | 'dictation' | 'wordbook' | 'errorbook' | 'review' | 'settings'

export type VoiceGender = 'female' | 'male'

export type ThemeName = 'aka' | 'ai' | 'matcha'

export type AppSettings = {
  avatar: string
  voiceGender: VoiceGender
  theme?: ThemeName
}

export type ImportDraft = {
  term: string
  reading?: string
  meaning?: string
  partOfSpeech?: string
  romaji?: string
  example?: string
  pronunciationNote?: string
  memoryTip?: string
  synonyms?: string
  similarWords?: string
}

export type PassageToken = {
  surface: string
  reading: string
  meaning: string
}

export type PassageGrammar = {
  name: string
  pattern: string
  explanation: string
}

export type PassageSentence = {
  id: string
  text: string
  reading: string
  translation: string
  tokens: PassageToken[]
  grammar: PassageGrammar[]
}

export type SentenceProgress = {
  attempts: number
  lastScore: number
  bestScore: number
  dictation?: string
}

export type PassageStatus = 'ready' | 'processing' | 'error'

export type Passage = {
  id: string
  title: string
  sourceText: string
  sentences: PassageSentence[]
  createdAt: number
  bookId?: string
  bookName?: string
  progress?: Record<string, SentenceProgress>
  status?: PassageStatus
  statusText?: string
}
