// 鲸鱼娘精灵图：解码 PNG 图集 → 缩放 → 在终端画布上用半格字符 (▀) 绘制。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from './png.mjs'
import { packRgb } from './screen.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, '..', 'assets')

/** 状态 → 图集行号 */
export const ROWS = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
}

let cachedAtlas = null

export function loadAtlas(assetDir = ASSETS) {
  if (cachedAtlas) return cachedAtlas
  const meta = JSON.parse(fs.readFileSync(path.join(assetDir, 'whale.json'), 'utf8'))
  const sheet = decodePng(fs.readFileSync(path.join(assetDir, 'whale.png')))
  cachedAtlas = { meta, sheet }
  return cachedAtlas
}

const frameCache = new Map()

/** 取出某一行某一帧，缩放到 outW×outH 的 RGBA 缓冲（预乘平均，边缘不会发黑）。 */
export function getFrame(rowName, index, outW, outH, assetDir = ASSETS) {
  const { meta, sheet } = loadAtlas(assetDir)
  const row = ROWS[rowName] ?? 0
  const count = meta.frames[row] || 1
  const frame = ((index % count) + count) % count
  const key = `${row}:${frame}:${outW}x${outH}`
  const hit = frameCache.get(key)
  if (hit) return hit
  const rect = {
    x: frame * meta.cellWidth,
    y: row * meta.cellHeight,
    width: meta.cellWidth,
    height: meta.cellHeight,
  }
  const data = scaleRegion(sheet, rect, outW, outH)
  const out = { width: outW, height: outH, data }
  frameCache.set(key, out)
  return out
}

export function frameCount(rowName, assetDir = ASSETS) {
  const { meta } = loadAtlas(assetDir)
  return meta.frames[ROWS[rowName] ?? 0] || 1
}

const boundsCache = new Map()

/**
 * 某一行动画的整体不透明包围盒（取该行所有帧的并集）。
 * 用并集而不是逐帧包围盒，角色在动画里才不会忽大忽小地抖动。
 */
