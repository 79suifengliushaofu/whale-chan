#!/usr/bin/env node
// whale-chan —— 活在编译器终端里的鲸鱼娘，会聊天、也会替你动手。
//
//   whalechan                 在她的终端界面里开始对话
//   whalechan --demo          离线演示（不调用任何后端）
//   whalechan --once "任务"   只跑一次任务并打印结果
//   whalechan --screenshot    只渲染一帧纯文本界面（自检 / 截图）

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { WhaleApp } from '../src/app.mjs'
import { HarnessAgent, resolveDsh, dshAvailable } from '../src/agent.mjs'
import { DemoAgent } from '../src/demo.mjs'
import { seedBalance } from '../src/account.mjs'
import { resolveProfileDefaults, writeProfilePatch } from '../src/effort.mjs'

const HELP = `whale-chan —— 编译器终端里的鲸鱼娘智能体

用法：
  whalechan [选项]

选项：
  --demo                 离线演示模式，不调用真实后端（用来确认界面）
  --once <任务>          只执行一次任务，把结果打印到标准输出后退出
  --screenshot           渲染一帧纯文本界面并退出
  --cols <n>             截图宽度（默认 100）
  --rows <n>             截图高度（默认 30）
  --cwd <目录>           智能体的工作目录（默认当前目录）
  --profile <名称>       DeepSeek Harness profile（默认 headless）
  --permission <模式>    沙箱权限：read-only | workspace-write | danger-full-access
  --stickers <目录>      表情包目录（默认找 <工作目录>/表情包、~/表情包）
  --card <文件>          指定形象卡（一个人一份文件：状态/立绘/人设/记忆/日志）。
                         不指定就自动找 <工作目录>/形象卡.md → <记忆目录>/形象卡.md，
                         都没有就把发行包自带那张复制到记忆目录
  --no-card              不挂形象卡，退回旧的人设.md + 记忆.md
  --mouse                一进来就开鼠标摸头（代价：没法用鼠标框选复制文字）
  --effort <档位>        推理强度：off | low | high | max | default（默认 default）
  --no-balance           不去查 DeepSeek 余额（状态栏就不显示余额和峰谷）
  --no-memory            不读也不写记忆（人设和记忆.md 都不挂）
  --memory-dir <目录>    记忆放在哪（默认 ~/.dsh/whale-chan，环境变量 WHALE_MEMORY_DIR）
  --bridge               给 IDE 插件用的双向 NDJSON 后端（stdin 收命令、stdout 发事件）
  --help, -h             显示本帮助
  --version, -v          显示版本

对话中的命令：
  /help                  显示帮助
  /card [reload]         看形象卡在哪、她现在的状态、每轮带多少字
  /favor [+8|-3|45]      调好感度（只对有形象卡的她有效）
  /clear                 清空当前对话显示（记忆和会话历史不动）
  /new                   开一个新会话（不再续上次的历史，人设和记忆还在）
  /forget                忘掉上次的会话号，下次从零开始（人设和记忆不动）
  /memory                看旧机制那三个文件在哪（有形象卡时用 /card）
  /remember <内容>       让她把一件事记进记忆.md，下个回合就生效
  /mouse                 开关鼠标摸头（终端里拖拽框选会被吃掉，复制文字时先关掉）
  /sticker               立刻弹一张表情包气泡
  /effort <档位>         改推理强度（off / low / high / max / default）
  /balance               立刻重查余额和峰谷时段
  /quit                  退出

快捷键：
  Enter 发送 · Ctrl+C 取消当前回合（输入为空时退出）· Esc 取消当前回合
  PgUp / PgDn（或 ↑ / ↓）滚动对话
`

