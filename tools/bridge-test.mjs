// 桥（--bridge）的端到端自测：起一个桥进程，发一条 ask，把事件流打出来。
//   node tools/bridge-test.mjs ["任务文本"]
//
// 只打印事件的「骨架」——卡片里的 base64 会换成 <png N KB>，否则刷屏。

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const task = process.argv[2] || '用 pwsh 列出 C:/harness/demo-project 下的文件，一句话报告文件数。'
const CLI = 'C:/harness/whale-chan/bin/whalechan.mjs'
// 记忆目录指到临时目录：这个自测会发「摸摸头」，也就是真的会改好感度 ——
// 不能拿主人自己那份形象卡做实验。
const scratch = mkdtempSync(join(tmpdir(), 'whale-bridge-'))

const child = spawn(process.execPath, [CLI, '--bridge', '--cwd', 'C:/harness/demo-project', '--memory-dir', scratch], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, DSH_PERMISSION_MODE: 'danger-full-access' },
})

const seen = new Map()
let buffer = ''
let finished = false

function log(payload) {
  const kind = payload.type
  seen.set(kind, (seen.get(kind) || 0) + 1)
  const copy = { ...payload }
  if (copy.png) copy.png = `<png ${Math.round(copy.png.length / 1024)} KB base64>`
  if (copy.result && copy.result.length > 160) copy.result = `${copy.result.slice(0, 160)}…`
  if (copy.text && copy.text.length > 240) copy.text = `${copy.text.slice(0, 240)}…`
  console.log(JSON.stringify(copy))
}

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      console.log(`!! 非 JSON 行：${line}`)
      continue
    }
    log(payload)
    if (payload.type === 'done') {
      finished = true
      // 「摸摸头」现在是个复合动作：弹表情包 + 涨好感度（一分钟最多一次）。
      child.stdin.write(`${JSON.stringify({ type: 'pat' })}\n`)
      setTimeout(() => {
        const card = join(scratch, '形象卡.md')
        let favor = null
        try {
          favor = /"favor"\s*:\s*(\d+)/.exec(readFileSync(card, 'utf8'))
        } catch {
          /* 没有卡就算了 */
        }
        console.log(`\n摸摸头之后卡里的好感度：${favor ? favor[1] : '（读不到）'}（${card}）`)
        console.log(`事件统计：${[...seen.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`)
        child.stdin.end()
        child.kill()
        process.exit(payload.ok ? 0 : 1)
      }, 2500)
    }
  }
})

child.stdin.write(`${JSON.stringify({ type: 'ping' })}\n`)
child.stdin.write(`${JSON.stringify({ type: 'ask', text: task })}\n`)

setTimeout(() => {
  if (finished) return
  console.log('超时：90 秒内没收到 done')
  child.kill()
  process.exit(1)
}, 90000)
