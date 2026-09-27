// 把 dsh-whale-widget 的 DSniang1 立绘（就是参考项目里那只小鲸鱼娘）烘焙成终端能画的帧。
// 表情用 SVG 叠加合成，坐标系是原图的 610x610。
//   node tools/bake-q.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'

const requireFromProfile = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = requireFromProfile('sharp')

const SOURCE = 'C:/Users/admin/.dsh/profiles/web/node_modules/dsh-whale-widget/assets/DSniang1.png'
const OUT_DIR = 'C:/harness/whale-chan/assets'

// 只留脸和肩膀，去掉四周多余的透明边
const CROP = { left: 58, top: 8, width: 544, height: 596 }
// 用法：node tools/bake-q.mjs [格子尺寸] [输出名]
//   128 whale-q  → 终端半格画用
//   288 whale-web → webview 用（真彩，需要更高分辨率）
const CELL = Number(process.argv[2] || 128)
const OUT_NAME = process.argv[3] || 'whale-q'

const INK = '#33477d' // 发色 / 眼线的墨蓝
const BLUSH = '#f79cb4'
const WHITE = '#ffffff'

// 量出来的五官位置（见 tools/calib.mjs 的刻度图）
const EYE_L = { x: 252, y: 372 }
const EYE_R = { x: 405, y: 372 }
const EYE_RX = 44
const EYE_RY = 42
const CHEEK_L = { x: 228, y: 428 }
const CHEEK_R = { x: 425, y: 428 }

/** 闭眼（放松）：向下鼓的弧 */
function closedEye(eye, thickness = 15, bulge = 26) {
  const { x, y } = eye
  return `<path d="M ${x - EYE_RX} ${y} Q ${x} ${y + bulge} ${x + EYE_RX} ${y}" stroke="${INK}" stroke-width="${thickness}" fill="none" stroke-linecap="round"/>`
}

/** 开心眯眼（^ ^）：向上鼓的弧 */
function happyEye(eye, thickness = 16, lift = 30) {
  const { x, y } = eye
  return `<path d="M ${x - EYE_RX} ${y + 12} Q ${x} ${y - lift} ${x + EYE_RX} ${y + 12}" stroke="${INK}" stroke-width="${thickness}" fill="none" stroke-linecap="round"/>`
}

/** 把原来的大眼睛用肤色盖掉，否则闭眼弧会压在睁着的眼睛上 */
function occludeEyes(skin) {
  return [EYE_L, EYE_R]
    .map(
      (eye) =>
        `<ellipse cx="${eye.x}" cy="${eye.y + 6}" rx="${EYE_RX + 4}" ry="${EYE_RY + 4}" fill="${skin}"/>`,
    )
    .join('')
}

function blushDot(at, rx, ry, opacity) {
  return `<ellipse cx="${at.x}" cy="${at.y}" rx="${rx}" ry="${ry}" fill="${BLUSH}" opacity="${opacity}"/>`
}

/** 四角星光 */
function sparkle(x, y, r) {
  return `<path d="M ${x} ${y - r} Q ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${WHITE}" opacity="0.92"/>`
}

/** 小爱心 */
function heart(x, y, r, opacity = 0.95) {
  const d =
    `M ${x} ${y + r * 0.75} C ${x - r * 1.5} ${y - r * 0.4} ${x - r * 0.55} ${y - r * 1.25} ${x} ${y - r * 0.35} ` +
    `C ${x + r * 0.55} ${y - r * 1.25} ${x + r * 1.5} ${y - r * 0.4} ${x} ${y + r * 0.75} Z`
  return `<path d="${d}" fill="${BLUSH}" opacity="${opacity}"/>`
}

