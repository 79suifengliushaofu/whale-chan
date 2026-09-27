// 把终端画布导出成 PNG —— 用来「亲眼」检查鲸鱼娘在终端里到底长什么样。
// 每个字符格 = 上下两个像素（真实终端用的就是半格 ▀），再按 scale 放大。
import { encodePng } from '../whale-chan/src/png.mjs'

function unpack(value, fallback) {
  if (value < 0) return fallback
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export function canvasToPng(canvas, scale = 4) {
  const { cols, rows } = canvas
  const width = cols * scale
  const height = rows * 2 * scale
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      const ch = canvas.chars[i]
      const fg = unpack(canvas.fg[i], [0, 0, 0])
      const bg = unpack(canvas.bg[i], [0, 0, 0])
      let top = bg
      let bottom = bg
      if (ch === '▀') top = fg
      else if (ch === '▄') bottom = fg
      else if (ch === '█') {
        top = fg
        bottom = fg
      } else if (ch && ch !== ' ' && ch !== '') {
        top = fg
        bottom = fg
      }
      for (let s = 0; s < scale; s++) {
        const px = (x * scale + s) * 3
        for (let t = 0; t < scale; t++) {
          const topRow = (y * 2 * scale + t) * width * 3 + px
          rgb[topRow] = top[0]
          rgb[topRow + 1] = top[1]
          rgb[topRow + 2] = top[2]
          const bottomRow = (y * 2 * scale + scale + t) * width * 3 + px
          rgb[bottomRow] = bottom[0]
          rgb[bottomRow + 1] = bottom[1]
          rgb[bottomRow + 2] = bottom[2]
        }
      }
    }
  }
  return encodePng(width, height, rgb)
}
