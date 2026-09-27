// Bakes the whale-girl pet spritesheet into a terminal-sized truecolor PNG atlas.
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'

const require = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = require('sharp')

const SRC = 'C:/Users/admin/.dsh/profiles/web/node_modules/@linxin666/dsh-pet/assets/whale/spritesheet.webp'
const CELL_W = 192
const CELL_H = 208
const FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]
const COLS = 8
const ROWS = FRAMES.length
const OUT_W = 60
const OUT_H = 68
const OUT = 'C:/harness/whale-chan/assets/whale.png'

const meta = await sharp(SRC).metadata()
console.log('source', meta.width, meta.height, 'alpha=', meta.hasAlpha, 'channels=', meta.channels)

const sheetW = COLS * OUT_W
const sheetH = ROWS * OUT_H
const sheet = Buffer.alloc(sheetW * sheetH * 4, 0)

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < FRAMES[r]; c++) {
    const raw = await sharp(SRC)
      .extract({ left: c * CELL_W, top: r * CELL_H, width: CELL_W, height: CELL_H })
      .resize(OUT_W, OUT_H, { kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer()
    for (let y = 0; y < OUT_H; y++) {
      raw.copy(
        sheet,
        ((r * OUT_H + y) * sheetW + c * OUT_W) * 4,
        y * OUT_W * 4,
        (y + 1) * OUT_W * 4,
      )
    }
  }
}

// report opaque coverage of frame 0 so we know transparency survived
let opaque = 0
for (let i = 3; i < OUT_W * OUT_H * 4; i += 4) if (sheet[i] > 8) opaque++
console.log('frame0 opaque pixels', opaque, '/', OUT_W * OUT_H)

await fs.mkdir('C:/harness/whale-chan/assets', { recursive: true })
const info = await sharp(sheet, { raw: { width: sheetW, height: sheetH, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(OUT)
console.log('wrote', OUT, info.width + 'x' + info.height, info.size, 'bytes')

await fs.writeFile(
  'C:/harness/whale-chan/assets/whale.json',
  JSON.stringify(
    {
      source: 'whale-girl sprite atlas (2026-08-13 build)',
      cellWidth: OUT_W,
      cellHeight: OUT_H,
      columns: COLS,
      rows: ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'],
      frames: FRAMES,
    },
    null,
    2,
  ) + '\n',
)
console.log('wrote whale.json')
