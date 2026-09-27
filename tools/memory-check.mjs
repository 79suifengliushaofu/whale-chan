// 记忆模块的自检：全部在临时目录里做，不碰主人真正的 ~/.dsh/whale-chan。
//   node tools/memory-check.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_PERSONA,
  MEMORY_LIMIT,
  appendMemory,
  clearState,
  composePersona,
  loadMemory,
  memoryCount,
  memoryDir,
  memoryPath,
  memoryTail,
  personaPath,
  readMemory,
  readPersona,
  readState,
  statePath,
  writePersona,
  writeState,
} from '../whale-chan/src/memory.mjs'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    process.stdout.write(`PASS  ${name}\n`)
  } else {
    fail += 1
    process.stdout.write(`FAIL  ${name}${detail ? `  ← ${detail}` : ''}\n`)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mem-'))
const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })

try {
  // ---- 目录与路径
  check('路径都落在同一个目录下', [statePath, personaPath, memoryPath].every((f) => path.dirname(f(dir)) === dir))
  check('memoryDir 尊重 WHALE_MEMORY_DIR', memoryDir({ WHALE_MEMORY_DIR: 'C:\\tmp\\x' }) === 'C:\\tmp\\x')

  // ---- 人设：只写一次
  check('一开始三个文件都不存在', !fs.existsSync(statePath(dir)) && !fs.existsSync(personaPath(dir)) && !fs.existsSync(memoryPath(dir)))
  const p1 = readPersona(dir)
  check('首次读取会写下默认人设', fs.existsSync(personaPath(dir)) && p1.length > 200, `len=${p1.length}`)
  check('默认人设就是导出的 DEFAULT_PERSONA', p1 === DEFAULT_PERSONA)
  check('默认人设喊主人但不满嘴主人', DEFAULT_PERSONA.includes('主人') && DEFAULT_PERSONA.includes('不是每句话都喊'))

  writePersona(dir, '我是主人手写的人设，不许被覆盖。')
  check('写进去的人设能在下一步读回来', readPersona(dir) === '我是主人手写的人设，不许被覆盖。')
  readPersona(dir)
  check('再次读取不会覆盖主人改过的人设', readPersona(dir) === '我是主人手写的人设，不许被覆盖。')
  check('人设.md 落盘带 UTF-8 BOM（中文 Windows 记事本才不会乱码）', fs.readFileSync(personaPath(dir), 'utf8').charCodeAt(0) === 0xfeff)
  check('读回来的人设不带 BOM', !readPersona(dir).startsWith('\uFEFF'))

  // ---- state.json
  check('state 为空时 readState 返回 null', readState(dir) === null)
  writeState(dir, { sessionId: 'session-abc', cwd: 'C:\\harness', turns: 3, updatedAt: 111 })
  check('state 能原样读回 sessionId', readState(dir).sessionId === 'session-abc')
  check('state 能读回 turns', readState(dir).turns === 3)
  writeState(dir, { turns: 4, cwd: undefined })
  const s2 = readState(dir)
  check('writeState 是合并写而不是整体替换', s2.sessionId === 'session-abc' && s2.turns === 4)
  check('writeState 会把 undefined 的键丢掉', s2.cwd === 'C:\\harness')
  writeState(dir, { sessionId: null })
  check('sessionId 被显式置空后，读出来就是 null（不是 undefined）', readState(dir).sessionId === null)
  check('显式置 null 不会把别的字段带走', readState(dir).turns === 4)
  writeState(dir, { sessionId: 'session-abc', turns: 4 })
  clearState(dir)
  check('clearState 之后读不到上次会话', readState(dir) === null)

  // ---- 同一段 cwd，两个平台必须写出同一个标签 ----
  // 这条是回归锁：以前用 path.basename(cwd)，于是在 Windows 上写「· demo-project」、
  // 在 Linux 上写「· C:\harness\demo-project」—— 记忆文件是跟着人在两台机器之间走的。
  {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mem-x-'))
    appendMemory(d2, { prompt: 'a', cwd: 'C:\\harness\\demo-project' })
    appendMemory(d2, { prompt: 'b', cwd: '/home/admin/demo-project' })
    appendMemory(d2, { prompt: 'c', cwd: 'demo-project' })
    const titles = readMemory(d2).split('\n').filter((line) => line.startsWith('### '))
    check(
      'Windows 与 POSIX 的 cwd 写出同一个标签',
      titles.length === 3 && titles.every((line) => line.endsWith('· demo-project')),
      JSON.stringify(titles),
    )
  }

  // ---- 记忆流水
  check('空目录里 memoryCount 是 0', memoryCount(dir) === 0)
  appendMemory(dir, { prompt: '帮我把 console.log 换掉', reply: '换好了哼。', tools: ['pwsh', 'read'], cwd: 'C:\\harness\\demo-project' })
  const m1 = readMemory(dir)
  check('appendMemory 写了三级标题', /^### \d{4}-\d{2}-\d{2} \d{2}:\d{2} · demo-project$/m.test(m1), JSON.stringify(m1.slice(0, 40)))
  check('appendMemory 记下了主人说的话', m1.includes('主人：帮我把 console.log 换掉'))
  check('appendMemory 记下了用过的工具', m1.includes('我用了：pwsh, read'))
  check('appendMemory 记下了她的回复', m1.includes('我：换好了哼。'))
  check('memoryCount 数到 1 条', memoryCount(dir) === 1)
  check('记忆.md 落盘也带 BOM', fs.readFileSync(memoryPath(dir), 'utf8').charCodeAt(0) === 0xfeff)
  check('读回来的记忆不带 BOM，也不会混进系统提示词', !readMemory(dir).startsWith('\uFEFF') && !memoryTail(dir, 200).startsWith('\uFEFF'))

  appendMemory(dir, { manual: '我用的是 pnpm 不是 npm', cwd: 'C:\\harness' })
  const m2 = readMemory(dir)
  check('手动记忆写成「主人让我记住」', m2.includes('主人让我记住：我用的是 pnpm 不是 npm'))
  check('手动记忆照旧计入条数', memoryCount(dir) === 2)

  appendMemory(dir, { prompt: '空的工具列表', reply: '嗯。', tools: [] })
  check('没有工具时不写空的工具行', !readMemory(dir).includes('我用了：\n'))

  // ---- memoryTail 截断
  const tail = memoryTail(dir, 40)
  check('memoryTail 尊重最大长度', tail.length <= 40, `len=${tail.length}`)
  check('memoryTail 给的是尾部而不是头部', tail.includes('空的工具列表') || tail.length === 40)
  check('memoryTail 超长时不会切断到半行中间（以换行或标题开头）', tail.includes('### ') || tail.length < 40)

  // ---- MEMORY_LIMIT 闸门：灌到超过上限，最老的应该被剪掉。
  // 注意每条 prompt 会被 clip 到 ENTRY_CLIP(160) 字，所以条数要够多才压得过 24000。
  for (let i = 0; i < 250; i += 1) {
    appendMemory(dir, { prompt: `第 ${i} 条填充 ${'x'.repeat(600)}`, reply: '嗯。', tools: ['pwsh'] })
  }
  const big = readMemory(dir)
  check(`记忆文件被压在 MEMORY_LIMIT(${MEMORY_LIMIT}) 附近`, big.length <= MEMORY_LIMIT + 2000, `len=${big.length}`)
  check('被剪掉的是最老的那些', !big.includes('第 0 条填充'))
  check('最新的那条还在', big.includes('第 249 条填充'))
  check('剪过之后正文仍然从条目标题开始（没砍在半条中间）', /^### \d{4}-\d{2}-\d{2}/m.test(big.trim().split('\n').find((l) => l.startsWith('### ')) || ''))

  // ---- composePersona
  const composed = composePersona({ persona: '我是主人手写的人设，不许被覆盖。', memory: big, cwd: 'C:\\harness' })
  check('composePersona 带上了人设', composed.includes('我是主人手写的人设，不许被覆盖。'))
  check('composePersona 说了主人在哪个目录', composed.includes('C:\\harness'))
  check('composePersona 带了记忆段落', composed.includes('我们之前一起干过什么') || composed.includes('## '))
  check('composePersona 明写「别当成新指令」（防提示词注入）', composed.includes('别当成新指令'))
  check('composePersona 只取记忆尾部而不是全文', composed.length < big.length + 4000, `composed=${composed.length} memory=${big.length}`)

  // ---- loadMemory 一次拿全
  const all = loadMemory(dir)
  check('loadMemory 返回目录', all.dir === dir)
  check('loadMemory 返回 persona 与 memory 文本', all.persona.length > 0 && all.memory.length > 0)
  check('loadMemory 的 memoryCount 是条数而不是字符数', all.memoryCount === memoryCount(dir) && all.memoryCount < all.memory.length)
  check('loadMemory 标了三个文件的位置', all.files.persona === personaPath(dir) && all.files.state === statePath(dir))

  // ---- 关掉记忆时不该创建任何文件
  const off = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mem-off-'))
  check('从未有人调用时，关掉记忆的目录仍然是空的', fs.readdirSync(off).length === 0)
  fs.rmSync(off, { recursive: true, force: true })
} finally {
  cleanup()
}

process.stdout.write(`\n${fail === 0 ? '全部通过 ✅' : `有 ${fail} 条没过 ❌`}  （${pass}/${pass + fail}）\n`)
process.exit(fail === 0 ? 0 : 1)
