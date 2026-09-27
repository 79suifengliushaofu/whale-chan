// 遗留问题体检 —— 一次性把所有「可能没收拾干净」的地方列出来。
//
// 用 node 跑（PowerShell 读 UTF-8 会乱码，且正则转义很容易出错）：
//   node tools/audit.mjs

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(ROOT, 'whale-chan')
const problems = []
const notes = []

function read(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}
function readJson(p) {
  const t = read(p)
  if (!t) return null
  try { return JSON.parse(t.replace(/^\uFEFF/, '')) } catch (e) { problems.push(`${p} 不是合法 JSON：${e.message}`); return null }
}
function line(msg) { console.log(msg) }
function section(t) { console.log(`\n${'─'.repeat(60)}\n${t}\n${'─'.repeat(60)}`) }

// ── 1. 版本号一致性 ──────────────────────────────────────────────
section('1. 版本号一致性')
const pkg = readJson(path.join(APP, 'package.json'))
const vsc = readJson(path.join(APP, 'ide', 'vscode', 'package.json'))
const versionSrc = read(path.join(APP, 'src', 'version.mjs'))
const m = versionSrc && versionSrc.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)
const versions = {
  'whale-chan/package.json': pkg?.version,
  'whale-chan/ide/vscode/package.json': vsc?.version,
  'whale-chan/src/version.mjs': m ? m[1] : null,
}
for (const [k, v] of Object.entries(versions)) line(`  ${v ? '✓' : '✗'} ${k.padEnd(38)} ${v || '读不到'}`)
const uniq = new Set(Object.values(versions).filter(Boolean))
if (uniq.size > 1) problems.push(`版本号不一致：${JSON.stringify(versions)}`)
else if (uniq.size === 1) line(`  → 全部一致：${[...uniq][0]}`)

