// 便携版搬家测试：在任意目录里跑一句，看它还认不认路。
//
// 跟 test-portable.mjs 的区别：**不清空 data\**，所以能验证
// 「换目录 / 换盘符之后，原来的会话和记忆还在不在」。
//
// 用法：node tools/usb/run-portable.mjs <便携目录> "<要说的话>"

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [, , root, prompt] = process.argv
if (!root || !prompt) {
  console.error('用法：node tools/usb/run-portable.mjs <便携目录> "<要说的话>"')
  process.exit(2)
}

function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  if (!fs.existsSync(file)) return ''
  const doc = fs.readFileSync(file, 'utf8')
  const m = doc.match(/DEEPSEEK_API_KEY:\s*(\S+)/)
  if (!m) return ''
  const ref = m[1].trim()
  if (/^(sk|Bearer)/.test(ref) || ref.length > 20) return ref
  const re = new RegExp(`${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?secret:\\s*(\\S+)`)
  const r = doc.match(re)
  return r ? r[1].trim() : ''
}

const dataDir = path.join(root, 'data')
const stateFile = path.join(dataDir, 'whale-chan', 'state.json')

console.log(`  便携目录        = ${root}`)
console.log(`  state.json 存在 = ${fs.existsSync(stateFile)}`)
if (fs.existsSync(stateFile)) console.log(`  内容            = ${fs.readFileSync(stateFile, 'utf8').replace(/\s+/g, ' ')}`)

const barePath = (process.env.Path || '').split(';').filter((p) => p && !/nodejs|npm/i.test(p)).join(';')

const child = spawn(path.join(root, 'whalechan.cmd'), ['--once', prompt], {
  cwd: root,
  shell: true,
  env: { ...process.env, Path: barePath, DEEPSEEK_API_KEY: readKey() },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
let err = ''
child.stdout.on('data', (c) => (out += c))
child.stderr.on('data', (c) => (err += c))
child.on('close', (code) => {
  console.log(`  退出码          = ${code}`)
  console.log(`  回复            = ${JSON.stringify(out.trim().slice(0, 200))}`)
  if (err.trim() && !/用 headless 后端执行任务/.test(err)) {
    console.log(`  stderr          = ${JSON.stringify(err.trim().slice(-300))}`)
  }
  console.log(`\n  ${code === 0 && out.trim() ? '✓ 通了' : '✗ 没通'}`)
  process.exit(code === 0 && out.trim() ? 0 : 1)
})
