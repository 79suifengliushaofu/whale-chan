// 刻度图：给 DSniang1 铺上 50px 红色网格，用来量眼睛和腮红的位置。
//   node tools/calib.mjs
import { createRequire } from 'node:module'

const requireFromProfile = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = requireFromProfile('sharp')

const SOURCE = 'C:/Users/admin/.dsh/profiles/web/node_modules/dsh-whale-widget/assets/DSniang1.png'
const OUT = 'C:/harness/whale-chan-dist/calib.png'

const SIZE = 610
const STEP = 50
let lines = ''
for (let i = 0; i <= SIZE; i += STEP) {
  const major = i % 100 === 0
  const stroke = major ? 2 : 1
  const color = major ? '#ff0033' : '#ff9900'
  lines += `<line x1="${i}" y1="0" x2="${i}" y2="${SIZE}" stroke="${color}" stroke-width="${stroke}"/>`
  lines += `<line x1="0" y1="${i}" x2="${SIZE}" y2="${i}" stroke="${color}" stroke-width="${stroke}"/>`
}
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${lines}</svg>`,
)

await sharp(SOURCE)
  .ensureAlpha()
  .composite([{ input: svg, top: 0, left: 0 }])
  .png()
  .toFile(OUT)
console.log(`wrote ${OUT}  (major red lines every 100px, orange every 50px, origin top-left)`)
