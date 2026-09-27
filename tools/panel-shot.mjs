// 用 headless Edge 给面板拍照。
//
// 为什么要套一层 iframe：headless Edge 的 --window-size 有最小宽度（实测 420 会被抬到 480），
// 所以「模拟 VS Code 窄面板」不能靠缩小窗口 —— 那样 max-width 媒体查询根本不会命中。
// 把 panel-preview.html 放进一个固定宽度的 iframe 里，iframe 自己的视口就是那个宽度，
// 媒体查询在里面按预期生效。
//
// 用法：node tools/panel-shot.mjs <输出png> <宽> <高> [dsf]

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', 'whale-chan-dist')
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
]

export function findEdge() {
  for (const candidate of EDGE_CANDIDATES) if (fs.existsSync(candidate)) return candidate
  return null
}

export function shoot({ out, width, height, dsf = 2, edge }) {
  const frame = path.join(DIST, 'panel-frame.html')
  const src = path.basename(out).includes('terminal') ? 'panel-preview.html' : 'panel-preview.html'
  fs.writeFileSync(
    frame,
    `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0b1120; font: 12px/1.6 -apple-system, "Segoe UI", sans-serif; }
  .cap {
    color: #6b7ba6;
    padding: 5px 10px;
    background: #0b1120;
    border-bottom: 1px solid #1d2a44;
  }
  iframe { width: ${width}px; height: ${height}px; border: 0; display: block; }
</style>
<div class="cap">离线预览 · 假后端 · 版式与 VS Code Webview 一致　（面板宽 ${width}px）</div>
<iframe src="${src}"></iframe>
`,
  )
  const userDataDir = path.join(os.tmpdir(), `whale-edge-${Date.now()}`)
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${userDataDir}`,
    `--force-device-scale-factor=${dsf}`,
    `--window-size=${width + 20},${height + 20}`,
    '--virtual-time-budget=4000',
    `--screenshot=${out}`,
    `file:///${frame.replace(/\\/g, '/')}`,
  ]
  const result = spawnSync(edge, args, { encoding: 'utf8' })
  const stderr = `${result.stderr || ''}${result.stdout || ''}`
  const wrote = /bytes written to file/i.test(stderr)
  fs.rmSync(userDataDir, { recursive: true, force: true })
  return { wrote, stderr }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, width, height, dsf] = process.argv.slice(2)
  if (!out || !width) {
    process.stdout.write('用法：node tools/panel-shot.mjs <输出png> <宽> <高> [dsf]\n')
    process.exit(1)
  }
  const edge = findEdge()
  if (!edge) {
    process.stdout.write('找不到 Edge/Chrome，拍不了。\n')
    process.exit(1)
  }
  const result = shoot({
    out: path.resolve(out),
    width: Number(width),
    height: Number(height || 900),
    dsf: Number(dsf || 2),
    edge,
  })
  process.stdout.write(result.wrote ? `${out}  ✓\n` : `${out}  ✗ 没写出来\n${result.stderr.slice(0, 900)}\n`)
  process.exit(result.wrote ? 0 : 1)
}
