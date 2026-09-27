// 智能体后端：调用本机的 DeepSeek Harness (dsh) headless 应用。
// 这样鲸鱼娘用的是和 DSH 完全相同的智能体 —— 同一套工具（读写文件、跑命令、上网、子代理…），
// 因此「智能体能做的任何事」=「用户在 IDE 终端里能做的任何事」。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SHIM_ORDER_WIN = ['.cmd', '.exe', '.bat', '']

/** 找到 dsh。优先直接跑 lib/bin.js（用 node 启动），避免 Windows 上 .cmd 的引号问题。 */
export function resolveDsh() {
  const explicit = process.env.DSH_BIN
  if (explicit && fs.existsSync(explicit)) {
    return { command: process.execPath, args: [explicit], label: explicit, shell: false }
  }
  const exts = process.platform === 'win32' ? SHIM_ORDER_WIN : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const shim = path.join(dir, `dsh${ext}`)
      if (!fs.existsSync(shim)) continue
      for (const root of [dir, path.resolve(dir, '..')]) {
        const binJs = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        if (fs.existsSync(binJs)) {
          return { command: process.execPath, args: [binJs], label: binJs, shell: false }
        }
      }
      return { command: shim, args: [], label: shim, shell: process.platform === 'win32' }
    }
  }
  return { command: 'dsh', args: [], label: 'dsh (PATH)', shell: process.platform === 'win32' }
}

export function dshAvailable() {
  const resolved = resolveDsh()
  if (resolved.label === 'dsh (PATH)') return true
  return fs.existsSync(resolved.label)
}

/**
 * 一次对话回合。事件流是 NDJSON（dsh headless --json），逐行解析。
 */
export class HarnessAgent {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd()
    this.profile = options.profile || process.env.WHALE_PROFILE || 'headless'
    this.permission = options.permission || process.env.WHALE_PERMISSION || 'danger-full-access'
    this.sessionId = options.sessionId || null
    this.dsh = options.dsh || resolveDsh()
    // 推理强度靠 profile patch 传（见 src/effort.mjs），这里只负责挂上去。
    this.patch = options.patch || null
    this.child = null
    this.lastStderr = ''
  }

  get label() {
    return `dsh ${this.profile}`
  }

  get running() {
    return Boolean(this.child)
  }

  cancel() {
    if (!this.child) return false
    const child = this.child
    this.child = null
    try {
      child.kill()
    } catch {
      /* 已经退出了 */
    }
    return true
  }

  /**
   * @param {string} prompt
   * @param {{onEvent?:(e:any)=>void,onStderr?:(s:string)=>void,onDone?:(r:any)=>void}} handlers
   */
  run(prompt, handlers = {}) {
    const { onEvent, onStderr, onDone } = handlers
    // ⚠️ 顺序有讲究：`--patch` 是 dsh 的**核心**选项，必须在应用自己的选项
    // （`--json`）**之前**。写成 `--json --patch x` 会被应用当成自己的参数，
    // 直接报 `unknown option '--patch'` 然后什么都不干。
    const args = [...this.dsh.args, '--profile', this.profile]
    if (this.patch) args.push('--patch', this.patch)
    args.push('--json')
    if (this.sessionId) args.push('--session-id', this.sessionId)
    // 不给任务参数：headless 就会从 stdin 读取任务，任何内容（含引号、换行）都安全。

    let child
    try {
      child = spawn(this.dsh.command, args, {
        cwd: this.cwd,
        shell: this.dsh.shell || false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // 关键：headless 没有审批通道，只有 danger-full-access 才会 approval=never，
          // 否则任何要写文件 / 跑命令的工具都会 fail closed。
          DSH_PERMISSION_MODE: this.permission,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      })
    } catch (error) {
      onDone?.({ ok: false, error: error.message, text: '', stderr: '' })
      return null
    }

    this.child = child
    this.lastStderr = ''
    let buffer = ''
    let finalText = ''
    let sawEvent = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        sawEvent = true
        if (event.type === 'session' && event.sessionId) this.sessionId = event.sessionId
        if (event.type === 'final' && typeof event.text === 'string') finalText = event.text
        onEvent?.(event)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.lastStderr += chunk
      onStderr?.(chunk)
    })

    child.on('error', (error) => {
      this.child = null
      onDone?.({ ok: false, error: error.message, text: finalText, stderr: this.lastStderr })
    })

    child.on('close', (code) => {
      this.child = null
      const tail = buffer.trim()
      if (tail) {
        try {
          const event = JSON.parse(tail)
          if (event.type === 'session' && event.sessionId) this.sessionId = event.sessionId
          if (event.type === 'final' && typeof event.text === 'string') finalText = event.text
          onEvent?.(event)
          sawEvent = true
        } catch {
          /* 半行数据，忽略 */
        }
      }
      onDone?.({ ok: code === 0, code, text: finalText, stderr: this.lastStderr, sawEvent })
    })

    child.stdin.on('error', () => {
      /* 子进程可能提前退出 */
    })
    child.stdin.end(`${prompt}\n`)

    return child
  }
}

/** headless 的 NDJSON 事件 → 一行人类可读的「工具动作」描述（尽力而为，字段名做兼容）。 */
export function describeToolEvent(event) {
  const name = event.name || event.tool || event.toolName || event.tool_name
  if (!name) return null
  const input = event.input || event.args || event.arguments || event.parameters || {}
  const detail = summarizeToolInput(name, input)
  return detail ? `${name}: ${detail}` : String(name)
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return typeof input === 'string' ? input : ''
  const interesting =
    input.command ??
    input.filePath ??
    input.file_path ??
    input.path ??
    input.pattern ??
    input.query ??
    input.url ??
    input.prompt ??
    input.description
  if (typeof interesting === 'string') return truncateOneLine(interesting, 92)
  const keys = Object.keys(input)
  if (!keys.length) return ''
  return truncateOneLine(JSON.stringify(input), 92)
}

function truncateOneLine(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