export function rowBounds(rowName, assetDir = ASSETS) {
  const { meta, sheet } = loadAtlas(assetDir)
  const row = ROWS[rowName] ?? 0
  const hit = boundsCache.get(row)
  if (hit) return hit
  const count = meta.frames[row] || 1
  const top = row * meta.cellHeight
  let minX = meta.cellWidth
  let minY = meta.cellHeight
  let maxX = -1
  let maxY = -1
  for (let frame = 0; frame < count; frame++) {
    const left = frame * meta.cellWidth
    for (let y = 0; y < meta.cellHeight; y++) {
      for (let x = 0; x < meta.cellWidth; x++) {
        const alpha = sheet.data[((top + y) * sheet.width + left + x) * 4 + 3]
        if (alpha <= 24) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const bounds =
    maxX < 0
      ? { x: 0, y: 0, width: meta.cellWidth, height: meta.cellHeight }
      : {
          x: Math.max(0, minX - 1),
          y: Math.max(0, minY - 1),
          width: Math.min(meta.cellWidth, maxX + 2) - Math.max(0, minX - 1),
          height: Math.min(meta.cellHeight, maxY + 2) - Math.max(0, minY - 1),
        }
  boundsCache.set(row, bounds)
  return bounds
}

/**
 * 按角色实际轮廓取帧，并让它尽量撑满 maxW×maxH（像素；终端里每格高 = 2 像素）。
 * 返回的帧宽高就是真正要绘制的格子数。
 */
export function getFrameFit(rowName, index, maxW, maxH, assetDir = ASSETS) {
  const bounds = rowBounds(rowName, assetDir)
  const scale = Math.min(maxW / bounds.width, maxH / bounds.height)
  let outW = Math.max(4, Math.floor(bounds.width * scale))
  let outH = Math.max(6, Math.floor(bounds.height * scale))
  if (outH % 2) outH -= 1
  const { meta, sheet } = loadAtlas(assetDir)
  const row = ROWS[rowName] ?? 0
  const count = meta.frames[row] || 1
  const frame = ((index % count) + count) % count
  const key = `${row}:${frame}:fit:${outW}x${outH}`
  const hit = frameCache.get(key)
  if (hit) return hit
  const rect = {
    x: frame * meta.cellWidth + bounds.x,
    y: row * meta.cellHeight + bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  const out = enhanceFrame({ width: outW, height: outH, data: scaleRegion(sheet, rect, outW, outH) })
  frameCache.set(key, out)
  return out
}

// ---------------------------------------------------------------------------
// 重采样
//
// 最早用的是盒式平均：128px 的源降到 40px 会把五官平均成一团糊。这里换成
// Lanczos3 分离式滤波（a=3，预乘 alpha），边缘和高频细节能保住，这是终端里
// 「看得清脸」最要紧的一步。
// ---------------------------------------------------------------------------

function clamp8(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
}

function lanczos(x, a = 3) {
  if (x === 0) return 1
  const ax = Math.abs(x)
  if (ax >= a) return 0
  const px = Math.PI * x
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px)
}

/**
 * 一维滤波核：返回 [源下标, 权重, 源下标, 权重, ...]（权重已归一化）。
 * @param {number} center 目标像素中心在源坐标里的位置
 * @param {number} scale  源/目标 的尺寸比（>1 表示缩小）
 * @param {number} maxIndex 源坐标上限
 */
function kernel(center, scale, maxIndex) {
  const support = scale < 1 ? 3 : 3 * scale
  const from = Math.max(0, Math.ceil(center - support))
  const to = Math.min(maxIndex, Math.floor(center + support))
  const taps = []
  let sum = 0
  for (let i = from; i <= to; i++) {
    const w = lanczos((i - center) / (scale < 1 ? 1 : scale))
    if (w === 0) continue
    taps.push(i, w)
    sum += w
  }
  if (sum === 0) return [Math.max(0, Math.min(maxIndex, Math.round(center))), 1]
  for (let i = 1; i < taps.length; i += 2) taps[i] /= sum
  return taps
}

function scaleRegion(sheet, rect, outW, outH) {
  const { width, data } = sheet
  const sx = rect.width / outW
  const sy = rect.height / outH
  const maxX = rect.x + rect.width - 1

  // 横向：rect.width → outW，行数不变，先落到浮点缓冲里
  const tmp = new Float32Array(outW * rect.height * 4)
  for (let y = 0; y < rect.height; y++) {
    const srcRow = (rect.y + y) * width
    for (let ox = 0; ox < outW; ox++) {
      const taps = kernel(rect.x + (ox + 0.5) * sx - 0.5, sx, maxX)
      let r = 0
      let g = 0
      let b = 0
      let aw = 0
      let wsum = 0
      for (let t = 0; t < taps.length; t += 2) {
        const i = (srcRow + taps[t]) * 4
        const w = taps[t + 1]
        const al = data[i + 3] / 255
        r += data[i] * al * w
        g += data[i + 1] * al * w
        b += data[i + 2] * al * w
        aw += al * w
        wsum += w
      }
      if (aw <= 0 || wsum <= 0) continue
      const o = (y * outW + ox) * 4
      tmp[o] = r / aw
      tmp[o + 1] = g / aw
      tmp[o + 2] = b / aw
      tmp[o + 3] = aw / wsum
    }
  }

  // 纵向：rect.height → outH
  const out = Buffer.alloc(outW * outH * 4)
  for (let oy = 0; oy < outH; oy++) {
    const taps = kernel((oy + 0.5) * sy - 0.5, sy, rect.height - 1)
    for (let x = 0; x < outW; x++) {
      let r = 0
      let g = 0
      let b = 0
      let aw = 0
      let wsum = 0
      for (let t = 0; t < taps.length; t += 2) {
        const i = (taps[t] * outW + x) * 4
        const w = taps[t + 1]
        const al = tmp[i + 3]
        r += tmp[i] * al * w
        g += tmp[i + 1] * al * w
        b += tmp[i + 2] * al * w
        aw += al * w
        wsum += w
      }
      if (aw <= 0 || wsum <= 0) continue
      const o = (oy * outW + x) * 4
      out[o] = clamp8(r / aw)
      out[o + 1] = clamp8(g / aw)
      out[o + 2] = clamp8(b / aw)
      out[o + 3] = clamp8((aw / wsum) * 255)
    }
  }
  return out
}

/**
 * 降采样之后的「看得清」处理：
 *   1) 非锐化掩模，把被平均掉的轮廓找回来
 *   2) 轻微加对比、加饱和，抵消浅色插画在深色终端里的发灰
 * @param {{width:number,height:number,data:Buffer}} frame
 */
export function enhanceFrame(frame, { sharpen = 0.95, saturate = 1.25, contrast = 1.14 } = {}) {
  const { width, height, data: src } = frame
  const n = width * height
  const GAUSS = [1, 2, 1, 2, 4, 2, 1, 2, 1]
  const blur = new Float32Array(n * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let wsum = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const w = GAUSS[(dy + 1) * 3 + (dx + 1)]
          const i = (yy * width + xx) * 4
          const a = src[i + 3] / 255
          r += src[i] * a * w
          g += src[i + 1] * a * w
          b += src[i + 2] * a * w
          wsum += w * a
        }
      }
      const o = (y * width + x) * 3
      if (wsum <= 0) continue
      blur[o] = r / wsum
      blur[o + 1] = g / wsum
      blur[o + 2] = b / wsum
    }
  }

  const out = Buffer.from(src)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (src[i + 3] === 0) continue
    const o = p * 3
    let r = src[i] + sharpen * (src[i] - blur[o])
    let g = src[i + 1] + sharpen * (src[i + 1] - blur[o + 1])
    let b = src[i + 2] + sharpen * (src[i + 2] - blur[o + 2])
    r = 128 + (r - 128) * contrast
    g = 128 + (g - 128) * contrast
    b = 128 + (b - 128) * contrast
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    out[i] = clamp8(luma + (r - luma) * saturate)
    out[i + 1] = clamp8(luma + (g - luma) * saturate)
    out[i + 2] = clamp8(luma + (b - luma) * saturate)
  }
  return { width, height, data: out }
}

