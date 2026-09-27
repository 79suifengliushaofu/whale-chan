// 清晰度实验台：把同一张素材按几种目标宽度渲染成半格字符，拼成一张对照图。
// 用法：node tools/lab.mjs <out.png> [scale]

import fs from 'node:fs'
import path from 'node:path'
import { Canvas, packRgb } from '../whale-chan/src/screen.mjs'
import { getQFrameFit, getStickerFit, drawFrame } from '../whale-chan/src/sprite.mjs'
import { canvasToPng } from './canvas-png.mjs'

const out = process.argv[2] || 'C:/harness/whale-chan-dist/lab.png'
const scale = Number(process.argv[3] || 5)

const PANEL = packRgb(13, 20, 36)
const BG = packRgb(7, 10, 18)
const WIDTHS = [28, 36, 44, 52]

const sticker = 'C:/harness/表情包/工作间使用.png'
const rows = [
  { label: 'Q', frames: WIDTHS.map((w) => getQFrameFit('idle', w, w * 2)) },
  { label: 'S', frames: WIDTHS.map((w) => getStickerFit(sticker, w, w * 2)) },
]

// 每列宽 = 最大宽度 + 2 边距，行高 = 最大像素高/2 + 2
const colW = WIDTHS[WIDTHS.length - 1] + 2
const rowH = (WIDTHS[WIDTHS.length - 1] * 2) / 2 + 2

const canvas = new Canvas(colW * WIDTHS.length, rowH * rows.length)
canvas.clear(BG)

rows.forEach((row, ri) => {
  row.frames.forEach((frame, ci) => {
    if (!frame) return
    const cellX = ci * colW
    const cellY = ri * rowH
    canvas.fill(cellX, cellY, colW, rowH, ' ', packRgb(255, 255, 255), PANEL)
    const ox = cellX + Math.floor((colW - frame.width) / 2)
    const oy = cellY + Math.floor((rowH - (frame.height >> 1)) / 2)
    drawFrame(canvas, ox, oy, frame, PANEL)
  })
})

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, canvasToPng(canvas, scale))
console.log(out, `${canvas.width}x${canvas.height} cells`, 'scale', scale)
