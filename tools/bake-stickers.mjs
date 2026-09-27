// 把用户的表情包压进插件里，让它自包含。
//
// 终端里贴图最多也就画到 ~50px 宽，原图 349~580px 是巨大的浪费（29 张 5.6 MB）。
// 这里统一缩到长边 320px —— 相对实际渲染尺寸还是 6 倍以上的过采样，看不出差别。
//
// 用法：node tools/bake-stickers.mjs [源目录] [目标目录]

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// sharp 借 profile 里那份，不给鲸鱼娘加依赖。
const require = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = require('sharp')

const SRC = process.argv[2] || 'C:/harness/表情包'
const DST = process.argv[3] || 'C:/harness/whale-chan/assets/stickers'
const MAX = 320

if (!fs.existsSync(SRC)) {
  console.error(`源目录不存在：${SRC}`)
  process.exit(1)
}

fs.mkdirSync(DST, { recursive: true })

const files = fs
  .readdirSync(SRC)
  .filter((f) => /\.png$/i.test(f))
  .sort()

let before = 0
let after = 0

for (const name of files) {
  const src = path.join(SRC, name)
  const dst = path.join(DST, name)
  before += fs.statSync(src).size

  const info = await sharp(src).resize(MAX, MAX, { fit: 'inside', withoutEnlargement: true }).png({
    compressionLevel: 9,
    effort: 10,
  })
  const buf = await info.toBuffer()
  fs.writeFileSync(dst, buf)
  after += buf.length
}

// 清掉源目录里已经删掉、但目标目录还留着的旧图
for (const name of fs.readdirSync(DST)) {
  if (!/\.png$/i.test(name)) continue
  if (!files.includes(name)) {
    fs.unlinkSync(path.join(DST, name))
    console.log(`  移除旧图 ${name}`)
  }
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`${files.length} 张表情包 → ${DST}`)
console.log(`  ${kb(before)} → ${kb(after)}  （压到 ${((after / before) * 100).toFixed(1)}%）`)
