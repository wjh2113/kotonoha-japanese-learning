import { describe, expect, it } from 'vitest'
import { extractPassageVocab, unusedPassageVocab, isTransientPassage, listPassageBooks, mergeAnalyzedSentences, passageNeedsAnalysis, passageProgressSummary, recordSentenceScore, recoverInterruptedIngest } from './passage'
import type { Passage } from './types'

const passage: Passage = {
  id: 'p1',
  title: '第一课',
  sourceText: '学校で友達に会いました。',
  createdAt: 1,
  bookId: 'book-1',
  bookName: '大家的日语 第1册',
  sentences: [{
    id: 's1',
    text: '学校で友達に会いました。',
    reading: '',
    translation: '在学校遇见了朋友。',
    tokens: [
      { surface: '学校', reading: 'がっこう', meaning: '学校' },
      { surface: 'で', reading: 'で', meaning: '在' },
      { surface: '友達', reading: 'ともだち', meaning: '朋友' },
      { surface: 'に', reading: 'に', meaning: '向' },
      { surface: '会いました', reading: 'あいました', meaning: '遇见了' },
    ],
    grammar: [],
  }],
}

describe('extractPassageVocab', () => {
  it('turns content words into drafts and skips particles', () => {
    expect(extractPassageVocab(passage).map((item) => item.term)).toEqual(['学校', '友達', '会いました'])
  })

  it('skips terms already in the target unit', () => {
    expect(unusedPassageVocab(passage, ['学校']).map((item) => item.term)).toEqual(['友達', '会いました'])
  })
})

describe('passage progress and books', () => {
  it('records best score without lowering a previous high', () => {
    const first = recordSentenceScore({}, 's1', 60)
    const second = recordSentenceScore(first, 's1', 88)
    const third = recordSentenceScore(second, 's1', 70)
    expect(third.s1).toEqual({ attempts: 3, lastScore: 70, bestScore: 88 })
  })

  it('summarizes practiced sentences', () => {
    const next = { ...passage, progress: recordSentenceScore({}, 's1', 80) }
    expect(passageProgressSummary(next)).toEqual({ total: 1, practiced: 1, average: 80 })
  })

  it('lists unique textbooks from passage book fields', () => {
    expect(listPassageBooks([passage, { ...passage, id: 'p2' }])).toEqual([
      { id: 'book-1', name: '大家的日语 第1册' },
    ])
  })
})

describe('mergeAnalyzedSentences', () => {
  it('fills Chinese translations onto the original sentence ids', () => {
    const stub = {
      ...passage,
      sentences: [{ ...passage.sentences[0], translation: '', tokens: [] }],
    }
    const merged = mergeAnalyzedSentences(stub.sentences, [{
      text: '学校で友達に会いました。',
      translation: '在学校遇见了朋友。',
      tokens: [{ surface: '学校', reading: 'がっこう', meaning: '学校' }],
    }])
    expect(merged[0].id).toBe('s1')
    expect(merged[0].translation).toBe('在学校遇见了朋友。')
    expect(merged[0].tokens[0].surface).toBe('学校')
  })
})

describe('interrupted passage ingest', () => {
  it('does not treat OCR placeholders as analyzable sentences', () => {
    expect(isTransientPassage({
      status: 'processing',
      sourceText: '（正在识别课文…）',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })).toBe(true)
    expect(passageNeedsAnalysis({
      ...passage,
      status: 'processing',
      sourceText: '（正在识别课文…）',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })).toBe(false)
  })

  it('turns leftover OCR stubs into a retryable error instead of keeping them processing', () => {
    const recovered = recoverInterruptedIngest({
      ...passage,
      title: '<html><head><title>502 Bad Gateway</title></head></html>',
      sourceText: '（正在识别课文…）',
      status: 'processing',
      statusText: '<html>502 Bad Gateway</html>',
      sentences: [{ id: 's1', text: '（正在识别课文…）', reading: '', translation: '', tokens: [], grammar: [] }],
    })
    expect(recovered.title).toBe('课文')
    expect(recovered.sourceText).toBe('')
    expect(recovered.sentences).toEqual([])
    expect(recovered.status).toBe('error')
    expect(recovered.statusText).toContain('重新上传')
  })
})

describe('chinese instructional lines in OCR', () => {
  it('skips primarily Chinese notes from analysis queue', async () => {
    const { isPrimarilyChineseLine, sentenceNeedsAnalysis } = await import('./passage')
    expect(isPrimarilyChineseLine('能够向店员询问商品，并能请店员帮助寻找其他商品。')).toBe(true)
    expect(isPrimarilyChineseLine('てんいん')).toBe(false)
    expect(sentenceNeedsAnalysis({
      id: '1', text: '能够向店员询问商品，并能请店员帮助寻找其他商品。', reading: '', translation: '', tokens: [], grammar: [],
    })).toBe(false)
  })
})
