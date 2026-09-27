// 便携版验收：把本机凭据喂给 U 盘目录里的那份鲸鱼娘，看它能不能独立跑通。
//
// 只打印结果，**不打印密钥**。
//
// 用法：node tools/usb/test-portable.mjs <便携目录>

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('用法：node tools/usb/test-portable.mjs <便携目录>')
  process.exit(2)
}

/** 从 ~/.dsh/.credentials.yaml 里取出 DeepSeek 密钥。取不到返回 ''。 */
function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  if (!fs.existsSync(file)) return ''
  const doc = fs.readFileSync(file, 'utf8')
  const m = doc.match(/DEEPSEEK_API_KEY:\s*(\S+)/)
  if (!m) return ''
  const ref = m[1].trim()
  // refs 里可能直接就是密钥，也可能是个记录 id —— 是 id 就顺 records 查。
  if (/^(sk|Bearer)/.test(ref) || ref.length > 20) return ref
  const re = new RegExp(`${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?secret:\\s*(\\S+)`)
  const r = doc.match(re)
  return r ? r[1].trim() : ''
}

const key = readKey()
console.log(`  凭据          = ${key ? `找到了（${key.length} 字符，不外显）` : '没找到'}`)

const launcher = path.join(root, 'whalechan.cmd')
const dataDir = path.join(root, 'data')

console.log(`  便携目录      = ${root}`)
console.log(`  自带 node     = ${fs.existsSync(path.join(root, 'node', 'node.exe'))}`)
console.log(`  自带 dsh      = ${fs.existsSync(path.join(root, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))}`)
console.log(`  DSH_HOME 先清空 → ${dataDir}`)
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })

// 故意**不带**任何本机的 node/dsh 进 PATH：把 PATH 剥到只剩系统目录，
// 证明它真的只靠 U 盘里那份跑起来。
const barePath = (process.env.Path || '').split(';').filter((p) => p && !/nodejs|npm/i.test(p)).join(';')

console.log('\n  ── 开跑（PATH 里已剔除本机的 node / npm）──\n')

const child = spawn(launcher, ['--once', '只回一句：你好'], {
  cwd: root,
  shell: true,
  env: {
    ...process.env,
    Path: barePath,
    DEEPSEEK_API_KEY: key,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
let err = ''
child.stdout.on('data', (c) => (out += c))
child.stderr.on('data', (c) => (err += c))
child.on('close', (code) => {
  console.log(`  退出码        = ${code}`)
  console.log(`  回复          = ${JSON.stringify(out.trim().slice(0, 200))}`)
  if (err.trim()) console.log(`  stderr(尾)    = ${JSON.stringify(err.trim().slice(-400))}`)
  const ok = code === 0 && out.trim().length > 0
  console.log(`\n  ${ok ? '✓ 便携版能独立跑通' : '✗ 没跑通'}`)
  process.exit(ok ? 0 : 1)
})
