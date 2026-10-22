// 把 kb/notes-*.mjs 里的知识点生成 Obsidian 知识库
//
//   node kb/build.mjs            生成到 Obsidian Vault
//   node kb/build.mjs --out DIR  生成到指定目录（调试用）
//
// 产物：
//   <模块目录>/<笔记标题>.md     一条知识点一个文件
//   <模块目录>/<模块名>.canvas   本模块的网状图谱
//   知识地图.canvas              六大模块总览
//   使用说明.md                  怎么用这个库
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { MODULES, NOTES_A } from './notes-a.mjs'
import { NOTES_B } from './notes-b.mjs'
import { NOTES_C, NOTES_D } from './notes-c.mjs'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const VAULT = outArg >= 0
  ? path.resolve(args[outArg + 1])
  : 'C:/Users/admin/Documents/Obsidian Vault/计算机网络知识库'

const ALL = [...NOTES_A, ...NOTES_B, ...NOTES_C, ...NOTES_D]
const TITLES = new Set(ALL.map((n) => n.t))

/** Obsidian / Windows 都不接受的字符 */
function safeName(t) {
  return t.replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim()
}

/** 正文里 [[X]] 引用了不存在的笔记 —— 收集起来最后统一报 */
const dangling = new Map()
function checkBody(note) {
  const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
  let m
  while ((m = re.exec(note.body))) {
    const target = m[1].trim()
    if (!TITLES.has(target)) {
      if (!dangling.has(target)) dangling.set(target, new Set())
      dangling.get(target).add(note.t)
    }
  }
}

/** 把 to[] 里不存在的目标剔掉，避免图谱画出悬空节点 */
function realLinks(note) {
  return (note.to || []).filter((t) => TITLES.has(t) && t !== note.t)
}

function frontmatter(note) {
  const tags = (note.tags || []).map((t) => (t.includes(' ') ? `"${t}"` : t))
  const lines = ['---']
  if (tags.length) lines.push(`tags:\n${tags.map((t) => `  - ${t}`).join('\n')}`)
  if (note.alias?.length) lines.push(`aliases:\n${note.alias.map((a) => `  - ${a}`).join('\n')}`)
  lines.push(`模块: ${note.mod === 0 ? '"索引"' : `"${MODULES[note.mod - 1].name}"`}`)
  lines.push('---')
  return lines.join('\n')
}

function moduleOf(note) {
  if (note.mod === 0) return '00 索引'
  const m = MODULES[note.mod - 1]
  return m.dir
}

function relatedSection(note) {
  const links = realLinks(note)
  if (!links.length) return ''
  return `\n\n---\n\n## 相关\n\n${links.map((t) => `- [[${t}]]`).join('\n')}\n`
}

function writeNote(note) {
  const dir = path.join(VAULT, moduleOf(note))
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${safeName(note.t)}.md`)
  const body = `${frontmatter(note)}\n\n# ${note.t}\n\n${note.body.trim()}${relatedSection(note)}`
  writeFileSync(file, body, 'utf8')
  return file
}

// ---------- Canvas（JSON Canvas 1.0） ----------
function canvasGraph(notes, title) {
  const byMod = new Map()
  for (const n of notes) {
    const k = n.mod
    if (!byMod.has(k)) byMod.set(k, [])
    byMod.get(k).push(n)
  }

  const nodes = []
  const edges = []
  const COL_W = 460
  const ROW_H = 110
  const GAP_X = 200
  const GAP_Y = 40

  // 按模块分列摆开
  let col = 0
  for (const [mod, list] of [...byMod.entries()].sort((a, b) => a[0] - b[0])) {
    // 把 moc / index 排在列首
    const sorted = [...list].sort((a, b) => {
      const rank = (n) => (n.kind === 'moc' ? 0 : n.kind === 'index' ? 1 : 2)
      return rank(a) - rank(b)
    })
    sorted.forEach((n, i) => {
      nodes.push({
        id: n.id,
        type: 'file',
        file: `${moduleOf(n)}/${safeName(n.t)}.md`,
        x: col * (COL_W + GAP_X),
        y: i * (ROW_H + GAP_Y),
        width: COL_W,
        height: n.kind === 'moc' || n.kind === 'index' ? 90 : 70,
        color: n.kind === 'moc' ? '4' : n.kind === 'index' ? '3' : undefined,
      })
    })
    col++
  }

  const ids = new Set(nodes.map((n) => n.id))
  for (const n of notes) {
    for (const target of realLinks(n)) {
      const t = notes.find((x) => x.t === target)
      if (!t || !ids.has(t.id)) continue
      edges.push({
        id: `${n.id}->${t.id}`,
        fromNode: n.id,
        toNode: t.id,
        fromSide: 'right',
        toSide: 'left',
        color: '2',
      })
    }
  }

  // 边去重（A→B 和 B→A 都保留，但同向只留一条）
  const seen = new Set()
  const uniq = edges.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  return { title, canvas: JSON.stringify({ nodes, edges: uniq }, null, 2) }
}