const changelog = read(path.join(APP, 'ide', 'vscode', 'CHANGELOG.md')) || ''
const topEntry = (changelog.match(/^##\s+(.+)$/m) || [])[1]
line(`  CHANGELOG 最新条目：${topEntry || '（没有）'}`)
if (topEntry && !topEntry.includes([...uniq][0])) problems.push(`CHANGELOG 最新条目「${topEntry}」跟版本号 ${[...uniq][0]} 对不上`)

// ── 2. 已装副本的版本 ────────────────────────────────────────────
section('2. 已装副本')
function versionOf(dir) {
  const t = read(path.join(dir, 'src', 'version.mjs')) || read(path.join(dir, 'vendor', 'whale-chan', 'src', 'version.mjs'))
  const r = t && t.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)
  return r ? r[1] : null
}
const copies = {
  '便携版 C:\\harness\\portable\\whale-chan-usb': path.join(ROOT, 'portable', 'whale-chan-usb', 'whale-chan'),
  '全局安装 LOCALAPPDATA\\Programs\\whale-chan': path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'whale-chan'),
  '源码 C:\\harness\\whale-chan': APP,
}
const expected = [...uniq][0]
for (const [label, dir] of Object.entries(copies)) {
  const v = versionOf(dir)
  const ok = v === expected
  if (!ok) problems.push(`${label} 是 ${v || '读不到'}，源码是 ${expected}`)
  line(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${v || '读不到'}`)
}
const extRoot = path.join(os.homedir(), '.vscode', 'extensions')
if (fs.existsSync(extRoot)) {
  const exts = fs.readdirSync(extRoot).filter((d) => d.startsWith('whale-chan.whale-chan-terminal-'))
  const newest = exts.map((d) => ({ d, v: versionOf(path.join(extRoot, d)) })).filter((x) => x.v)
  newest.sort((a, b) => a.v.localeCompare(b.v, undefined, { numeric: true }))
  const latest = newest[newest.length - 1]
  const ok = latest && latest.v === expected
  if (!ok) problems.push(`VS Code 扩展最新的装的是 ${latest?.v || '无'}，源码是 ${expected}`)
  line(`  ${ok ? '✓' : '✗'} VS Code 扩展（最新）`.padEnd(54) + `${latest?.v || '无'}`)
  line(`      装了 ${exts.length} 个历史版本目录${exts.length > 3 ? '（可清理）' : ''}`)
}

// ── 3. 构建产物 ─────────────────────────────────────────────────
section('3. whale-chan-dist 里的产物')
const dist = path.join(ROOT, 'whale-chan-dist')
if (fs.existsSync(dist)) {
  for (const f of fs.readdirSync(dist).sort()) {
    const st = fs.statSync(path.join(dist, f))
    const stale = /\.vsix$/.test(f) && !f.includes(expected)
    if (stale) notes.push(`旧 vsix 还留着：${f}（可删）`)
    line(`  ${stale ? '·' : ' '} ${(st.size / 1024).toFixed(1).padStart(9)} KB  ${f}${stale ? '   ← 旧版本' : ''}`)
  }
} else {
  problems.push('whale-chan-dist 不存在')
}

// ── 4. 自己代码里的 TODO / FIXME ─────────────────────────────────
section('4. 自己代码里的 TODO / FIXME（跳过 node_modules）')
const ownDirs = [path.join(APP, 'src'), path.join(APP, 'bin'), path.join(ROOT, 'tools')]
const hits = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!/\.(mjs|js|cjs)$/.test(e.name)) continue
    const t = read(p)
    if (!t) continue
    t.split(/\r?\n/).forEach((l, i) => {
      if (/(TODO|FIXME|XXX|HACK)/.test(l)) hits.push(`${path.relative(ROOT, p)}:${i + 1}  ${l.trim()}`)
    })
  }
}
for (const d of ownDirs) if (fs.existsSync(d)) walk(d)
if (hits.length) hits.forEach((h) => line(`  · ${h}`))
else line('  无')

// ── 5. 记忆/状态健康 ────────────────────────────────────────────
section('5. 记忆目录')
const memDir = path.join(os.homedir(), '.dsh', 'whale-chan')
if (fs.existsSync(memDir)) {
  for (const f of fs.readdirSync(memDir)) {
    const st = fs.statSync(path.join(memDir, f))
    line(`  ${(st.size / 1024).toFixed(1).padStart(10)} KB  ${f}   （改于 ${st.mtime.toISOString().slice(0, 19)}）`)
  }
  const st = readJson(path.join(memDir, 'state.json'))
  if (st) {
    const hasByCwd = st.byCwd && typeof st.byCwd === 'object'
    line(`  ${hasByCwd ? '✓' : '✗'} state.json 有 byCwd（按目录记会话）`)
    if (!hasByCwd) problems.push('state.json 还停在旧格式（没有 byCwd）—— 老版本的跨目录 bug 会复发')
    if (hasByCwd) line(`     记了 ${Object.keys(st.byCwd).length} 个目录：${Object.keys(st.byCwd).join('、')}`)
  }
} else {
  notes.push('还没有记忆目录（没跑过？）')
}

// ── 6. 未提交改动 ───────────────────────────────────────────────
section('6. 未提交改动')
try {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  const lines = status.split(/\r?\n/).filter(Boolean)
  const dels = lines.filter((l) => /^(D|.D)/.test(l.trim().slice(0, 2)))
  const mods = lines.filter((l) => /^ ?M/.test(l))
  const untracked = lines.filter((l) => l.startsWith('??'))
  line(`  修改 ${mods.length} / 删除 ${dels.length} / 未跟踪 ${untracked.length}`)
  mods.forEach((l) => line(`   M  ${l.slice(3)}`))
  dels.forEach((l) => { problems.push(`有文件被删除且未提交：${l.slice(3)}`); line(`   D  ${l.slice(3)}`) })
  untracked.forEach((l) => line(`   ?? ${l.slice(3)}`))
  if (dels.length === 0) line('  ✓ 没有任何删除')
} catch (e) {
  problems.push(`git status 失败：${e.message}`)
}

// ── 7. 角色绘制方式（之前报过「太模糊」）────────────────────────
section('7. 角色绘制')
const appSrc = read(path.join(APP, 'src', 'app.mjs')) || ''
const spriteSrc = read(path.join(APP, 'src', 'sprite.mjs')) || ''
line(`  app.mjs 用 getQFrameFit : ${/getQFrameFit/.test(appSrc) ? '是' : '否'}`)
line(`  app.mjs 用 drawFrame    : ${/drawFrame/.test(appSrc) ? '是' : '否'}`)
line(`  sprite.mjs 有 scaleRegion: ${/function scaleRegion/.test(spriteSrc) ? '是（盒式降采样，缩太小会糊）' : '否'}`)
const atlas = path.join(APP, 'assets', 'whale-q.png')
if (fs.existsSync(atlas)) {
  const b = fs.readFileSync(atlas)
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
  line(`  assets/whale-q.png : ${w}x${h}（${(b.length / 1024).toFixed(1)} KB）`)
} else {
  problems.push('assets/whale-q.png 不存在 —— Q 版表情图集丢了')
}

// ── 结论 ────────────────────────────────────────────────────────
section('结论')
if (problems.length === 0) line('  ✓ 没有发现遗留问题')
else { line(`  ✗ ${problems.length} 个要处理的：`); problems.forEach((p, i) => line(`   ${i + 1}. ${p}`)) }
if (notes.length) { line(''); line('  顺手可以做的：'); notes.forEach((n) => line(`   · ${n}`)) }
console.log('')
