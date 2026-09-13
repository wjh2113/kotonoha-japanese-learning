/** Browser/TS facade — runtime source of truth is ../lexeme.mjs (shared with server/database). */
export type ImportLexeme = {
  term: string
  reading?: string
  meaning?: string
  partOfSpeech?: string
  romaji?: string
  example?: string
  translation?: string
  pronunciationNote?: string
  memoryTip?: string
  synonyms?: string
  similarWords?: string
}

// Bundler resolves .mjs; TypeScript cannot always attach ambient types to that specifier.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error shared ESM module used by Node server without a project reference
import * as lexeme from '../lexeme.mjs'

export const looksLikeVocabularyTerm = lexeme.looksLikeVocabularyTerm as (term?: string) => boolean
export const isChineseGloss = lexeme.isChineseGloss as (meaning?: string) => boolean
export const quizGloss = lexeme.quizGloss as (meaning?: string) => string
export const extractImportDrafts = lexeme.extractImportDrafts as (
  term?: string,
  reading?: string,
  meaning?: string,
  extras?: Omit<ImportLexeme, 'term' | 'reading' | 'meaning'>,
) => ImportLexeme[]
export const extractUploadedLexeme = lexeme.extractUploadedLexeme as (term?: string, reading?: string) => {
  term: string
  reading: string
  meaning?: string
  cleaned: boolean
}
export const normalizeImportDrafts = lexeme.normalizeImportDrafts as (
  drafts?: Array<{ term?: string; reading?: string; meaning?: string } & Omit<ImportLexeme, 'term' | 'reading' | 'meaning'>>,
) => ImportLexeme[]
