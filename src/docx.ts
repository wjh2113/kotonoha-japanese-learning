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

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

function isJunkZipPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const name = basename(normalized)
  if (!name || normalized.endsWith('/')) return true
  if (normalized.startsWith('__MACOSX/') || normalized.includes('/__MACOSX/')) return true
  if (name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db') return true
  return false
}

function decodeZipText(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function looksLikeVocabTable(text: string) {
  return /(^|\n)\s*\|?\s*序号\s*\|/.test(text)
    || /(^|\n)序号\t单词\t假名/.test(text)
    || /(^|\n)单词\t假名\t词性\t中文释义/.test(text)
    || /【单词】|【词汇】/.test(text)
}

function looksLikeGrammarPack(text: string) {
  return /【语法课】/.test(text)
    || /^##\s*第\s*\d+\s*部分/m.test(text)
    || /^##\s*[①②③④⑤⑥⑦⑧⑨⑩]/m.test(text)
}

function classifyLessonEntry(path: string, text: string): 'passage' | 'vocab' | 'grammar' | 'unknown' {
  const name = basename(path)
  if (/单词|词汇|vocab|words?/i.test(name)) return 'vocab'
  if (/语法|grammar/i.test(name)) return 'grammar'
  if (/课文|会话|passage|课时|handbook/i.test(name)) return 'passage'
  if (/【课文整理】/.test(text) || (/\|\s*原文\s*\|/.test(text) && /\|\s*中文解释\s*\|/.test(text))) return 'passage'
  if (looksLikeVocabTable(text)) return 'vocab'
  if (looksLikeGrammarPack(text)) return 'grammar'
  return 'unknown'
}

async function workbookBytesToVocabularyText(bytes: Uint8Array, filename: string) {
  const file = new File([bytes], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return readVocabularyFile(file)
}

async function readLessonZip(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('ZIP 请控制在 20MB 以内。')
  const { unzipSync } = await import('fflate')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  let passageMarkdown = ''
  let vocabMarkdown = ''
  let grammarMarkdown = ''
  const leftovers: string[] = []

  for (const [path, data] of Object.entries(entries)) {
    if (isJunkZipPath(path) || !data?.length) continue
    const name = basename(path)
    const lower = name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const text = await workbookBytesToVocabularyText(data, name)
      vocabMarkdown = vocabMarkdown ? `${vocabMarkdown}\n${text}` : text
      continue
    }
    if (!(lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt'))) {
      leftovers.push(name)
      continue
    }
    const text = decodeZipText(data).replace(/^\uFEFF/, '').trim()
    if (!text) continue
    const kind = classifyLessonEntry(path, text)
    if (kind === 'passage') {
      // 一份综合手册优先：本身已含单词/语法时整份保留
      if (/【单词】|【词汇】|【语法课】/.test(text) || (!passageMarkdown && /原文/.test(text))) {
        passageMarkdown = passageMarkdown || text
      } else {
        passageMarkdown = passageMarkdown ? `${passageMarkdown}\n\n${text}` : text
      }
    } else if (kind === 'vocab') {
      vocabMarkdown = vocabMarkdown ? `${vocabMarkdown}\n${text}` : text
    } else if (kind === 'grammar') {
      grammarMarkdown = grammarMarkdown ? `${grammarMarkdown}\n\n${text}` : text
    } else {
      leftovers.push(name)
    }
  }

  if (!passageMarkdown) {
    throw new Error('ZIP 里没有识别到课文 Markdown（需含「原文 / 假名注音 / 中文解释」表，或文件名含「课文」）。')
  }

  const { assembleLessonHandbook } = await import('./passage')
  const text = assembleLessonHandbook({ passageMarkdown, vocabMarkdown, grammarMarkdown })
  if (!text) throw new Error('ZIP 内容无法拼成课时手册。')
  return {
    text,
    images: [] as Blob[],
    packNote: leftovers.length
      ? `已忽略 ${leftovers.length} 个非导入文件（${leftovers.slice(0, 3).join('、')}${leftovers.length > 3 ? '…' : ''}）。`
      : '',
  }
}

export async function readPassageSource(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  if (extension === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    return readLessonZip(file)
  }
  if (['md', 'markdown'].includes(extension) || file.type === 'text/markdown' || file.type === 'text/x-markdown') {
    if (file.size > 1024 * 1024) throw new Error('Markdown 文件请控制在 1MB 以内。')
    return { text: await file.text(), images: [] as Blob[], packNote: '' }
  }
  throw new Error('请上传课时手册 .md，或包含课文 / 单词 / 语法的 .zip（信息勿拆丢）。')
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
