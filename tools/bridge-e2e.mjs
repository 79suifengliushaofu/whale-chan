// 端到端：跨目录的旧 state.json 不该再让智能体退出（code 1）。
//
// 真事：用户在 A 项目聊过，换到 B 目录打开，第一句话 → 「✗ 智能体退出（code 1）」。
// 因为 dsh 拒绝续接别的目录记下的 session，而旧版 whale-chan 只存一个全局 sessionId。
//
// 用法：node tools/bridge-e2e.mjs <memoryDir> <cwd>

import { spawn } from 'node:child_process'
import path from 'node:path'

const [, , memoryDir, cwd] = process.argv
const repo = path.resolve(import.meta.dirname, '..')
const cli = path.join(repo, 'whale-chan', 'bin', 'whalechan.mjs')

const child = spawn(process.execPath, [cli, '--bridge', '--memory-dir', memoryDir], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DSH_PERMISSION_MODE: 'danger-full-access' },
})

let sawMismatchError = false
let hello = null
let finalText = ''
let done = false
let stderr = ''

let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim()
    buffer = buffer.slice(i + 1)
    if (!line) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type === 'hello') hello = ev
    if (ev.type === 'error' && /was recorded in/i.test(String(ev.message || ''))) sawMismatchError = true
    if (ev.type === 'text' && ev.text) finalText += ev.text
    if (ev.type === 'done') done = true
  }
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', (c) => {
  stderr += c
})

setTimeout(() => child.stdin.write(`${JSON.stringify({ type: 'ask', text: '只回一句：你好' })}\n`), 400)

const deadline = setTimeout(() => {
  child.kill()
}, 240000)

child.on('close', (code) => {
  clearTimeout(deadline)
  console.log(`\n  启动时 sessionId = ${JSON.stringify(hello && hello.sessionId)}`)
  console.log(`  收到跨目录报错   = ${sawMismatchError}`)
  console.log(`  done 事件        = ${done}`)
  console.log(`  回复             = ${JSON.stringify(finalText.slice(0, 80))}`)
  if (stderr.trim()) console.log(`  stderr(尾)       = ${JSON.stringify(stderr.trim().slice(-300))}`)
  const bad = sawMismatchError || /was recorded in/.test(stderr)
  const ok = !bad && done && finalText.trim().length > 0
  console.log(`\n  ${ok ? '✓ 通过' : '✗ 失败'}（桥退出码 ${code}）`)
  process.exit(ok ? 0 : 1)
})