function parseArgs(argv) {
  const options = {
    demo: false,
    screenshot: false,
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    profile: 'headless',
    permission: 'danger-full-access',
    stickers: null,
    card: null,
    noCard: false,
    bridge: false,
    mouse: false,
    effort: 'default',
    balance: true,
    memory: true,
    memoryDir: null,
    once: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--demo') options.demo = true
    else if (arg === '--screenshot') options.screenshot = true
    else if (arg === '--card') options.card = argv[++i] ?? null
    else if (arg === '--no-card') options.noCard = true
    else if (arg === '--bridge') options.bridge = true
    else if (arg === '--mouse') options.mouse = true
    else if (arg === '--no-balance') options.balance = false
    else if (arg === '--no-memory') options.memory = false
    else if (arg === '--memory-dir') options.memoryDir = argv[++i] ?? null
    else if (arg === '--effort') options.effort = argv[++i] ?? 'default'
    else if (arg === '--once') options.once = argv[++i] ?? ''
    else if (arg === '--cols') options.cols = Number(argv[++i]) || 100
    else if (arg === '--rows') options.rows = Number(argv[++i]) || 30
    else if (arg === '--cwd') options.cwd = argv[++i] ?? process.cwd()
    else if (arg === '--stickers') options.stickers = argv[++i] ?? null
    else if (arg === '--profile') options.profile = argv[++i] ?? 'headless'
    else if (arg === '--permission') options.permission = argv[++i] ?? 'danger-full-access'
    else if (arg.startsWith('-')) {
      process.stderr.write(`whale-chan: 未知选项 ${arg}\n\n${HELP}`)
      process.exit(2)
    } else if (options.once === null) {
      options.once = arg
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  if (options.version) {
    const pkg = await import('../package.json', { with: { type: 'json' } })
    process.stdout.write(`${pkg.default.version}\n`)
    return
  }

  if (options.bridge) {
    const { runBridge } = await import('../src/bridge.mjs')
    runBridge(options)
    return
  }

  if (options.once !== null) return runOnce(options)

  if (!options.demo && !dshAvailable()) {
    process.stderr.write(
      'whale-chan: 找不到可用的 dsh 后端，先用 --demo 看看界面。\n' +
        '          安装：npm i -g @deepseek-ai/dsh\n',
    )
  }

  const agent = options.demo
    ? new DemoAgent({ cwd: options.cwd })
    : new HarnessAgent({
        cwd: options.cwd,
        profile: options.profile,
        permission: options.permission,
      })

  // 离线演示模式给个假余额，不然截图里那一段永远是空的。
  // 必须在构造 WhaleApp 之前——构造时就先把缓存读进 this.balance 了。
  if (options.demo) seedBalance({ ok: true, totalBalance: 2.06, currency: 'CNY', source: 'demo' })

  const app = new WhaleApp({
    agent,
    cwd: options.cwd,
    stickers: options.stickers,
    mouse: options.mouse,
    effort: options.effort,
    balance: options.balance,
    memory: options.memory,
    memoryDir: options.memoryDir,
    card: options.noCard ? 'off' : options.card,
    screenshotPath: options.screenshot ? '-' : null,
  })
  // 人设和记忆是挂在 profile patch 里的，必须在第一个回合之前挂上；
  // 截图/离线演示走同步路径，等不了那次 --dump-config。
  if (!options.demo && !options.screenshot) {
    await app.applyProfile({ effort: options.effort })
  }
  if (options.screenshot) {
    app.canvas.resize(options.cols, options.rows)
    app.noteStickerStatus()
    app.noteCardStatus()
    app.noteMemoryStatus(app.memory && app.memory.state)
    if (options.demo) {
      // 造一点对话内容，方便检查版式
      app.transcript.push({ kind: 'user', text: '帮我把 src/ 里所有 console.log 换成 logger' })
      app.transcript.push({
        kind: 'assistant',
        text: '好呀，我先看看有哪些文件。',
      })
      app.transcript.push({ kind: 'tool', text: 'pwsh · 搜索 console.log', status: 'ok' })
      app.transcript.push({ kind: 'tool-output', text: 'src/agent.mjs:42  src/app.mjs:118' })
      app.transcript.push({ kind: 'assistant', text: '找到两处，我改好了，顺便把 import 也补上了。' })
      app.setPhase('done')
    }
    // 注意：--card 现在是【形象卡】的路径，不再是「顺便渲染一张表情包」那个旧开关。
    if (options.stickerCard) app.showCard({ phase: app.phase })
    app.render()
    process.stdout.write(`${app.toPlainText()}\n`)
    return
  }

  app.start()
}

/**
 * 把「她是谁 + 推理强度」拼成一个 profile patch；--once 和交互模式共用同一份逻辑。
 *
 * 优先用形象卡（一个人一份文件）；没有卡才退回人设.md + 记忆.md 那套。
 */
async function profilePatchFor(options, agent) {
  const defaults = resolveProfileDefaults({ dsh: agent.dsh, profile: agent.profile })
  if (!defaults) return { patch: null, memory: null, card: null }
  const { memoryDir: defaultMemoryDir, loadMemory, composePersona } = await import('../src/memory.mjs')
  const { ensureCard, cardPrompt } = await import('../src/card.mjs')
  const memoryDir = options.memoryDir || defaultMemoryDir()

  const found = options.noCard
    ? { parsed: null, file: null, source: 'off' }
    : ensureCard({
        explicit: options.card || null,
        cwd: options.cwd,
        memoryDir: options.memory === false ? null : memoryDir,
      })
  const cardText = found.parsed ? cardPrompt(found.parsed) : ''
  const memory = options.memory === false ? null : loadMemory(memoryDir)

  const personaText = cardText || (memory ? composePersona({ persona: memory.persona, memory: memory.memory, cwd: options.cwd }) : '')
  const systemPrompt = personaText
    ? {
        personaPrefix: [defaults.systemPrompt.personaPrefix, personaText].filter(Boolean).join('\n\n'),
        personaSuffix: defaults.systemPrompt.personaSuffix || '',
      }
    : defaults.systemPrompt
  const patch = writeProfilePatch({ ...defaults.model, effort: options.effort, systemPrompt })
  return { patch, memory, card: found }
}

async function runOnce(options) {
  const agent = options.demo
    ? new DemoAgent({ cwd: options.cwd })
    : new HarnessAgent({
        cwd: options.cwd,
        profile: options.profile,
        permission: options.permission,
      })
  // --once 也要认 --effort 和人设，不然它们在命令行里像个假开关。
  let memory = null
  let card = null
  if (!options.demo) {
    try {
      const resolved = await profilePatchFor(options, agent)
      agent.patch = resolved.patch
      memory = resolved.memory
      card = resolved.card
    } catch (error) {
      process.stderr.write(`whale-chan: 人设/推理强度没设成：${error.message}\n`)
    }
  }
  const label = options.demo ? '演示' : 'headless'
  process.stderr.write(`whale-chan: 用 ${label} 后端执行任务…\n`)

  const tools = []
  let reply = ''
  const code = await new Promise((resolve) => {
    agent.run(options.once, {
      onEvent: (event) => {
        if (event.type === 'tool_call' && event.tool) {
          tools.push(event.tool)
          process.stderr.write(`  ⚙ ${event.tool}\n`)
        } else if (event.type === 'text' && event.text) {
          reply = event.text.trim()
          process.stdout.write(`${reply}\n`)
        }
      },
      onDone: (result) => {
        if (!result.ok && result.error) process.stderr.write(`whale-chan: ${result.error}\n`)
        resolve(result.ok ? 0 : 1)
      },
    })
  })

  // --once 干过的事也留进记忆，跟交互模式一个样。
  // 有形象卡就写卡（卡自己就是记忆），没有才写记忆.md。
  if (card && card.parsed) {
    try {
      const { appendCardLog, setCardState, writeCard } = await import('../src/card.mjs')
      const lines = []
      if (options.once) lines.push(`主人：${String(options.once).replace(/\s+/g, ' ').slice(0, 160)}`)
      if (tools.length) lines.push(`我用了：${[...new Set(tools)].join(', ')}`)
      if (reply) lines.push(`我：${String(reply).replace(/\s+/g, ' ').slice(0, 240)}`)
      if (!agent.sessionId) lines.push('（这次没拿到会话号，下次接不上这段历史）')
      appendCardLog(card.parsed, lines.join('\n'), { bumpSession: true })
      if (agent.sessionId) setCardState(card.parsed, { sessionId: agent.sessionId, cwd: options.cwd })
      writeCard(card.parsed)
    } catch (error) {
      process.stderr.write(`whale-chan: 形象卡没写回去：${error.message}\n`)
    }
    if (agent.sessionId) {
      const { memoryDir: defaultMemoryDir, writeState } = await import('../src/memory.mjs')
      try {
        writeState(options.memoryDir || defaultMemoryDir(), { sessionId: agent.sessionId, cwd: options.cwd })
      } catch {
        /* 会话号写不进去只是接不上历史，不该让整条命令失败 */
      }
    }
  } else if (memory) {
    try {
      const { appendMemory, writeState } = await import('../src/memory.mjs')
      appendMemory(memory.dir, { prompt: options.once, reply, tools, cwd: options.cwd })
      if (agent.sessionId) writeState(memory.dir, { sessionId: agent.sessionId, cwd: options.cwd })
    } catch (error) {
      process.stderr.write(`whale-chan: 记忆没写进去：${error.message}\n`)
    }
  }
  process.exit(code)
}

// 只有「被当成入口跑」时才启动界面。
// 不判这一下的话，任何 `import` 这个文件去拿 parseArgs / resolveDsh 的脚本
// 都会顺手启动一个 TUI —— 文件底部那两个导出就变成了陷阱（我自己踩过一次，
// 探针脚本整个挂住，还以为是 dsh --dump-config 慢）。
const isEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isEntry) {
  main().catch((error) => {
    process.stderr.write(`whale-chan: ${error?.stack || error}\n`)
    process.exit(1)
  })
}

export { parseArgs, resolveDsh }
