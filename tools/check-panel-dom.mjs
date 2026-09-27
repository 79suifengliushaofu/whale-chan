// 检查 panel.js 要的 DOM 节点在真实 Webview 里都存在。
//
// 为什么要这个：Webview 里 `getElementById()` 返回 null 之后，
// 如果那个调用在 requestAnimationFrame 循环里，只表现为「不动了」，
// 控制台不打开的话根本看不出是缺 DOM。
//
//   node tools/check-panel-dom.mjs

import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = path.resolve(HERE, '..', 'whale-chan', 'ide', 'vscode')
const js = fs.readFileSync(path.join(ROOT, 'media', 'panel.js'), 'utf8')
const webview = fs.readFileSync(path.join(ROOT, 'webview.js'), 'utf8')
const preview = fs.readFileSync(path.join(HERE, 'panel-preview.mjs'), 'utf8')

const used = [...new Set([...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))].sort()
const has = (src, id) => new RegExp(`id=["']${id}["']`).test(src)

const missingWebview = used.filter((id) => !has(webview, id))
const missingPreview = used.filter((id) => !has(preview, id))

process.stdout.write(`panel.js 用到的 id：${used.join(', ')}\n`)
process.stdout.write(`createHtml 缺的：${missingWebview.join(', ') || '（无）'}\n`)
process.stdout.write(`预览 HTML 缺的：${missingPreview.join(', ') || '（无）'}\n`)

if (missingWebview.length) {
  process.stdout.write('\n❌ 真的 Webview 里会拿到 null，必须修 createHtml（或把 panel.js 里的取值判空）\n')
  process.exitCode = 1
} else {
  process.stdout.write('\n✅ panel.js 要的节点，createHtml 都提供了\n')
}

// --- 第二件事：两份手写的 HTML 会「文案漂移」 ---
//
// createHtml（webview.js）和预览（tools/panel-preview.mjs）是各写一遍的，
// 改了一处忘了另一处，截图和真机就对不上，而且谁都不会报错。
// 踩过一次：placeholder 只改了 createHtml，预览截图里还是旧的召唤语。
// 所以这里把「必须一致」的属性抽出来逐条比。
const ATTRS = ['placeholder', 'data-short']
function attrsOf(src, name) {
  return [...src.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1])
}

let drift = 0
for (const name of ATTRS) {
  const a = attrsOf(webview, name)
  const b = attrsOf(preview, name)
  if (JSON.stringify(a) === JSON.stringify(b)) {
    process.stdout.write(`✅ ${name} ${a.length} 处一致\n`)
    continue
  }
  drift++
  process.stdout.write(`❌ ${name} 漂移了\n  createHtml: ${JSON.stringify(a)}\n  预览 HTML : ${JSON.stringify(b)}\n`)
}
if (drift) process.exitCode = 1