/**
 * 按「缩了多少倍」调增强参数。
 *
 * 源图 126px 降到 60px（宽面板）时，Lanczos 只平均掉一点点；降到 20px
 * （窄面板）时同样一颗眼睛只剩两三个像素，固定参数就压不住那片灰 ——
 * 表现就是「面板一窄，脸就糊了」。缩得越狠，锐化/对比/饱和补得越多。
 *
 * 斜坡从 2.6× 才开始：宽面板大约就是 3.4×，那里只能轻轻补一点，
 * 否则脸会变得又硬又假 —— 修窄屏不能拿宽屏当代价。
 *
 * @param {number} ratio 源尺寸 / 输出尺寸（>1 表示在缩小）
 * @param {{sharpen:number,saturate:number,contrast:number}} base 1:1 附近的基准值
 */
export function enhanceFor(ratio, base = { sharpen: 0.95, saturate: 1.25, contrast: 1.14 }) {
  const t = Math.max(0, Math.min(1, (ratio - 2.6) / 2.9)) // 2.6× 起补，5.5× 补满
  return {
    sharpen: base.sharpen + 0.55 * t,
    saturate: base.saturate + 0.16 * t,
    contrast: base.contrast + 0.10 * t,
  }
}

/**
 * 把一帧画到画布上：每个终端单元格放上下两个像素，用 "▀" 呈现。
 * 半透明像素与面板底色合成，所以整块面板永远是不透明的，观感稳定。
 */
