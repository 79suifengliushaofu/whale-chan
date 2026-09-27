// Webview 面板的聊天后端。
//
// 用途：VS Code 扩展没法直接跑一个「交互式终端」，所以这里把一次对话回合包成
// 双向 NDJSON —— stdin 收命令，stdout 发事件。扩展拿到事件后画真彩 HTML。
//
// stdin   {"type":"ask","text":"…"} / {"type":"cancel"} / {"type":"new"} / {"type":"sticker"} / {"type":"ping"}
// stdout  {"type":"hello"|"phase"|"bubble"|"text"|"thinking"|"tool"|"tool_result"|"card"|"done"|"error"|"stderr"|"pong"}
//
// 卡片里的 PNG 以 base64 内联：webview 读不到任意本地文件，而表情包目录可能在
// 用户自己的工作区里，只能由后端读好了塞进去。

import fs from 'node:fs'

import { HarnessAgent } from './agent.mjs'
import { pickFeeling, pickLine } from './bubble.mjs'
import { loadStickers, matchSticker, readContext, resolveStickerDir } from './sticker.mjs'
import { VERSION } from './version.mjs'
import { accountLine, fetchBalance, peakInfo } from './account.mjs'
import { EFFORTS, effortLabel, isEffort, resolveProfileDefaults, writeProfilePatch } from './effort.mjs'
import {
  appendMemory,
  clearState,
  composePersona,
  loadMemory,
  memoryDir as defaultMemoryDir,
  writeState,
} from './memory.mjs'
import {
  appendCardLog,
  bumpFavor,
  cardPrompt,
  cardSummary,
  cardWeight,
  ensureCard,
  setCardState,
  writeCard,
} from './card.mjs'

const CARD_MS = 7000
const CARD_COOL_MS = 12000
const WORK_CARD_AFTER_MS = 15000
const THINK_CARD_AFTER_MS = 10000
const IDLE_CARD_AFTER_MS = 45000
const DONE_CARD_MS = 4200
const RESULT_LIMIT = 4000

// 卡片左上角那行标题。挑不到就用表情包自己的文件名。
const CARD_TITLE = {
  'balance-zero': '钱包空了…',
  'balance-low': '省着点花哦',
  working: '正在干活',
  thinking: '让我想想',
  'slow-think': '想得有点久',
  idle: '有点无聊',
  done: '嘿，搞定啦',
  'done-tsun': '哼，做完了',
  error: '出问题了…',
  'net-error': '网好像不太好',
  flirty: '诶、诶…',
  'user-angry': '别、别生气嘛',
  vague: '你在说什么呀',
  instant: '这么快就好了',
  soon: '马上就好',
  hallucinating: '我没瞎编哦',
  'user-fast': '你也太快了',
  'user-scoff': '哼，明明很好',
}

function truncate(text, max = RESULT_LIMIT) {
  const flat = typeof text === 'string' ? text : JSON.stringify(text)
  if (!flat) return ''
  return flat.length > max ? `${flat.slice(0, max)}\n…（已截断 ${flat.length - max} 字）` : flat
}

