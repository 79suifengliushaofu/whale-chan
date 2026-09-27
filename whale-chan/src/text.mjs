// 终端文本工具：东亚宽度、按显示宽度换行 / 截断 / 填充。

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

const ZERO_RANGES = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x20d0, 0x20f0],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
]

/** 单个码点在终端里占几列。 */
export function charWidth(codePoint) {
  if (codePoint === 0) return 0
  if (codePoint < 32) return 0
  if (codePoint >= 0x7f && codePoint < 0xa0) return 0
  for (const [lo, hi] of ZERO_RANGES) if (codePoint >= lo && codePoint <= hi) return 0
  for (const [lo, hi] of WIDE_RANGES) if (codePoint >= lo && codePoint <= hi) return 2
  return 1
}

/** 字符串的显示宽度。 */
export function strWidth(text) {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0))
  return width
}

/** 按显示宽度把整段文本切成多行；保留原有换行。 */
export function wrapText(text, width) {
  const limit = Math.max(1, width)
  const out = []
  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') {
      out.push('')
      continue
    }
    let line = ''
    let lineWidth = 0
    let pendingSpace = false
    for (const ch of paragraph) {
      const cw = charWidth(ch.codePointAt(0))
      const isSpace = ch === ' ' || ch === '\t'
      if (isSpace) {
        if (lineWidth === 0) continue
        pendingSpace = true
        continue
      }
      const extra = (pendingSpace ? 1 : 0) + cw
      if (lineWidth + extra > limit) {
        out.push(line)
        line = ch
        lineWidth = cw
      } else {
        if (pendingSpace) {
          line += ' '
          lineWidth += 1
        }
        line += ch
        lineWidth += cw
      }
      pendingSpace = false
    }
    out.push(line)
  }
  return out
}

/** 按显示宽度截断，可加省略号。 */
export function truncate(text, width, ellipsis = '…') {
  if (width <= 0) return ''
  if (strWidth(text) <= width) return text
  const ellipsisWidth = strWidth(ellipsis)
  let out = ''
  let used = 0
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0))
    if (used + cw + ellipsisWidth > width) break
    out += ch
    used += cw
  }
  return out + ellipsis
}

/** 按显示宽度右侧补空格。 */
export function padEnd(text, width) {
  const gap = width - strWidth(text)
  return gap > 0 ? text + ' '.repeat(gap) : text
}

/** 把字符串拆成「一个终端单元格」的序列（宽字符占两格，第二格为空串）。 */
export function cells(text) {
  const out = []
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0))
    if (cw === 0) continue
    out.push(ch)
    if (cw === 2) out.push('')
  }
  return out
}
