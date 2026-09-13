/** Server-side grammar markdown parser. Keep in sync with src/grammar.ts */

// src/grammar.ts
var POINT_HEADING = /^##\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|[0-9]+)[.\s、．]*\s*(.+?)\s*$/;
var PART_HEADING = /^##\s*第\s*([0-9１２３４５６７８９０]+)\s*部分/;
var SECTION_BOLD = /^\*\*(.+?)\*\*\s*$/;
var QUESTION_HEAD = /^\*\*Q([0-9]+)\.\*\*\s*(.+)$/;
var CHOICE_LINE = /^-\s*([A-D])\.\s*(.+)$/;
var EXAMPLE_LINE = /^-\s*(.+?)\s*(?:——|—|--)\s*(.+)\s*$/;
var TABLE_ROW = /^\|(.+)\|\s*$/;
var CIRCLED = {
  "\u2460": 1,
  "\u2461": 2,
  "\u2462": 3,
  "\u2463": 4,
  "\u2464": 5,
  "\u2465": 6,
  "\u2466": 7,
  "\u2467": 8,
  "\u2468": 9,
  "\u2469": 10,
  "\u246A": 11,
  "\u246B": 12
};
function slugify(value) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "lesson";
}
function stripHtml(text) {
  return text.replace(/<br\s*\/?>/gi, " / ").replace(/<[^>]+>/g, "").trim();
}
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1);
    }
    meta[key] = value.replace(/^["']|["']$/g, "");
  }
  return { meta, body: raw.slice(match[0].length) };
}
function parseTable(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    const cells = lines[i].replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => stripHtml(cell.trim()));
    if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells);
    i += 1;
  }
  if (rows.length < 2) return null;
  return { table: { headers: rows[0], rows: rows.slice(1) }, next: i };
}
function sectionKind(title) {
  if (/句型|公式|接续|分类|数量词表/.test(title)) return "formula";
  if (/注意/.test(title)) return "notes";
  if (/规则|变形|含义|读音|促音|浊音|回 vs|要点/.test(title)) return "rules";
  return "other";
}
function parseAnswerMap(block) {
  const map = /* @__PURE__ */ new Map();
  for (const line of block.split(/\r?\n/)) {
    if (!TABLE_ROW.test(line) || /题号/.test(line) || /---/.test(line)) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const q = cells[0].replace(/^Q/i, "");
    const answer = cells[1].trim().toUpperCase();
    const explain = cells[2].trim();
    if (!/^\d+$/.test(q) || !/^[A-D]$/.test(answer)) continue;
    map.set(q, { answer, explain });
  }
  return map;
}
function parseQuiz(section, pointId) {
  const answers = parseAnswerMap(section);
  const lines = section.split(/\r?\n/);
  const questions = [];
  let i = 0;
  while (i < lines.length) {
    const head = lines[i].match(QUESTION_HEAD);
    if (!head) {
      i += 1;
      continue;
    }
    const num = head[1];
    const stem = head[2].trim();
    const choices = [];
    i += 1;
    while (i < lines.length && !lines[i].trim()) i += 1;
    while (i < lines.length) {
      const choice = lines[i].match(CHOICE_LINE);
      if (!choice) break;
      choices.push(choice[2].trim());
      i += 1;
    }
    const meta = answers.get(num) || { answer: "A", explain: "" };
    if (choices.length >= 2) {
      questions.push({
        id: `${pointId}-q${num}`,
        stem,
        choices,
        answer: meta.answer,
        explain: meta.explain
      });
    }
  }
  return questions;
}
function parseExamples(lines) {
  const items = [];
  for (const line of lines) {
    const match = line.match(EXAMPLE_LINE);
    if (!match) continue;
    items.push({ jp: match[1].trim(), zh: match[2].trim() });
  }
  return items;
}
function parsePointBody(body, pointId) {
  const quizSplit = body.split(/^###\s*测验/m);
  const main = quizSplit[0] || "";
  const quizPart = quizSplit.slice(1).join("\n");
  const questions = quizPart ? parseQuiz(quizPart, pointId) : [];
  const lines = main.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let currentSection = "";
  const pushParagraph = (text) => {
    const value = text.trim();
    if (!value || value === "---") return;
    blocks.push({ type: "paragraph", text: value });
  };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const section = trimmed.match(SECTION_BOLD);
    if (section) {
      const title = section[1].replace(/^⚠️\s*/, "").trim();
      currentSection = title;
      blocks.push({ type: "section", title, kind: sectionKind(title) });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(trimmed)) {
      const parsed = parseTable(lines, i);
      if (parsed) {
        blocks.push({ type: "table", headers: parsed.table.headers, rows: parsed.table.rows });
        i = parsed.next;
        continue;
      }
    }
    if (/^>\s*/.test(trimmed)) {
      pushParagraph(trimmed.replace(/^>\s*/, ""));
      i += 1;
      continue;
    }
    if (/^-\s+/.test(trimmed)) {
      if (/例句/.test(currentSection)) {
        const collected = [];
        while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
          collected.push(lines[i].trim());
          i += 1;
        }
        const examples = parseExamples(collected);
        if (examples.length) blocks.push({ type: "examples", items: examples });
        else blocks.push({ type: "list", items: collected.map((item) => item.replace(/^-\s+/, "")) });
        continue;
      }
      if (/注意/.test(currentSection)) {
        const items2 = [];
        while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
          items2.push(lines[i].trim().replace(/^-\s+/, ""));
          i += 1;
        }
        blocks.push({ type: "notes", items: items2 });
        continue;
      }
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    pushParagraph(stripHtml(trimmed));
    i += 1;
  }
  return { blocks, questions };
}
function extractSummary(body) {
  const quote = body.match(/^>\s*\*\*单元\*\*[^\n]*\n>\s*\*\*核心语法\*\*[：:]\s*(.+)$/m);
  if (quote) return quote[1].trim();
  const simple = body.match(/^>\s*\*\*核心语法\*\*[：:]\s*(.+)$/m);
  return simple ? simple[1].trim() : "";
}
function parseGrammarMarkdown(raw, sourceName = "") {
  const { meta, body } = parseFrontmatter(raw);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = String(meta.title || titleMatch?.[1] || sourceName || "\u8BED\u6CD5\u8BFE").trim();
  if (!title) return null;
  const lessonNo = Number(meta.lesson) || 0;
  const unitNo = Number(meta.unit) || 0;
  const course = String(meta.course || "").trim() || "\u8BED\u6CD5";
  const unitTitle = String(meta.unit_title || "").trim();
  const id = slugify(`${course}-u${unitNo}-l${lessonNo}-${title}`);
  const lines = body.split(/\r?\n/);
  const heads = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (PART_HEADING.test(line)) {
      heads.push({ kind: "part", title: line.replace(/^##\s*/, "").trim(), start: i, end: i });
      continue;
    }
    const point = line.match(POINT_HEADING);
    if (point) {
      const mark = point[1];
      const index = CIRCLED[mark] || Number(mark) || heads.filter((item) => item.kind === "point").length + 1;
      heads.push({ kind: "point", title: point[2].trim(), index, start: i, end: i });
    }
  }
  for (let i = 0; i < heads.length; i += 1) {
    heads[i].end = i + 1 < heads.length ? heads[i + 1].start : lines.length;
  }
  const parts = [];
  let currentPart = {
    id: `${id}-part-1`,
    title: "\u672C\u8BFE\u8BED\u6CD5",
    points: []
  };
  const flushPart = () => {
    if (currentPart.points.length) parts.push(currentPart);
  };
  for (const head of heads) {
    if (head.kind === "part") {
      flushPart();
      currentPart = {
        id: `${id}-part-${parts.length + 1}`,
        title: head.title,
        points: []
      };
      continue;
    }
    const pointIndex = head.index || currentPart.points.length + 1;
    const pointId = `${id}-p${pointIndex}`;
    const bodyText = lines.slice(head.start + 1, head.end).join("\n");
    const parsed = parsePointBody(bodyText, pointId);
    currentPart.points.push({
      id: pointId,
      index: pointIndex,
      title: head.title,
      blocks: parsed.blocks,
      questions: parsed.questions
    });
  }
  flushPart();
  if (!parts.length) return null;
  return {
    id,
    course,
    unit: unitNo,
    unitTitle,
    lesson: lessonNo,
    title,
    summary: extractSummary(body),
    parts,
    sourceName: sourceName || void 0
  };
}
function flattenGrammarPoints(lesson) {
  return lesson.parts.flatMap((part) => part.points);
}
function countGrammarQuestions(lesson) {
  return flattenGrammarPoints(lesson).reduce((sum, point) => sum + point.questions.length, 0);
}
function mergeGrammarLessons(base, uploaded) {
  const map = /* @__PURE__ */ new Map();
  for (const lesson of [...base, ...uploaded]) map.set(lesson.id, lesson);
  return [...map.values()].sort((a, b) => {
    if (a.course !== b.course) return a.course.localeCompare(b.course, "zh");
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.lesson - b.lesson;
  });
}
export {
  countGrammarQuestions,
  flattenGrammarPoints,
  mergeGrammarLessons,
  parseGrammarMarkdown
};