export function drawFrame(canvas, x, y, frame, background) {
  const bgR = (background >> 16) & 0xff
  const bgG = (background >> 8) & 0xff
  const bgB = background & 0xff
  const { width, height, data } = frame
  for (let cy = 0; cy < height >> 1; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const top = blend(data, (cy * 2 * width + cx) * 4, bgR, bgG, bgB)
      const bottom = blend(data, ((cy * 2 + 1) * width + cx) * 4, bgR, bgG, bgB)
      if (top === bottom) {
        canvas.put(x + cx, y + cy, ' ', -1, top)
      } else {
        canvas.put(x + cx, y + cy, '▀', top, bottom)
      }
    }
  }
}

function blend(data, i, bgR, bgG, bgB) {
  const a = data[i + 3] / 255
  if (a >= 0.999) return packRgb(data[i], data[i + 1], data[i + 2])
  if (a <= 0.001) return packRgb(bgR, bgG, bgB)
  const r = Math.round(data[i] * a + bgR * (1 - a))
  const g = Math.round(data[i + 1] * a + bgG * (1 - a))
  const b = Math.round(data[i + 2] * a + bgB * (1 - a))
  return packRgb(r, g, b)
}

/** 把精灵图渲染成纯文本行（用于 --once / 预览），保留 ANSI 真彩色。 */
export function frameToText(frame, background) {
  const lines = []
  const { width, height, data } = frame
  const bgR = (background >> 16) & 0xff
  const bgG = (background >> 8) & 0xff
  const bgB = background & 0xff
  for (let cy = 0; cy < height >> 1; cy++) {
    let line = ''
    for (let cx = 0; cx < width; cx++) {
      const top = blend(data, (cy * 2 * width + cx) * 4, bgR, bgG, bgB)
      const bottom = blend(data, ((cy * 2 + 1) * width + cx) * 4, bgR, bgG, bgB)
      if (top === bottom) {
        line += `\x1b[48;2;${(top >> 16) & 0xff};${(top >> 8) & 0xff};${top & 0xff}m `
      } else {
        line += `\x1b[38;2;${(top >> 16) & 0xff};${(top >> 8) & 0xff};${top & 0xff}m\x1b[48;2;${(bottom >> 16) & 0xff};${(bottom >> 8) & 0xff};${bottom & 0xff}m▀`
      }
    }
    lines.push(line + '\x1b[0m')
  }
  return lines
}

// ------------------------------------------------------------- Q 萌表情图集
// 素材：`dsh-whale-widget/assets/DSniang1.png`（Q 版小鲸鱼娘侧脸特写，来自参考项目
// MeteorNOX/DeepSeek-Balance-Whale-Widget）。构建期由 tools/bake-q.mjs 用 SVG 叠层
// 合成出六种表情，横排成一条 whale-q.png。

/** Q 萌表情帧顺序，和 assets/whale-q.json 的 order 一致。 */
export const Q_FRAMES = ['idle', 'blink', 'joy0', 'joy1', 'cheer', 'oops']

let cachedQ = null

export function loadQAtlas(assetDir = ASSETS) {
  if (cachedQ) return cachedQ
  const meta = JSON.parse(fs.readFileSync(path.join(assetDir, 'whale-q.json'), 'utf8'))
  const sheet = decodePng(fs.readFileSync(path.join(assetDir, 'whale-q.png')))
  cachedQ = { meta, sheet, cell: meta.cell || 128 }
  return cachedQ
}

export function qFrameCount() {
  return Q_FRAMES.length
}

let qBoundsCache = null

