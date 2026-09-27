// 生成 VS Code 扩展图标（128x128 PNG，vsce 不接受 SVG）。
//   node tools/make-icon.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = require('sharp')

const SRC = 'C:/Users/admin/.dsh/profiles/web/node_modules/dsh-whale-widget/assets/DSniang1.png'
const OUT = 'C:/harness/whale-chan/ide/vscode/icon.png'

const buf = await sharp(SRC)
  .ensureAlpha()
  .extract({ left: 58, top: 8, width: 544, height: 596 })
  .resize(128, 128, { fit: 'cover', position: 'top' })
  .png({ compressionLevel: 9 })
  .toBuffer()

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, buf)
process.stdout.write(`${OUT} 128x128 ${buf.length} bytes\n`)
