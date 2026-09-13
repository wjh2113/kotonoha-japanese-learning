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

export function htmlToPassageText(html: string) {
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
          .map((cell) => cleanText(cell.textContent))
          .filter(Boolean)
        if (!cells.length) return
        // 原文/翻译对照表保留 Tab，便于 parsePassageTable；普通排版表仍用空格拼成一句。
        const bilingual = cells.length >= 2 && (
          /^(原文|日文|日语|中文解释|中文|翻译|译文)$/i.test(cells[0])
          || /^(原文|日文|日语|中文解释|中文|翻译|译文)$/i.test(cells[1])
          || (/[\u3040-\u30ff]/.test(cells[0]) && !/[\u3040-\u30ff]/.test(cells[1]) && /[\u4e00-\u9fff]/.test(cells[1]))
        )
        add(cells.join(bilingual ? '\t' : ' '))
      })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li').forEach((item) => add(item.textContent || ''))
      return
    }
    if (/^h[1-6]$/.test(tag) || tag === 'p') {
      add(element.textContent || '')
      return
    }
    Array.from(element.children).forEach(readElement)
  }

  Array.from(document.body.children).forEach(readElement)
  if (lines.length) return lines.join('\n')
  return cleanText(document.body.textContent)
}

export async function extractDocxPassage(file: File) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Word 文件请控制在 8MB 以内。')
  const mammoth = (await import('mammoth')).default
  const images: Blob[] = []
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        if (images.length < 6 && image.contentType.startsWith('image/')) {
          const buffer = await image.readAsArrayBuffer()
          images.push(new Blob([buffer], { type: image.contentType || 'image/jpeg' }))
        }
        return { src: '' }
      }),
    },
  )
  return { text: htmlToPassageText(result.value), images }
}

export async function readPassageSource(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  if (['md', 'markdown'].includes(extension) || file.type === 'text/markdown' || file.type === 'text/x-markdown') {
    if (file.size > 1024 * 1024) throw new Error('Markdown 文件请控制在 1MB 以内。')
    return { text: await file.text(), images: [] as Blob[] }
  }
  throw new Error('课文只支持「课文整理」Markdown 模版（.md）。请先下载模版按格式填写。')
}

export async function readVocabularyFile(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  if (extension === 'xlsx' || extension === 'xls' || file.type.includes('spreadsheetml') || file.type.includes('excel')) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Excel 文件请控制在 8MB 以内。')
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) throw new Error('Excel 文件中没有工作表。')
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as Array<Array<string | number>>
    const text = rows
      .map((row) => row.map((cell) => String(cell ?? '').replace(/\r?\n/g, ' ').trim()).join('\t'))
      .filter((line) => line.replace(/\t/g, '').trim())
      .join('\n')
    if (!text.trim()) throw new Error('Excel 文件中没有识别到可导入的文字。')
    return text
  }
  throw new Error('单词只支持「词汇手册」Excel 模版（.xlsx）。请先下载模版按格式填写。')
}