/** 六张表情共用一个包围盒，换表情时角色不会整体跳来跳去。 */
export function qBounds(assetDir = ASSETS) {
  if (qBoundsCache) return qBoundsCache
  const { sheet, cell } = loadQAtlas(assetDir)
  let minX = cell
  let minY = cell
  let maxX = -1
  let maxY = -1
  for (let frame = 0; frame < Q_FRAMES.length; frame++) {
    const left = frame * cell
    for (let y = 0; y < cell; y++) {
      const rowStart = (y * sheet.width + left) * 4
      for (let x = 0; x < cell; x++) {
        if (sheet.data[rowStart + x * 4 + 3] <= 24) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    qBoundsCache = { x: 0, y: 0, width: cell, height: cell }
    return qBoundsCache
  }
  const x = Math.max(0, minX - 1)
  const y = Math.max(0, minY - 1)
  qBoundsCache = {
    x,
    y,
    width: Math.min(cell, maxX + 2) - x,
    height: Math.min(cell, maxY + 2) - y,
  }
  return qBoundsCache
}

/**
 * 取一张表情，等比缩放到不超过 maxW×maxH 个像素。
 * 终端里每格高 = 2 像素，所以返回的 height 要 >> 1 才是占用的行数。
 */
export function getQFrameFit(name, maxW, maxH, assetDir = ASSETS) {
  const { sheet, cell } = loadQAtlas(assetDir)
  const index = Math.max(0, Q_FRAMES.indexOf(name))
  const bounds = qBounds(assetDir)
  const scale = Math.min(maxW / bounds.width, maxH / bounds.height)
  let outW = Math.max(2, Math.min(maxW, Math.round(bounds.width * scale)))
  let outH = Math.max(2, Math.min(maxH, Math.round(bounds.height * scale)))
  if (outH % 2) outH -= 1
  if (outH < 2) outH = 2
  const key = `q:${index}:fit:${outW}x${outH}`
  const hit = frameCache.get(key)
  if (hit) return hit
  const rect = { x: index * cell + bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  const fit = enhanceFor(bounds.width / outW)
  const out = enhanceFrame({ width: outW, height: outH, data: scaleRegion(sheet, rect, outW, outH) }, fit)
  frameCache.set(key, out)
  return out
}

// ------------------------------------------------- 预设表情包（气泡里弹出来的图）
// 素材：`C:\harness\表情包\*.png`（用户自备，文件名就是分类）。
// 运行时按文件名关键词匹配状态，渲染成半格字符塞进气泡卡片。

let cachedStickers = null

/** 扫描表情包目录，返回 [{file, name, tags}]。目录不存在时返回空数组。 */
export function listStickers(dir) {
  if (cachedStickers && cachedStickers.dir === dir) return cachedStickers.items
  let items = []
  try {
    items = fs
      .readdirSync(dir)
      .filter((f) => /\.png$/i.test(f))
      .map((f) => ({ file: path.join(dir, f), name: f.replace(/\.png$/i, '') }))
  } catch {
    items = []
  }
  cachedStickers = { dir, items }
  return items
}

const stickerCache = new Map()

/** 把一张表情包读进来并缩放到不超过 maxW×maxH 像素（终端每格高 = 2 像素）。 */
export function getStickerFit(file, maxW, maxH) {
  const key = `${file}:${maxW}x${maxH}`
  const hit = stickerCache.get(key)
  if (hit) return hit
  let sheet
  try {
    sheet = decodePng(fs.readFileSync(file))
  } catch {
    return null
  }
  const rect = transparentBounds(sheet)
  const scale = Math.min(maxW / rect.width, maxH / rect.height)
  let outW = Math.max(2, Math.min(maxW, Math.round(rect.width * scale)))
  let outH = Math.max(2, Math.min(maxH, Math.round(rect.height * scale)))
  if (outH % 2) outH -= 1
  if (outH < 2) outH = 2
  const data = scaleRegion(sheet, rect, outW, outH)
  // 表情包是主人自己的图 —— 只补锐化，不动饱和度与对比度，免得把原图改味。
  const out = enhanceFrame(
    { width: outW, height: outH, data },
    enhanceFor(rect.width / outW, { sharpen: 0.6, saturate: 1, contrast: 1 }),
  )
  stickerCache.set(key, out)
  return out
}

/** 不透明像素的包围盒（阈值 alpha > 16，四周留 1px），用来去掉表情包周围的空白。 */
function transparentBounds(sheet) {
  const { width, height, data } = sheet
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height }
  const x = Math.max(0, minX - 1)
  const y = Math.max(0, minY - 1)
  return {
    x,
    y,
    width: Math.min(width, maxX + 2) - x,
    height: Math.min(height, maxY + 2) - y,
  }
}