// ---------- 主流程 ----------
console.log(`输出目录：${VAULT}`)
for (const n of ALL) checkBody(n)

rmSync(path.join(VAULT, '00 索引'), { recursive: true, force: true })
for (const m of MODULES) {
  rmSync(path.join(VAULT, m.dir), { recursive: true, force: true })
}

let count = 0
for (const n of ALL) {
  writeNote(n)
  count++
}

// 每个模块画一张图
for (const m of MODULES) {
  const list = ALL.filter((n) => n.mod === m.n)
  if (!list.length) continue
  const dir = path.join(VAULT, m.dir)
  mkdirSync(dir, { recursive: true })
  const { canvas } = canvasGraph(list, m.name)
  writeFileSync(path.join(dir, `${safeName(m.name)}.canvas`), canvas, 'utf8')
}

// 总览图：六个模块的 MOC + 索引
const overview = ALL.filter((n) => n.kind === 'moc' || n.kind === 'index')
{
  const { canvas } = canvasGraph(
    overview.map((n) => ({ ...n, mod: n.kind === 'index' ? 0 : n.mod })),
    '知识地图',
  )
  writeFileSync(path.join(VAULT, '知识地图.canvas'), canvas, 'utf8')
  // 索引类也放 00 索引
  mkdirSync(path.join(VAULT, '00 索引'), { recursive: true })
}

// 使用说明
const totalLinks = ALL.reduce((s, n) => s + realLinks(n).length, 0)
writeFileSync(path.join(VAULT, '使用说明.md'), `---
tags:
  - 索引
---

# 使用说明

${count} 条知识点笔记，${totalLinks} 条双链。

## 怎么打开

用 Obsidian 打开 \`${path.dirname(path.dirname(VAULT)).replace(/\\\\/g, '/')}\` 这个 vault，左边文件树里会多出 \`计算机网络知识库\`。

## 怎么逛

| 入口 | 用途 |
| --- | --- |
| [[计算机基础知识库]] | 总目录，从这里进最稳 |
| [[学习路线]] | 按顺序学 |
| [[知识地图]] | 六模块全景 |
| \`知识地图.canvas\` | **可拖拽的网状图谱** |
| [[概念索引]] | 查名词 |
| [[易混点辨析]] | 考前突击 |
| [[公式与计算]] | 计算题 |
| [[术语表]] | 英文缩写 |

## 怎么用「网状」

1. **反向链接面板**（右侧）：每篇笔记底部会自动列出「谁引用了我」——这是 Obsidian 最有价值的功能，顺着它能发现你没想到的联系。
2. **图谱视图**（左侧 \`Ctrl+G\`）：全局连线图，能看出哪个知识点是枢纽。
3. **Canvas**：每个模块目录里都有一张 \`.canvas\`，节点可以直接拖动、缩放、双击进入笔记。
4. **搜索**：\`Ctrl+O\` 快速打开，\`Ctrl+Shift+F\` 全文搜索。

## 建议的用法

- 先读模块的 **MOC**（比如 [[网络与通信]]），再往下钻单篇。
- 每读完一篇，点开底部「相关」里的链接，**不要按目录顺序读**——网状知识库的价值就在跳转。
- 考前只看 [[易混点辨析]] 和 [[公式与计算]]。

## 怎么改

笔记是纯 Markdown，直接用编辑器改。想新增一条，在同目录建个 \`.md\`，正文里写 \`[[已有笔记标题]]\` 就自动连上。
`, 'utf8')

// ---------- 校验 ----------
console.log(`\n生成 ${count} 条笔记，${totalLinks} 条双链`)
if (dangling.size) {
  console.log(`\n⚠️  正文里有 ${dangling.size} 个指向不存在笔记的链接：`)
  for (const [target, from] of [...dangling.entries()].sort()) {
    console.log(`   [[${target}]]  ← ${[...from].join('、')}`)
  }
} else {
  console.log('✅ 所有 [[双链]] 都能解析')
}

// 列出实际文件
let files = 0
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name))
    else files++
  }
}
walk(VAULT)
console.log(`✅ 共写出 ${files} 个文件到 ${VAULT}`)