// 采样一个「绝对是皮肤」的小块，后面遮眼睛要用
async function sampleSkin() {
  const { data, info } = await sharp(SOURCE)
    .extract({ left: 320, top: 415, width: 24, height: 20 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels
  let r = 0
  let g = 0
  let b = 0
  const count = info.width * info.height
  for (let i = 0; i < count; i++) {
    r += data[i * channels]
    g += data[i * channels + 1]
    b += data[i * channels + 2]
  }
  const hex = (v) => Math.round(v / count).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

const skin = await sampleSkin()
console.log(`采样到的肤色：${skin}`)

const FRAMES = [
  { name: 'idle', svg: '' },
  { name: 'blink', svg: occludeEyes(skin) + closedEye(EYE_L) + closedEye(EYE_R) },
  {
    name: 'joy0',
    svg:
      occludeEyes(skin) +
      happyEye(EYE_L) +
      happyEye(EYE_R) +
      blushDot(CHEEK_L, 40, 22, 0.62) +
      blushDot(CHEEK_R, 40, 22, 0.62) +
      heart(140, 210, 26, 0.85) +
      heart(470, 300, 20, 0.7),
  },
  {
    name: 'joy1',
    svg:
      occludeEyes(skin) +
      happyEye(EYE_L) +
      happyEye(EYE_R) +
      blushDot(CHEEK_L, 46, 26, 0.75) +
      blushDot(CHEEK_R, 46, 26, 0.75) +
      heart(120, 170, 30, 0.95) +
      heart(492, 250, 24, 0.8) +
      heart(300, 120, 18, 0.7),
  },
  {
    name: 'cheer',
    svg:
      blushDot(CHEEK_L, 34, 18, 0.4) +
      blushDot(CHEEK_R, 34, 18, 0.4) +
      sparkle(120, 200, 34) +
      sparkle(500, 240, 26) +
      sparkle(300, 90, 22) +
      sparkle(560, 430, 20),
  },
  {
    name: 'oops',
    svg: `<path d="M 500 300 C 522 330 528 348 528 360 A 28 28 0 0 1 472 360 C 472 348 478 330 500 300 Z" fill="#8ecbff" opacity="0.9"/>`,
  },
]

const buffers = []
for (const frame of FRAMES) {
  // sharp 的流水线里 extract 排在 composite 前面，所以一旦先 extract，图就变成 550x550，
  // 再叠 610x610 的蒙版会被判成「尺寸不一致」。因此先合成出一张整图，再裁再缩。
  let base = SOURCE
  if (frame.svg) {
    const overlay = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="610" height="610" viewBox="0 0 610 610">${frame.svg}</svg>`,
      ),
    )
      .resize(610, 610, { fit: 'fill' })
      .png()
      .toBuffer()
    base = await sharp(SOURCE)
      .ensureAlpha()
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png()
      .toBuffer()
  }
  const raw = await sharp(base)
    .extract(CROP)
    .resize(CELL, CELL, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  buffers.push(raw)
}

// 拼成 1 行 N 列的图集
const columns = buffers.length
const atlas = Buffer.alloc(CELL * columns * CELL * 4)
buffers.forEach((raw, index) => {
  for (let y = 0; y < CELL; y++) {
    const from = y * CELL * 4
    const to = (y * CELL * columns + index * CELL) * 4
    raw.copy(atlas, to, from, from + CELL * 4)
  }
})

fs.mkdirSync(OUT_DIR, { recursive: true })
await sharp(atlas, { raw: { width: CELL * columns, height: CELL, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(`${OUT_DIR}/${OUT_NAME}.png`)

fs.writeFileSync(
  `${OUT_DIR}/${OUT_NAME}.json`,
  `${JSON.stringify(
    {
      cell: CELL,
      columns,
      rows: 1,
      order: FRAMES.map((f) => f.name),
      skin,
      source: 'dsh-whale-widget/assets/DSniang1.png',
    },
    null,
    2,
  )}\n`,
)

// 统计一下每帧的不透明像素，确认叠加拿上了
for (let index = 0; index < columns; index++) {
  let opaque = 0
  for (let i = 3; i < CELL * CELL * 4; i += 4) if (buffers[index][i] > 24) opaque++
  console.log(`  ${FRAMES[index].name.padEnd(6)} opaque=${opaque}/${CELL * CELL}`)
}
console.log(`wrote ${OUT_DIR}/${OUT_NAME}.png  ${CELL * columns}x${CELL} (${columns} frames)`)