export function runBridge(options = {}) {
  const agent = new HarnessAgent({
    cwd: options.cwd,
    profile: options.profile,
    permission: options.permission,
  })
  const stickerDir = resolveStickerDir({ explicit: options.stickers, cwd: agent.cwd })
  const stickers = loadStickers(stickerDir)

  const send = (payload) => {
    try {
      process.stdout.write(`${JSON.stringify(payload)}\n`)
    } catch {
      /* 管道断了就算了 */
    }
  }

  let busy = false
  let phase = 'idle'
  let reply = ''
  let seq = 0
  let cardCoolUntil = 0
  // 余额 / 峰谷 / 推理强度
  let balanceEnabled = options.balance !== false
  let balance = null
  let balanceAt = 0
  let effort = String(options.effort || 'default').toLowerCase()
  // 记忆 / 人设：跟终端版共用同一套文件，两个入口看到的是同一份人设。
  const memoryOff = options.memory === false
  const memoryDir = options.memoryDir || defaultMemoryDir()
  const mem = memoryOff ? null : loadMemory(memoryDir)
  // 形象卡：一个人一份文件。有卡的时候卡就是她，人设.md / 记忆.md 退居二线。
  const characterInfo =
    options.card === 'off'
      ? { source: 'off' }
      : ensureCard({ explicit: options.card || null, cwd: agent.cwd, memoryDir: memoryOff ? null : memoryDir })
  const character = characterInfo.parsed || null
  let turnTools = []
  const callTools = new Map()
  let userContext = readContext('')
  let turnStart = 0
  let lastActivity = Date.now()

  function setPhase(next) {
    if (phase === next) return
    phase = next
    send({ type: 'phase', phase: next })
  }

  function bubble(state) {
    seq += 1
    send({ type: 'bubble', text: pickLine(state, seq) })
  }

  function showCard(context = {}, { force = false } = {}) {
    if (!stickers.length) return
    const now = Date.now()
    if (!force && now < cardCoolUntil) return
    seq += 1
    const merged = { phase, seed: seq, ...context }
    const pick = matchSticker(stickers, merged)
    if (!pick) return
    let png = ''
    try {
      png = fs.readFileSync(pick.file).toString('base64')
    } catch {
      return
    }
    cardCoolUntil = now + CARD_COOL_MS
    send({
      type: 'card',
      key: pick.key,
      name: pick.name,
      title: merged.title || CARD_TITLE[pick.key] || pick.name,
      feeling: pickFeeling(merged, seq),
      png,
      ms: phase === 'done' ? DONE_CARD_MS : CARD_MS,
    })
  }

  function ask(text) {
    const prompt = String(text || '').trim()
    if (!prompt) return
    if (busy) {
      send({ type: 'error', message: '我还在忙上一条呢…等我一下下嘛。' })
      return
    }
    userContext = readContext(prompt)
    reply = ''
    turnTools = []
    turnStart = Date.now()
    lastActivity = turnStart
    busy = true
    setPhase('thinking')
    bubble('thinking')
    if (userContext.hostile || userContext.flirty || userContext.scoff) {
      showCard({ ...userContext }, { force: true })
    }

    agent.run(prompt, {
      onEvent(event) {
        if (event.type === 'session' && event.sessionId) {
          send({ type: 'session', sessionId: event.sessionId })
        } else if (event.type === 'text' && typeof event.text === 'string') {
          reply += event.text
          setPhase('working')
          send({ type: 'text', text: event.text })
          lastActivity = Date.now()
        } else if (event.type === 'thinking' && event.text) {
          send({ type: 'thinking', text: event.text })
          lastActivity = Date.now()
        } else if (event.type === 'tool_call') {
          setPhase('working')
          // dsh 的 tool_result 事件里只有 callId、不带工具名，所以自己记一份映射。
          if (event.callId) callTools.set(event.callId, event.tool || event.name || 'tool')
          turnTools.push(event.tool || event.name || 'tool')
          send({
            type: 'tool',
            callId: event.callId || null,
            tool: event.tool || event.name || 'tool',
            input: event.input || {},
          })
          lastActivity = Date.now()
        } else if (event.type === 'tool_result') {
          send({
            type: 'tool_result',
            callId: event.callId || null,
            tool: callTools.get(event.callId) || event.tool || event.name || 'tool',
            status: event.status || 'completed',
            result: truncate(event.result),
          })
          lastActivity = Date.now()
        }
      },
      onStderr(chunk) {
        const text = String(chunk).trim()
        if (text) send({ type: 'stderr', text: truncate(text, 600) })
      },
      onDone(result) {
        busy = false
        const elapsed = Date.now() - turnStart
        setPhase(result.ok ? 'done' : 'error')
        send({
          type: 'done',
          ok: Boolean(result.ok),
          sessionId: agent.sessionId,
          elapsed,
          cost: result.cost ?? null,
          stderr: result.ok ? '' : truncate(result.stderr, 800),
        })
        const context = {
          ...userContext,
          ...readContext('', reply),
          instant: elapsed < 4000,
        }
        showCard(context, { force: true })
        lastActivity = Date.now()
        if (!result.ok && !reply) bubble('error')
        // 「自动保存上一次会话」：每回合结束记一条摘要 + 记住 sessionId。
        if (character) {
          // 有卡就只写卡，不再另外写记忆.md —— 两个地方都写会分叉。
          try {
            const lines = []
            if (prompt) lines.push(`主人：${String(prompt).replace(/\s+/g, ' ').slice(0, 160)}`)
            if (turnTools.length) lines.push(`我用了：${[...new Set(turnTools)].join(', ')}`)
            if (reply) lines.push(`我：${String(reply).replace(/\s+/g, ' ').slice(0, 240)}`)
            if (!result.ok) lines.push('（这一回合出错了）')
            if (lines.length) {
              appendCardLog(character, lines)
              writeCard(character)
            }
            writeState(memoryDir, { sessionId: agent.sessionId || null, cwd: agent.cwd })
          } catch {
            /* 写卡失败不该影响这一回合 */
          }
          sendMemory()
        } else if (mem) {
          try {
            appendMemory(memoryDir, {
              prompt,
              reply,
              tools: turnTools,
              cwd: agent.cwd,
              ok: result.ok,
            })
            writeState(memoryDir, { sessionId: agent.sessionId || null, cwd: agent.cwd })
          } catch {
            /* 记忆写失败不该影响这一回合 */
          }
          sendMemory()
        }
        turnTools = []
      },
    })
  }

  // 余额 / 峰谷 / 推理强度：面板顶栏那一小块。峰谷是本地算的，余额要联网。
  function sendAccount() {
    const peak = peakInfo()
    send({
      type: 'account',
      enabled: balanceEnabled,
      ok: Boolean(balance && balance.ok),
      balance: balance && balance.ok ? balance.totalBalance : null,
      currency: (balance && balance.currency) || 'CNY',
      source: (balance && balance.source) || null,
      error: balance && !balance.ok ? balance.error : null,
      peak: peak.peak,
      peakLabel: peak.label,
      countdownLabel: peak.countdownLabel,
      remainMs: peak.remainMs,
      text: accountLine({ balance }),
      effort,
      effortLabel: effortLabel(effort),
    })
  }

  async function refreshAccount({ force = false } = {}) {
    if (!balanceEnabled) return sendAccount()
    try {
      balance = await fetchBalance({ force })
    } catch {
      balance = { ok: false, code: 'CRASH', error: '余额查询炸了' }
    }
    balanceAt = Date.now()
    sendAccount()
  }

  /**
   * 把「人设 + 记忆 + 推理强度」拼成 profile patch 挂到 agent 上。
   * 注意 --patch 的 config 是**整体替换**，所以 personaPrefix 和 personaSuffix 必须一起写回，
   * provider / model 也不能省——少一个就把 profile 里的原值抹掉了。
   */
  function applyProfile({ effort: want = effort } = {}) {
    const next = String(want || 'default').toLowerCase()
    if (next !== 'default' && !isEffort(next)) {
      return { ok: false, error: `不认识的档位：${want}` }
    }
    const defaults = resolveProfileDefaults({ dsh: agent.dsh, profile: agent.profile })
    if (!defaults) return { ok: false, error: '读不到 profile 的默认配置' }
    let systemPrompt = defaults.systemPrompt
    const personaText = character ? cardPrompt(character) : ''
    if (personaText) {
      systemPrompt = {
        personaPrefix: [defaults.systemPrompt.personaPrefix, personaText].filter(Boolean).join('\n\n'),
        personaSuffix: defaults.systemPrompt.personaSuffix || '',
      }
    } else if (mem) {
      systemPrompt = {
        personaPrefix: [defaults.systemPrompt.personaPrefix, composePersona({
          persona: mem.persona,
          memory: mem.memory,
          cwd: agent.cwd,
        })]
          .filter(Boolean)
          .join('\n\n'),
        personaSuffix: defaults.systemPrompt.personaSuffix || '',
      }
    }
    try {
      agent.patch = writeProfilePatch({ ...defaults.model, effort: next, systemPrompt })
    } catch (error) {
      return { ok: false, error: String(error && error.message) }
    }
    effort = next
    return { ok: true, error: null }
  }

  /** 面板顶栏那个「记忆」小标：告诉用户她在读哪份人设、记了多少条。 */
  function sendMemory() {
    send({
      type: 'memory',
      enabled: !memoryOff,
      dir: memoryDir,
      personaChars: character ? cardWeight(character).persona : mem ? mem.persona.length : 0,
      count: mem ? mem.memoryCount : 0,
      sessionId: agent.sessionId || null,
      files: mem ? mem.files : null,
      // 有卡的时候上面那几项其实都由卡说了算，面板要的是这一组。
      card: character
        ? {
            summary: cardSummary(character),
            file: character.file,
            source: characterInfo.source,
            favor: Number(character.state.favor) || 0,
            weight: cardWeight(character),
          }
        : null,
    })
  }

  /** 好感度动一下并写回卡。返回 {ok, before, after}；delta 为 0 时只报数不改。 */
  function changeFavor(delta) {
    if (!character) return { ok: false, error: '现在没挂形象卡，好感度没地方记。' }
    const before = Number(character.state.favor) || 0
    const step = Number(delta) || 0
    if (!step) return { ok: true, before, after: before, quiet: true }
    try {
      const after = bumpFavor(character, step)
      writeCard(character)
      sendMemory()
      return { ok: true, before, after }
    } catch (error) {
      return { ok: false, error: String(error && error.message) }
    }
  }

  /**
   * 「摸摸头」：弹一张表情包，顺便涨一点好感度。
   *
   * 好感度这条路上有冷却，一分钟最多涨一次 —— 不然连点二十下就满级了，
   * 满级的好感度也就不叫好感度了。冷却期间她照样会弹表情包。
   */
  const PAT_FAVOR_COOLDOWN_MS = 60000
  let patFavorAt = 0

  function pat() {
    cardCoolUntil = 0
    showCard({ instant: false }, { force: true })
    const now = Date.now()
    if (now - patFavorAt < PAT_FAVOR_COOLDOWN_MS) return
    patFavorAt = now
    send({ type: 'favor', ...changeFavor(1) })
  }

  function forget() {
    clearState(memoryDir)
    if (mem) mem.state = null
    agent.sessionId = null
    send({ type: 'session', sessionId: null })
    sendMemory()
  }

  function remember(text) {
    const body = String(text || '').trim()
    if (!body || memoryOff) return
    appendMemory(memoryDir, { manual: body, cwd: agent.cwd })
    if (mem) {
      mem.memory = [mem.memory, `### 手动 · ${body}`].filter(Boolean).join('\n\n')
    }
    applyProfile()
    sendMemory()
  }

  function setEffort(value) {
    const result = applyProfile({ effort: value })
    send({ type: 'effort', value: effort, label: effortLabel(effort), error: result.error })
  }

  function reset() {
    agent.cancel()
    busy = false
    forget()
    turnTools = []
    reply = ''
    userContext = readContext('')
    setPhase('idle')
    send({ type: 'reset' })
    bubble('greet')
  }

  function handle(message) {
    switch (message && message.type) {
      case 'ask':
        ask(message.text)
        break
      case 'cancel':
        if (agent.cancel()) send({ type: 'cancelled' })
        break
      case 'new':
        reset()
        break
      case 'sticker':
        cardCoolUntil = 0
        showCard({ instant: false }, { force: true })
        break
      case 'pat':
        pat()
        break
      case 'effort':
        setEffort(message.value)
        break
      case 'balance':
        refreshAccount({ force: true })
        break
      case 'forget':
        forget()
        break
      case 'remember':
        remember(message.text)
        break
      case 'memory':
        sendMemory()
        break
      case 'favor':
        send({ type: 'favor', ...changeFavor(message.delta ?? message.value) })
        break
      case 'ping':
        send({ type: 'pong' })
        break
      default:
        break
    }
  }

  // 续上一次的会话 + 把人设和记忆挂上去：面板里也必须做，不然「自动读人设」只在终端生效。
  if (mem && mem.state && mem.state.sessionId) agent.sessionId = mem.state.sessionId
  if (character) {
    try {
      setCardState(character, { sessions_count: (Number(character.state.sessions_count) || 0) + 1 })
      writeCard(character)
    } catch {
      /* 计数写不进去也不该拦住启动 */
    }
  }
  applyProfile({ effort })

  send({
    type: 'hello',
    version: VERSION,
    cwd: agent.cwd,
    profile: agent.profile,
    permission: agent.permission,
    dsh: agent.dsh.label,
    stickerDir,
    stickerCount: stickers.length,
    frames: ['idle', 'blink', 'joy0', 'joy1', 'cheer', 'oops'],
    effort,
    effortLabel: effortLabel(effort),
    effortChoices: EFFORTS,
    balanceEnabled,
    sessionId: agent.sessionId || null,
    memoryEnabled: !memoryOff,
    memoryDir,
    memoryCount: mem ? mem.memoryCount : 0,
    personaChars: mem ? mem.persona.length : 0,
    card: character
      ? {
          summary: cardSummary(character),
          file: character.file,
          source: characterInfo.source,
          favor: Number(character.state.favor) || 0,
        }
      : null,
  })
  bubble('greet')
  refreshAccount()

  // 干活干久了 / 闲太久了，主动弹一张表情包。
  const timer = setInterval(() => {
    const now = Date.now()
    // 余额每 60 秒刷一次（fetchBalance 内部还有 25 秒缓存兜着），不挡别的事。
    if (balanceEnabled && now - balanceAt > 60000) refreshAccount()
    if (busy) {
      const elapsed = now - turnStart
      if (phase === 'working' && elapsed >= WORK_CARD_AFTER_MS) showCard({ phase: 'working' })
      else if (phase === 'thinking' && elapsed >= THINK_CARD_AFTER_MS) {
        showCard({ phase: 'thinking', thinkingMs: elapsed })
      }
      return
    }
    if (now - lastActivity >= IDLE_CARD_AFTER_MS) {
      lastActivity = now
      showCard({ phase: 'idle' })
      bubble('idle')
    }
  }, 1000)
  if (typeof timer.unref === 'function') timer.unref()

  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line))
      } catch {
        /* 忽略坏行 */
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
  process.stdin.resume()

  return { agent, send }
}
