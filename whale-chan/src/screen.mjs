// 一个带差异刷新的终端画布：只重画内容发生变化的行，避免闪烁与带宽浪费。

const ESC = '\x1b'
const RESET_FG = -1
const RESET_BG = -1

function packRgb(r, g, b) {
  return (r << 16) | (g << 8) | b
}

export { packRgb }

export class Canvas {
  /** @param {number} cols @param {number} rows */
  constructor(cols, rows) {
    this.cols = 0
    this.rows = 0
    this.chars = []
    this.fg = new Int32Array(0)
    this.bg = new Int32Array(0)
    this.previous = []
    this.dirty = true
    this.resize(cols, rows)
  }

  resize(cols, rows) {
    const c = Math.max(1, cols)
    const r = Math.max(1, rows)
    if (c === this.cols && r === this.rows) return false
    this.cols = c
    this.rows = r
    this.chars = new Array(c * r).fill(' ')
    this.fg = new Int32Array(c * r).fill(RESET_FG)
    this.bg = new Int32Array(c * r).fill(RESET_BG)
    this.previous = new Array(r).fill(null)
    this.dirty = true
    return true
  }

  clear(bg = RESET_BG) {
    this.chars.fill(' ')
    this.fg.fill(RESET_FG)
    this.bg.fill(bg)
    this.dirty = true
  }

  put(x, y, ch, fg = RESET_FG, bg = RESET_BG) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return
    const i = y * this.cols + x
    this.chars[i] = ch
    this.fg[i] = fg
    this.bg[i] = bg
  }

  /** 填充矩形。 */
  fill(x, y, w, h, ch = ' ', fg = RESET_FG, bg = RESET_BG) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.put(x + i, y + j, ch, fg, bg)
    }
  }

  /** 写入文本，返回结束列（宽字符占两格）。 */
  text(x, y, value, fg = RESET_FG, bg = RESET_BG) {
    let cx = x
    for (const ch of String(value)) {
      const cp = ch.codePointAt(0)
      if (cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f)) continue
      const wide = isWide(cp)
      this.put(cx, y, ch, fg, bg)
      if (wide) this.put(cx + 1, y, '', fg, bg)
      cx += wide ? 2 : 1
    }
    return cx
  }

  /** 生成某一行的 ANSI 字符串。 */
  renderRow(y) {
    const { cols } = this
    const base = y * cols
    let last = -1
    for (let x = cols - 1; x >= 0; x--) {
      const i = base + x
      if (this.chars[i] !== ' ' || this.fg[i] !== RESET_FG || this.bg[i] !== RESET_BG) {
        last = x
        break
      }
    }
    if (last < 0) return `${ESC}[K`

    let out = ''
    let fg = RESET_FG
    let bg = RESET_BG
    for (let x = 0; x <= last; x++) {
      const i = base + x
      const ch = this.chars[i]
      if (ch === '') continue
      const cf = this.fg[i]
      if (cf !== fg) {
        out += cf === RESET_FG ? `${ESC}[39m` : `${ESC}[38;2;${(cf >> 16) & 0xff};${(cf >> 8) & 0xff};${cf & 0xff}m`
        fg = cf
      }
      const cb = this.bg[i]
      if (cb !== bg) {
        out += cb === RESET_BG ? `${ESC}[49m` : `${ESC}[48;2;${(cb >> 16) & 0xff};${(cb >> 8) & 0xff};${cb & 0xff}m`
        bg = cb
      }
      out += ch
    }
    return out + `${ESC}[0m${ESC}[K`
  }

  /** 把变化的行写到 out。 */
  flush(out) {
    out.write(`${ESC}[?2026h`)
    for (let y = 0; y < this.rows; y++) {
      const line = this.renderRow(y)
      if (this.previous[y] === line) continue
      this.previous[y] = line
      out.write(`${ESC}[${y + 1};1H${line}`)
    }
    out.write(`${ESC}[?2026l`)
    this.dirty = false
  }

  invalidate() {
    this.previous.fill(null)
  }
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff)
  )
}
