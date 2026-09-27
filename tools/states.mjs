// 把鲸鱼娘的六张 Q 萌表情各取一帧拼成联络表，顺便看看每张表情长什么样。
//   node tools/states.mjs [输出.png]
import fs from 'node:fs'
import path from 'node:path'
import { Canvas, packRgb } from '../whale-chan/src/screen.mjs'
import { drawFrame, getQFrameFit } from '../whale-chan/src/sprite.mjs'
import { canvasToPng } from './canvas-png.mjs'

const FACES = ['idle', 'blink', 'joy0', 'joy1', 'cheer', 'oops']

const TILE_W = 44
const TILE_H = 24
const COLS = 3
const ROWS_COUNT = 2

const bg = packRgb(9, 13, 23)
const panel = packRgb(13, 20, 36)
const white = packRgb(245, 249, 255)

const canvas = new Canvas(TILE_W * COLS, TILE_H * ROWS_COUNT)
canvas.clear(bg)

FACES.forEach((name, index) => {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  const x = col * TILE_W
  const y = row * TILE_H
  canvas.fill(x + 1, y + 1, TILE_W - 2, TILE_H - 2, ' ', white, panel)
  const frame = getQFrameFit(name, TILE_W - 6, (TILE_H - 4) * 2)
  const ox = x + Math.floor((TILE_W - frame.width) / 2)
  const oy = y + 2 + Math.max(0, Math.floor((TILE_H - 4 - (frame.height >> 1)) / 2))
  drawFrame(canvas, ox, oy, frame, panel)
})

const output = process.argv[2] || 'C:/harness/whale-chan-dist/states-q.png'
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, canvasToPng(canvas, 3))
process.stdout.write(`${output} ${canvas.cols}x${canvas.rows} cells → png\n`)
