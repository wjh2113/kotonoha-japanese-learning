/** Collect image files from a paste/drop DataTransfer (Windows often fills items, not files). */
export function clipboardImageFiles(clipboard: DataTransfer | null | undefined): File[] {
  if (!clipboard) return []
  const fromFiles = Array.from(clipboard.files || []).filter((file) => file.type.startsWith('image/'))
  if (fromFiles.length) return fromFiles

  const fromItems: File[] = []
  const seen = new Set<string>()
  for (const item of Array.from(clipboard.items || [])) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const key = `${file.type}:${file.size}:${file.name}`
    if (seen.has(key)) continue
    seen.add(key)
    fromItems.push(file)
  }
  return fromItems
}

/** Vision models sometimes reply with a literal empty marker instead of "". */
export function normalizeOcrText(value: unknown) {
  const text = String(value || '').trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!text) return ''
  if (/^（?空字符串）?$/.test(text)) return ''
  if (/^(empty|none|n\/a|null|无日语|没有日语)$/i.test(text)) return ''
  return text
}
