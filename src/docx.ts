function cleanText(value: string | null | undefined) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/ +/g, ' ').trim()
}

export function docxHtmlToVocabularyText(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const lines: string[] = []
  const add = (value: string) => {
    const cleaned = cleanText(value)
    if (cleaned) lines.push(cleaned)
  }

  const readElement = (element: Element) => {
    const tag = element.tagName.toLowerCase()
    if (tag === 'table') {
      element.querySelectorAll('tr').forEach((row) => {
        const cells = Array.from(row.children)
          .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
          .map((cell) => {
            const paragraphs = Array.from(cell.querySelectorAll('p')).map((item) => cleanText(item.textContent)).filter(Boolean)
            return paragraphs.length ? paragraphs.join(' ') : cleanText(cell.textContent)
          })
        if (cells.some(Boolean)) add(cells.join('\t'))
      })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li').forEach((item) => add(item.textContent || ''))
      return
    }
    if (tag === 'p') {
      add(element.textContent || '')
      return
    }
    Array.from(element.children).forEach(readElement)
  }

  Array.from(document.body.children).forEach(readElement)
  return lines.join('\n')
}

export async function readVocabularyFile(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  if (extension === 'doc') throw new Error('暂不支持旧版 .doc，请在 Word 中“另存为” .docx 后再导入。')
  if (extension === 'docx') {
    if (file.size > 5 * 1024 * 1024) throw new Error('Word 文件请控制在 5MB 以内。')
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      { ignoreEmptyParagraphs: false },
    )
    const text = docxHtmlToVocabularyText(result.value)
    if (!text) throw new Error('Word 文件中没有识别到可导入的文字。')
    return text
  }
  if (!['txt', 'csv', 'json'].includes(extension)) throw new Error('支持 DOCX、TXT、CSV 和 JSON 文件。')
  if (file.size > 1024 * 1024) throw new Error('文本文件请控制在 1MB 以内。')
  return file.text()
}
