// 统一改版本号：whale-chan/package.json、ide/vscode/package.json、src/app.mjs。
// 用法：node tools/bump-version.mjs 1.2.1

import fs from 'node:fs'

const next = process.argv[2]
if (!/^\d+\.\d+\.\d+/.test(next || '')) {
  console.error('用法：node tools/bump-version.mjs <x.y.z>')
  process.exit(1)
}

const root = 'C:/harness/whale-chan'
const files = [`${root}/package.json`, `${root}/ide/vscode/package.json`]
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  j.version = next
  fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`)
  console.log(`${f} → ${next}`)
}

const app = `${root}/src/version.mjs`
const src = fs.readFileSync(app, 'utf8')
if (!/export const VERSION = '[^']*'/.test(src)) {
  console.error('src/version.mjs 里没找到 VERSION，没改动')
  process.exit(1)
}
fs.writeFileSync(app, src.replace(/export const VERSION = '[^']*'/, `export const VERSION = '${next}'`))
console.log(`${app} → ${next}`)
