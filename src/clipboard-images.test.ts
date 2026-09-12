// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clipboardImageFiles, normalizeOcrText } from './clipboard-images'

describe('clipboardImageFiles', () => {
  it('reads images from clipboard.items when files is empty', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' })
    const clipboard = {
      files: [] as unknown as FileList,
      items: [{ type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer
    expect(clipboardImageFiles(clipboard)).toEqual([file])
  })

  it('prefers clipboard.files when present', () => {
    const file = new File([new Uint8Array([9])], 'shot.jpg', { type: 'image/jpeg' })
    const clipboard = {
      files: [file] as unknown as FileList,
      items: [],
    } as unknown as DataTransfer
    expect(clipboardImageFiles(clipboard)).toEqual([file])
  })
})

describe('normalizeOcrText', () => {
  it('treats literal empty markers as no text', () => {
    expect(normalizeOcrText('（空字符串）')).toBe('')
    expect(normalizeOcrText('EMPTY')).toBe('')
    expect(normalizeOcrText('无日语')).toBe('')
    expect(normalizeOcrText('昨日学校へ行きました。')).toBe('昨日学校へ行きました。')
  })
})
