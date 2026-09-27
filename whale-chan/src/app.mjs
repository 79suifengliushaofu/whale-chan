// 鲸鱼娘终端界面：左边是 2D 鲸鱼娘（真彩色半格像素画）+ 台词气泡，
// 右边是和 DeepSeek Harness 智能体的对话，底部是输入行与状态栏。

import { Canvas, packRgb } from './screen.mjs'
import { wrapText, truncate, strWidth, charWidth } from './text.mjs'
import { drawFrame, getQFrameFit, getStickerFit } from './sprite.mjs'
import { pickLine, pickFeeling } from './bubble.mjs'
import { loadStickers, matchSticker, readContext, resolveStickerDir } from './sticker.mjs'
import { describeToolEvent } from './agent.mjs'
import { VERSION } from './version.mjs'
import { accountLine, cachedBalance, fetchBalance, formatCountdown, formatMoney, peakInfo } from './account.mjs'
import { EFFORTS, effortLabel, isEffort, resolveProfileDefaults, writeProfilePatch } from './effort.mjs'
import {
  appendMemory,
  clearState,
  composePersona,
  formatWhen,
  loadMemory,
  memoryDir,
  memoryTail,
  readState,
  sessionForCwd,
  withCwdSession,
  writeState,
} from './memory.mjs'
import {
  SECTION as CARD_SECTION,
  appendCardLog,
  bumpFavor,
  cardPrompt,
  cardSummary,
  cardWeight,
  ensureCard,
  setCardState,
  writeCard,
} from './card.mjs'

const ESC = '\x1b'

const THEME = {
  bg: packRgb(9, 13, 23),
  panel: packRgb(13, 20, 36),
  band: packRgb(20, 32, 56),
  bandDim: packRgb(15, 24, 42),
  headerBg: packRgb(17, 27, 48),
  text: packRgb(221, 230, 255),
  dim: packRgb(122, 138, 172),
  faint: packRgb(84, 98, 130),
  user: packRgb(126, 224, 200),
  tool: packRgb(156, 176, 216),
  ok: packRgb(140, 222, 140),
  warn: packRgb(240, 200, 120),
  error: packRgb(255, 122, 138),
  accent: packRgb(112, 184, 255),
  white: packRgb(245, 249, 255),
  inputBg: packRgb(19, 29, 50),
}

// 每个阶段用哪张 Q 萌表情；数组 = 多帧循环（帧序由 PHASE_SPEED 控制快慢）。
const PHASE_FACES = {
  greet: ['joy0', 'joy1'],
  idle: ['idle', 'idle', 'idle', 'idle', 'idle', 'blink'],
  thinking: ['blink'],
  working: ['idle'],
  done: ['cheer'],
  error: ['oops'],
}

// 鼠标停在鲸鱼娘身上（或被点了一下）时切换的「可爱享受」表情。
const HOVER_FACES = ['joy0', 'joy1']
const HOVER_SPEED = 9

const PHASE_SPEED = { greet: 2, idle: 3, thinking: 2, working: 1, done: 2, error: 2 }

const PHASE_LABEL = {
  greet: '新的一天',
  idle: '待命',
  thinking: '思考中',
  working: '执行中',
  done: '完成',
  error: '出错',
}

const PHASE_COLOR = {
  greet: THEME.accent,
  idle: THEME.dim,
  thinking: THEME.warn,
  working: THEME.accent,
  done: THEME.ok,
  error: THEME.error,
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// 表情包气泡：卡片停留时长、贴图底衬、以及每种触发原因的标题。
const CARD_MS = 7000
const CARD_BG = packRgb(246, 248, 253)

const CARD_TITLE = {
  'balance-zero': '余额见底了…',
  'balance-low': '余额不多了…',
  'user-angry': '你好像生气了',
  flirty: '嘿嘿…',
  'net-error': '出问题了',
  'slow-think': '想了好久',
  instant: '答得太快了吧',
  soon: '结果快出来了',
  working: '正在干活',
  'done-tsun': '哼，做完了',
  done: '做完了',
  hallucinating: '我…有点含糊',
  vague: '你是指…？',
  'user-fast': '你好快呀',
  'user-scoff': '你不屑了…',
  thinking: '思考中',
  idle: '我在发呆',
}

/** 阶段 → 感想池。 */
function cardFeeling(phase) {
  if (phase === 'thinking' || phase === 'working' || phase === 'done' || phase === 'error') return phase
  return 'idle'
}


// ?1000 按下/松开、?1002 拖动、?1003 纯移动（悬停就靠它）、?1006 SGR 坐标格式。
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1002h${ESC}[?1003h${ESC}[?1006h`
const MOUSE_OFF = `${ESC}[?1003l${ESC}[?1002l${ESC}[?1000l${ESC}[?1006l`

/** 界面版本号，写在启动提示里 —— 一眼就能看出扩展有没有真的更新。 */
export { VERSION }

export class WhaleApp {
  constructor(options = {}) {
    this.agent = options.agent
    this.stdin = options.stdin || process.stdin
    this.stdout = options.stdout || process.stdout
    this.cwd = options.cwd || process.cwd()
    this.canvas = new Canvas(this.stdout.columns || 90, this.stdout.rows || 28)
    this.transcript = []
    this.input = ''
    this.caret = 0
    this.scroll = 0
    this.phase = 'greet'
    this.phaseAt = Date.now()
    this.tickCount = 0
    this.busy = false
    this.stopped = false
    this.seed = 0
    this.bubble = pickLine('greet', 0)
    this.usage = ''
    this.keyBuffer = ''
    this.pasteMode = false
    this.liveText = null
    this.toolIndex = new Map()
    this.screenshotPath = options.screenshotPath || null
    this.maxScroll = 0
    // 鼠标：开着 ?1003 上报才能收到悬停，但**终端一旦开启鼠标上报就没法用鼠标框选文字**了。
    // 复制粘贴比摸头重要，所以默认关；`/mouse` 打开，或者启动时加 `--mouse`。
    // （VS Code 的 Webview 面板版不受影响，那边是真鼠标事件。）
    this.mouseEnabled = options.mouse === true
    this.hoverUntil = 0
    this.purrUntil = 0
    this.whaleRect = null
    this.spriteRect = null
    // 状态栏里「思考 X」那块的可点区域。终端里放不下真按钮，就把它渲染时的
    // 坐标记下来 —— 点中了当成按了一下。开了鼠标上报才有值。
    this.effortRect = null
    // 表情包气泡：目录里放着用户自备的 PNG，文件名就是分类。
    this.stickerDir = resolveStickerDir({ explicit: options.stickers, cwd: this.cwd })
    this.stickers = loadStickers(this.stickerDir)
    this.card = null
    this.cardCoolUntil = 0
    this.cardSeq = 0
    this.reply = ''
    this.userContext = {}
    this.idleSince = Date.now()
    this.tokenBudget = Number(options.tokenBudget || process.env.WHALE_TOKEN_BUDGET || 0)
    this.tokensUsed = 0
    // 推理强度：'default' 表示不插手，用模型自带的默认值。
    this.effort = String(options.effort || 'default').toLowerCase()
    this.effortBusy = false
    // 余额与峰谷：余额是网络请求，慢一步来，状态栏先显示占位。
    // 先看一眼缓存 —— --screenshot 和自检那条同步路径来不及等网络，靠这个立刻有内容。
    this.balance = cachedBalance()
    this.balanceEnabled = options.balance !== false
    this.balanceAt = 0
    this.balanceBusy = false
    // 记忆与人设：state.json 记住上次的 sessionId，人设.md / 记忆.md 进系统提示词。
    this.memoryDir = options.memoryDir || memoryDir()
    this.memoryOff = options.memory === false
    this.memory = this.memoryOff
      ? { dir: this.memoryDir, state: null, persona: '', memory: '', memoryCount: 0, files: {} }
      : loadMemory(this.memoryDir)
    this.persona = this.memory.persona || ''
    this.memoryCount = this.memory.memoryCount || 0
    // 形象卡：一个人一份文件。有卡的话，卡就是她；没有才退回人设.md + 记忆.md。
    // ⚠️ 字段名别叫 this.card —— this.card 是「表情包气泡」，两个东西重名过一次，
    // 结果每回合的日志全被当成表情包对象写，静默失败，记忆里一条都没有。
    this.characterPath = options.card || null
    this.character = null
    this.characterInfo = null
    this.characterTurn = 0
    this.characterCounted = false
    this.loadCard()
    this.profileDefaults = null // 一次 --dump-config 的结果，applyProfile 时填
    this.turnPrompt = ''
    this.turnTools = []
    this.turnReply = ''
  }

  // ------------------------------------------------------------------ 形象卡

  /** 读形象卡；没找到就退回「人设.md + 记忆.md」那套老机制。 */
  loadCard() {
    if (this.characterPath === 'off') {
      this.characterInfo = { source: 'off' }
      this.character = null
      this.characterError = null
      return null
    }
    const info = ensureCard({ explicit: this.characterPath, cwd: this.cwd, memoryDir: this.memoryDir })
    this.characterInfo = info
    this.character = info.parsed || null
    if (info.source === 'error') {
      this.character = null
      this.characterError = info.error
    } else {
      this.characterError = null
    }
    return this.character
  }

  /** 她是谁：有卡用卡，没卡用老的人设 + 记忆尾巴。 */
  promptPersona() {
    if (this.character) return cardPrompt(this.character)
    if (this.memoryOff) return ''
    return composePersona({ persona: this.persona, memory: memoryTail(this.memoryDir), cwd: this.cwd })
  }

  /**
   * 每回合收工时把这一回合写回形象卡。
   * 「自动保存上一次会话」的另一半：sessionId 归 state.json，聊了什么归卡。
   */
  saveCardTurn({ prompt, reply, tools, ok }) {
    if (!this.character) return
    const lines = []
    if (prompt) lines.push(`主人：${String(prompt).replace(/\s+/g, ' ').slice(0, 160)}`)
    if (tools && tools.length) lines.push(`我用了：${[...new Set(tools)].join(', ')}`)
    if (reply) lines.push(`我：${String(reply).replace(/\s+/g, ' ').slice(0, 240)}`)
    if (ok === false) lines.push('（这一回合出错了）')
    if (!lines.length) return
    try {
      appendCardLog(this.character, lines)
      writeCard(this.character)
      this.characterTurn += 1
    } catch (error) {
      this.note(`形象卡没写回去：${String(error && error.message).slice(0, 120)}`)
    }
  }

  /** 好感度动一下，并写回卡。 */
  changeFavor(delta) {
    if (!this.character) return null
    const before = Number(this.character.state.favor) || 0
    const after = bumpFavor(this.character, delta)
    try {
      writeCard(this.character)
    } catch (error) {
      this.note(`好感度没写回去：${String(error && error.message).slice(0, 120)}`)
      return null
    }
    return { before, after }
  }

  // ------------------------------------------------------------------ 记忆

  /** 重新读人设和记忆（主人改了文件，或者刚 /remember 过）。 */
  reloadMemory() {
    if (this.memoryOff) return
    this.memory = loadMemory(this.memoryDir)
    this.persona = this.memory.persona || ''
    this.memoryCount = this.memory.memoryCount || 0
  }

  /** 记住上一次的 sessionId，下次启动直接续上。 */
  saveSession(extra = {}) {
    if (this.memoryOff) return
    const sessionId = this.agent ? this.agent.sessionId : null
    writeState(this.memoryDir, {
      sessionId,
      cwd: this.cwd,
      turns: this.turns || 0,
      // 再按目录记一份：换目录时不至于拿别的目录的会话去续，被 dsh 拒掉。
      byCwd: withCwdSession(readState(this.memoryDir), this.cwd, sessionId, this.turns || 0),
      ...extra,
    })
  }

  /**
   * 把一个回合记进「记忆.md」——这就是「自动保存上一次会话」。
   * 会话历史本身靠 sessionId 原样续上；这条摘要负责在**换会话之后**还留个印象。
   */
  recordTurn({ prompt, reply, tools, ok }) {
    // 形象卡是「一个人一份文件」，它自己就是记忆 —— 有卡的时候就只写卡，
    // 免得同一件事在卡的日志和记忆.md 里各记一遍、两边慢慢分叉。
    if (this.character) {
      this.saveCardTurn({ prompt, reply, tools, ok })
      this.saveSession()
      return
    }
    if (this.memoryOff) return
    appendMemory(this.memoryDir, { prompt, reply, tools, cwd: this.cwd })
    this.memoryCount += 1
    this.saveSession()
  }

  // ------------------------------------------------------------ 人设与提示词

  /**
   * 组装并写下 profile patch：系统提示词里的人设 + 记忆，外加当前的推理强度。
   *
   * 为什么放系统提示词、不放开场白：开场白只是「用户说的一句话」，
   * 聊到第三轮就被淹了；系统提示词每一轮都在，换会话也不会丢。
   */
  async applyProfile({ effort = this.effort } = {}) {
    const agent = this.agent
    const next = String(effort || 'default').toLowerCase()
    if (next !== 'default' && !isEffort(next)) {
      this.note(`不认识的推理强度「${effort}」。可选：${EFFORTS.join(' / ')} / default`)
      return false
    }
    if (!agent || !agent.dsh) {
      this.effort = next
      return true
    }
    this.effortBusy = true
    try {
      if (!this.profileDefaults) {
        this.profileDefaults = resolveProfileDefaults({ dsh: agent.dsh, profile: agent.profile })
      }
      const defaults = this.profileDefaults
      if (!defaults || !defaults.model) {
        this.note('读不到 profile 的默认模型（`dsh --dump-config` 失败了），人设和推理强度这次没挂上。')
        return false
      }
      const base = defaults.systemPrompt || {}
      const persona = this.promptPersona()
      // ⚠️ personaPrefix / personaSuffix 必须**一起**写回去：--patch 的 config 是整体替换。
      const systemPrompt = {
        personaPrefix: [base.personaPrefix, persona].filter(Boolean).join('\n\n'),
        personaSuffix: base.personaSuffix || '',
      }
      agent.patch = writeProfilePatch({ ...defaults.model, effort: next, systemPrompt })
      this.effort = next
      return true
    } catch (error) {
      this.note(`准备人设失败：${String(error && error.message).slice(0, 120)}`)
      return false
    } finally {
      this.effortBusy = false
    }
  }

  /** 兼容旧调用点：只改推理强度。 */
  async applyEffort(value) {
    const next = String(value || 'default').toLowerCase()
    if (next !== 'default' && !isEffort(next)) {
      this.note(`不认识的推理强度「${value}」。可选：${EFFORTS.join(' / ')} / default`)
      return false
    }
    const ok = await this.applyProfile({ effort: next })
    if (ok && !this.memoryOff) {
      const model = this.profileDefaults && this.profileDefaults.model
      this.note(
        `推理强度：${effortLabel(next)}（${next}）· 人设和记忆继续挂着` +
          (model ? ` · ${model.provider} / ${model.model}` : '') +
          ' · 下一个回合生效',
      )
    }
    return ok
  }

  // ------------------------------------------------------------ 余额与推理强度

  /** 拉一次余额（有 25 秒缓存，所以可以放心追着调）。 */
  async refreshBalance({ force = false } = {}) {
    if (!this.balanceEnabled || this.stopped) return null
    const snapshot = await fetchBalance({ force })
    if (this.stopped) return snapshot
    this.balance = snapshot
    this.balanceAt = Date.now()
    this.render()
    this.canvas.flush(this.stdout)
    return snapshot
  }

  // ---------------------------------------------------------------- 生命周期

  start() {
    this.canvas.resize(this.stdout.columns || 90, this.stdout.rows || 28)
    // 先把上次的会话接回来：整段历史都还在——她上次读了哪些文件、跑了哪些命令，全都记得。
    const saved = this.memory && this.memory.state
    // ⚠️ 只在「这个目录」的会话才续接：dsh 会拒绝跨目录的 session-id 并直接 code 1。
    const resumed = sessionForCwd(saved, this.cwd)
    if (resumed && this.agent && !this.agent.sessionId) {
      this.agent.sessionId = resumed
    }
    this.noteStickerStatus()
    this.noteCardStatus()
    this.noteMemoryStatus(saved)
    // 终端默认不给鼠标上报（否则没法框选复制），所以把摸头的入口写出来。
    this.note(
      this.mouseEnabled
        ? '鼠标摸头：开（文字框选暂时失效，敲 /mouse 关掉）'
        : '想摸她的话敲 /mouse 打开鼠标反应；平时鼠标可以直接框选复制。'
    )
    // 余额：慢一步来，先在状态栏留个位置；读失败就说一声，免得用户以为是没做。
    if (this.balanceEnabled) {
      this.refreshBalance()
        .then((snapshot) => {
          if (snapshot && !snapshot.ok && snapshot.code !== 'NO_KEY') this.note(`余额没读到：${snapshot.error}`)
        })
        .catch(() => {})
    }
    if (this.screenshotPath) {
      this.render()
      return
    }
    this.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[?25l${this.mouseEnabled ? MOUSE_ON : ''}`)
    if (this.stdin.isTTY) this.stdin.setRawMode(true)
    this.stdin.setEncoding('utf8')
    this.stdin.resume()
    this.stdin.on('data', (chunk) => this.onData(chunk))
    this.stdout.on('resize', () => this.onResize())
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())
    this.timer = setInterval(() => this.tick(), 80)
    this.render()
    this.canvas.flush(this.stdout)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.agent?.cancel()
    try {
      if (this.stdin.isTTY) this.stdin.setRawMode(false)
      this.stdin.pause()
    } catch {
      /* 忽略 */
    }
    this.stdout.write(`${MOUSE_OFF}${ESC}[?25h${ESC}[?1049l`)
    process.exit(0)
  }

  onResize() {
    this.canvas.resize(this.stdout.columns || 90, this.stdout.rows || 28)
    this.canvas.invalidate()
    this.render()
    this.canvas.flush(this.stdout)
  }

  tick() {
    this.tickCount++
    if ((this.phase === 'done' || this.phase === 'error') && Date.now() - this.phaseAt > 6000) {
      this.setPhase('idle')
    }
    if (!this.busy && (this.phase === 'idle' || this.phase === 'greet') && this.tickCount % 90 === 0) {
      this.seed++
      this.bubble = pickLine('idle', this.seed)
    }
    // 没人搭话时她偶尔自己高兴一下——顺便保证「可爱享受」的表情一定被看到。
    if (
      !this.busy &&
      (this.phase === 'idle' || this.phase === 'greet') &&
      this.tickCount % 150 === 0 &&
      Date.now() > this.purrUntil
    ) {
      this.purrUntil = Date.now() + 2400
      this.seed++
      this.bubble = pickLine('happy', this.seed)
    }
    // 表情包：干活干久了、想太久了、或者闲太久了，弹一张出来。
    const now = Date.now()
    if (this.busy && this.turnStart) {
      const elapsed = now - this.turnStart
      if (elapsed >= 15000 && this.phase === 'working') this.maybeCard({ phase: 'working' })
      else if (elapsed >= 10000 && this.phase === 'thinking') this.maybeCard({ phase: 'thinking' })
    } else if (now - this.idleSince >= 45000) {
      this.maybeCard({ phase: 'idle', feeling: 'idle' })
      this.idleSince = now
    }
    // 余额每 60 秒刷一次（account.mjs 内部还有 25 秒缓存兜着）。
    if (this.balanceEnabled && !this.balanceBusy && now - this.balanceAt > 60000) {
      this.balanceBusy = true
      this.refreshBalance().finally(() => {
        this.balanceBusy = false
      })
    }
    this.render()
    this.canvas.flush(this.stdout)
  }

  setPhase(phase) {
    if (this.phase === phase) return
    this.phase = phase
    this.phaseAt = Date.now()
  }

  // ------------------------------------------------------------------ 键盘

  onData(chunk) {
    this.keyBuffer += chunk
    for (;;) {
      const parsed = this.nextKey(this.keyBuffer)
      if (!parsed) break
      this.keyBuffer = this.keyBuffer.slice(parsed.length)
      this.handleKey(parsed)
      if (this.stopped) return
    }
  }

  /**
   * 鼠标事件。SGR 编码里 button 低两位是按键（3 = 没按），+32 = 移动，+64 = 滚轮。
   * 光标落在鲸鱼娘身上就切「可爱享受」的表情；左键点一下她还会额外高兴一会儿。
   */
  onMouse(ev) {
    if (!this.mouseEnabled) return
    const x = ev.x - 1
    const y = ev.y - 1
    const motion = (ev.button & 32) !== 0
    const wheel = ev.button >= 64
    const click = !motion && !wheel && (ev.button & 3) === 0

    // 先看状态栏上的热区。顺序不能反：状态栏那一行也在 whaleRect 的纵向范围里，
    // 先判她的话，点「思考」永远会被当成点在鲸鱼娘身上。
    const zone = this.effortRect
    if (zone && click && y === zone.y && x >= zone.x && x < zone.x + zone.w) {
      this.cycleEffort()
      return
    }

    const rect = this.spriteRect || this.whaleRect
    if (!rect) return
    const inside =
      x >= rect.x - 1 && x < rect.x + rect.w + 1 && y >= rect.y - 1 && y < rect.y + rect.h + 1
    if (!inside) {
      this.hoverUntil = 0
      return
    }
    const wasHovering = Date.now() < this.hoverUntil
    this.hoverUntil = Date.now() + 2500
    if (click) this.purrUntil = Date.now() + 2600
    if (!wasHovering && !this.busy) {
      this.seed++
      this.bubble = pickLine('happy', this.seed)
    }
  }

  /** 状态栏上那个「思考 X」被点了一下：按 默认 → 关 → 低 → 高 → 最强 走一圈。 */
  cycleEffort() {
    if (this.effortBusy) return
    const order = ['default', ...EFFORTS]
    const index = order.indexOf(this.effort)
    const next = order[(index + 1) % order.length]
    this.applyEffort(next).catch(() => {})
  }

  /** 从缓冲区里取出一个按键；数据不完整时返回 null 等下一次 data。 */
  nextKey(buffer) {
    if (!buffer) return null
    if (buffer[0] !== ESC) {
      const cp = buffer.codePointAt(0)
      const ch = String.fromCodePoint(cp)
      return { kind: 'text', value: ch, length: ch.length }
    }
    if (buffer.length === 1) return null
    if (buffer[1] === '[' && buffer[2] === '<') {
      // SGR 鼠标上报：ESC [ < b ; x ; y M|m
      const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(buffer)
      if (!match) return null
      return {
        kind: 'mouse',
        button: Number(match[1]),
        x: Number(match[2]),
        y: Number(match[3]),
        release: match[4] === 'm',
        length: match[0].length,
      }
    }
    if (buffer[1] === '[') {
      const match = /^\x1b\[[0-9;?]*[A-Za-z~]/.exec(buffer)
      if (!match) return null
      const seq = match[0]
      if (seq === `${ESC}[200~`) return { kind: 'paste-start', length: seq.length }
      if (seq === `${ESC}[201~`) return { kind: 'paste-end', length: seq.length }
      const map = {
        [`${ESC}[A`]: 'up',
        [`${ESC}[B`]: 'down',
        [`${ESC}[C`]: 'right',
        [`${ESC}[D`]: 'left',
        [`${ESC}[H`]: 'home',
        [`${ESC}[F`]: 'end',
        [`${ESC}[1~`]: 'home',
        [`${ESC}[4~`]: 'end',
        [`${ESC}[3~`]: 'delete',
        [`${ESC}[5~`]: 'pageup',
        [`${ESC}[6~`]: 'pagedown',
        [`${ESC}[1;5A`]: 'scroll-up',
        [`${ESC}[1;5B`]: 'scroll-down',
      }
      return { kind: 'key', name: map[seq] || 'unknown', length: seq.length }
    }
    if (buffer[1] === 'O') {
      const match = /^\x1bO[A-Za-z]/.exec(buffer)
      if (!match) return null
      return { kind: 'key', name: 'unknown', length: match[0].length }
    }
    return { kind: 'key', name: 'escape', length: 1 }
  }

  handleKey(key) {
    if (key.kind === 'mouse') {
      this.onMouse(key)
      return
    }
    // 表情包气泡打开时，按任意键就收起（但不吞键，也不影响 Ctrl+C）。
    if (this.card) this.card = null
    if (key.kind === 'paste-start') {
      this.pasteMode = true
      return
    }
    if (key.kind === 'paste-end') {
      this.pasteMode = false
      return
    }
    if (this.pasteMode && key.kind === 'text') {
      this.insert(key.value === '\r' || key.value === '\n' ? ' ' : key.value)
      return
    }
    if (key.kind === 'text') {
      const ch = key.value
      const code = ch.codePointAt(0)
      if (code === 3) return this.onCtrlC()
      if (code === 4) return this.stop()
      if (code === 12) {
        this.canvas.invalidate()
        return
      }
      if (code === 1) {
        this.caret = 0
        return
      }
      if (code === 5) {
        this.caret = this.input.length
        return
      }
      if (code === 21) {
        this.input = ''
        this.caret = 0
        return
      }
      if (code === 11) {
        this.input = this.input.slice(0, this.caret)
        return
      }
      if (code === 13 || code === 10) return this.submit()
      if (code === 127 || code === 8) return this.backspace()
      if (code < 32) return
      this.insert(ch)
      return
    }
    switch (key.name) {
      case 'up':
        this.scrollBy(1)
        break
      case 'down':
        this.scrollBy(-1)
        break
      case 'pageup':
        this.scrollBy(Math.max(1, (this.canvas.rows || 20) - 6))
        break
      case 'pagedown':
        this.scrollBy(-Math.max(1, (this.canvas.rows || 20) - 6))
        break
      case 'left':
        this.caret = Math.max(0, this.caret - 1)
        break
      case 'right':
        this.caret = Math.min(this.input.length, this.caret + 1)
        break
      case 'home':
        this.caret = 0
        break
      case 'end':
        this.caret = this.input.length
        break
      case 'delete':
        this.input = this.input.slice(0, this.caret) + this.input.slice(this.caret + 1)
        break
      case 'escape':
        this.onEscape()
        break
      default:
        break
    }
  }

  onCtrlC() {
    if (this.busy) {
      this.agent?.cancel()
      return
    }
    if (this.input.length) {
      this.input = ''
      this.caret = 0
      return
    }
    this.stop()
  }

  onEscape() {
    if (this.busy) this.agent?.cancel()
  }

  insert(text) {
    this.input = this.input.slice(0, this.caret) + text + this.input.slice(this.caret)
    this.caret += text.length
  }

  backspace() {
    if (this.caret === 0) return
    this.input = this.input.slice(0, this.caret - 1) + this.input.slice(this.caret)
    this.caret -= 1
  }

  scrollBy(delta) {
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + delta))
  }

  // ------------------------------------------------------------------ 对话

  submit() {
    const text = this.input.trim()
    if (!text || this.busy) return
    this.input = ''
    this.caret = 0
    this.scroll = 0

    if (text === '/quit' || text === '/exit') return this.stop()
    if (text === '/help') {
      this.note(
        '命令：/card 看形象卡（她是谁都在这一个文件里） · /favor +8 调好感度 · /clear 清空对话 · ' +
          '/new 开新会话 · /forget 忘掉上次的会话 · /remember <内容> 让她记住一件事 · ' +
          '/mouse 开关鼠标摸头 · /sticker 现在弹一张表情包 · ' +
          '/effort <off|low|high|max> 改推理强度 · /balance 查余额和峰谷 · /quit 退出。' +
          'Ctrl+C 取消当前回合，PgUp/PgDn 滚动。把鼠标放到鲸鱼娘身上她会露出超享受的表情～' +
          '开了鼠标之后，点状态栏上的「思考 X」还能直接换档。',
      )
      return
    }
    if (text === '/card' || text.startsWith('/card ')) {
      const arg = text.slice('/card'.length).trim()
      if (arg === 'reload') {
        this.loadCard()
        this.applyProfile().catch(() => {})
        this.note(this.character ? `形象卡重新读过了：${cardSummary(this.character)}` : '还是没读到形象卡。')
        return
      }
      const info = this.characterInfo || {}
      if (info.source === 'error') {
        this.note(`形象卡读不了：${info.error}`)
      }
      if (!this.character) {
        this.note('没找到形象卡。想有一张的话，把它放到下面任意一个位置：')
        this.note(`  1. 工作目录里的「形象卡.md」（或 工作目录/形象卡/某个.md）`)
        this.note(`  2. 记忆目录里的「形象卡.md」：${this.memoryDir}`)
        this.note('或者启动时用 --card <文件> 指定。')
        return
      }
      const weight = cardWeight(this.character)
      this.note(`形象卡：${this.character.file}${info.source === 'bundled' ? '（从发行包复制来的）' : ''}`)
      this.note(`状态：${cardSummary(this.character)}`)
      this.note(`分量：人设 ${weight.persona} 字 · 记忆 ${weight.memory} 字 · 日志 ${weight.log} 字（每轮都带）`)
      this.note('想改她的性格、称呼、记得的事，直接编辑那个文件；改完敲 /card reload。')
      return
    }
    if (text === '/favor' || text.startsWith('/favor ')) {
      if (!this.character) {
        this.note('现在没挂形象卡，好感度没地方记。')
        return
      }
      const raw = text.slice('/favor'.length).trim()
      if (!raw) {
        this.note(`她现在的状态：${cardSummary(this.character)}`)
        return
      }
      const delta = /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN
      if (!Number.isFinite(delta)) {
        this.note('用法：/favor +8 · /favor -3 · /favor 45')
        return
      }
      const result = this.changeFavor(delta)
      if (result) {
        this.note(`好感度 ${result.before}% → ${result.after}%`)
        if (result.after >= 100) this.note('（已经满了……才、才不是因为高兴呢。）')
      }
      return
    }
    if (text === '/sticker') {
      if (!this.stickers.length) {
        this.note(
          this.stickerDir
            ? `${this.stickerDir} 里一张 PNG 都没有。`
            : '没找到表情包目录。把 PNG 放进 <工作目录>/表情包，或用 --stickers <目录> 指定。',
        )
        return
      }
      this.cardCoolUntil = 0
      this.showCard({ phase: this.phase, force: true })
      if (this.card) this.note(`表情包 ${this.stickers.length} 张 · ${this.stickerDir}`)
      else this.note(`这个状态（${this.phase}）暂时没有对应的表情包。`)
      return
    }
    if (text === '/mouse') {
      this.mouseEnabled = !this.mouseEnabled
      this.stdout.write(this.mouseEnabled ? MOUSE_ON : MOUSE_OFF)
      this.hoverUntil = 0
      this.note(this.mouseEnabled ? '鼠标摸头已打开，主人来摸摸看～' : '鼠标摸头已关闭（主人可以正常框选文字了）。')
      return
    }
    if (text === '/balance') {
      if (!this.balanceEnabled) {
        this.note('余额查询被关掉了（启动时加了 --no-balance）。')
        return
      }
      this.note('正在问 DeepSeek 要余额…')
      this.refreshBalance({ force: true })
        .then((snapshot) => {
          if (!snapshot) return
          const peak = peakInfo()
          if (snapshot.ok) {
            this.note(
              `余额 ${formatMoney(snapshot.totalBalance, snapshot.currency)} ${snapshot.currency}` +
                `（来源 ${snapshot.source}）· 现在${peak.label}` +
                (peak.remainMs != null ? `，${peak.countdownLabel} ${formatCountdown(peak.remainMs)}` : ''),
            )
          } else {
            this.note(`余额没读到：${snapshot.error}`)
          }
        })
        .catch(() => {})
      return
    }
    if (text === '/effort' || text.startsWith('/effort ')) {
      const arg = text.slice('/effort'.length).trim().toLowerCase()
      if (!arg) {
        this.note(`现在的推理强度：${effortLabel(this.effort)}（${this.effort}）。可选 ${EFFORTS.join(' / ')} / default`)
        return
      }
      this.note(`正在把推理强度改成「${effortLabel(arg)}」…`)
      this.applyEffort(arg).catch(() => {})
      return
    }
    if (text === '/clear') {
      this.transcript = []
      this.note('对话已清空（记忆和会话历史都还在）。')
      return
    }
    if (text === '/memory') {
      if (this.memoryOff) {
        this.note('记忆被关掉了（启动时加了 --no-memory）。')
        return
      }
      const files = this.memory.files || {}
      this.note(`记忆目录：${this.memoryDir}`)
      if (files.persona) this.note(`人设（想改就改这个文件）：${files.persona}`)
      if (files.memory) this.note(`记忆（每回合自动追加，现有 ${this.memoryCount} 条）：${files.memory}`)
      const patched = this.agent && this.agent.patch
      const saved = this.memory.state
      this.note(
        saved && saved.sessionId
          ? `上次的会话：${saved.sessionId}（${formatWhen(new Date(saved.updatedAt || Date.now()))}）`
          : '还没有上次的会话，这一轮会是全新的。',
      )
      this.note(patched ? `人设已经挂上去了（${patched}）` : '人设还没挂上去（下一次启动或 /effort 时会挂）。')
      return
    }
    if (text === '/remember' || text.startsWith('/remember ')) {
      const body = text.slice('/remember'.length).trim()
      if (!body) {
        this.note('用法：/remember 主人喜欢用 pnpm，不要用 npm')
        return
      }
      if (this.memoryOff) {
        this.note('记忆被关掉了（启动时加了 --no-memory）。')
        return
      }
      appendMemory(this.memoryDir, { manual: body, cwd: this.cwd })
      this.memoryCount += 1
      // 重新拼系统提示词，让这一条下个回合就生效。
      this.applyProfile().catch(() => {})
      this.note(`记住了：「${body.slice(0, 60)}」· 下个回合开始她就知道了`)
      return
    }
    if (text === '/forget') {
      clearState(this.memoryDir)
      if (this.agent) this.agent.sessionId = null
      if (this.memory) this.memory.state = null
      this.note('忘掉上一次的会话了（人设和记忆.md 没动）。下回从新会话开始。')
      return
    }
    if (text === '/new') {
      this.transcript = []
      if (this.agent) this.agent.sessionId = null
      clearState(this.memoryDir)
      if (this.memory) this.memory.state = null
      this.note('已开一个新会话。人设和记忆还在，只是不再续上一次的历史了。')
      return
    }

    this.transcript.push({ kind: 'user', text })
    this.turnPrompt = text
    this.turnTools = []
    this.turnReply = ''
    // 「第 N 次会话」在主人真的开口之后才算数：开机就 +1 的话，
    // 随手开开关关几次，这个数字就没意义了。
    if (this.character && !this.characterCounted) {
      this.characterCounted = true
      try {
        setCardState(this.character, { sessions_count: (Number(this.character.state.sessions_count) || 0) + 1 })
        writeCard(this.character)
      } catch (error) {
        this.note(`形象卡没写回去：${String(error && error.message).slice(0, 120)}`)
      }
    }
    this.userContext = readContext(text)
    this.reply = ''
    this.idleSince = Date.now()
    if (!this.agent) {
      this.transcript.push({ kind: 'error', text: '没有可用的智能体后端。' })
      return
    }
    this.busy = true
    this.liveText = null
    this.toolIndex.clear()
    this.setPhase('thinking')
    this.seed++
    this.bubble = pickLine('thinking', this.seed)
    this.turnStart = Date.now()
    // 一上来就察觉到情绪不对（或者你在撒娇），立刻弹一张表情包。
    if (this.userContext.hostile || this.userContext.flirty || this.userContext.scoff) {
      this.showCard({ feeling: this.userContext.hostile ? 'error' : 'generic' })
    }
    this.agent.run(text, {
      onEvent: (event) => this.onAgentEvent(event),
      onDone: (result) => this.onAgentDone(result),
    })
  }

  /** 跨目录的废 sessionId 已经丢掉，拿同一句话原样重来一次（不重复记用户那行）。 */
  retryTurn() {
    const text = this.turnPrompt
    if (!text || !this.agent) return false
    this.retriedTurn = true
    this.busy = true
    this.liveText = null
    this.toolIndex.clear()
    this.turnTools = []
    this.reply = ''
    this.idleSince = Date.now()
    this.setPhase('thinking')
    this.seed++
    this.bubble = pickLine('thinking', this.seed)
    this.turnStart = Date.now()
    this.agent.run(text, {
      onEvent: (event) => this.onAgentEvent(event),
      onDone: (result) => this.onAgentDone(result),
    })
    return true
  }

  onAgentEvent(event) {
    switch (event.type) {
      case 'error': {
        // dsh 拒绝跨目录续接会话（旧版本留下的 state.json 会这样）。
        // 撞上了就把这份 id 丢掉再重来一次，别让人对着「code 1」反复按回车。
        const message = String(event.message || '')
        if (/was recorded in/i.test(message)) {
          if (this.agent) this.agent.sessionId = null
          this.sessionCwdMismatch = true
          this.note('这个会话是在别的目录里开的，续不上 —— 已经换成新会话，我重来一次。')
          return
        }
        if (message) this.transcript.push({ kind: 'error', text: message })
        return
      }
      case 'text': {
        const text = String(event.text ?? '').trim()
        if (!text) return
        this.transcript.push({ kind: 'assistant', text })
        this.reply += text
        this.idleSince = Date.now()
        if (this.phase === 'thinking' || this.phase === 'idle') this.setPhase('working')
        this.bubble = pickLine('working', this.seed)
        return
      }
      case 'tool_call': {
        const description = describeToolEvent(event) || event.tool || '工具调用'
        const toolName = String(event.tool || event.name || '').trim()
        if (toolName) this.turnTools.push(toolName)
        this.setPhase('working')
        this.bubble = pickLine('working', this.seed)
        const kind = /glob|read|list|search|grep/i.test(description) ? 'tool' : 'tool'
        this.transcript.push({ kind, text: description, callId: event.callId, status: 'running' })
        if (event.callId) this.toolIndex.set(event.callId, this.transcript.length - 1)
        return
      }
      case 'tool_result': {
        const index = event.callId != null ? this.toolIndex.get(event.callId) : undefined
        const failed = event.status === 'error' || event.status === 'failed'
        if (index != null && this.transcript[index]) {
          this.transcript[index].status = failed ? 'error' : 'ok'
        }
        const body = String(event.result ?? '')
        const firstLine = body.split('\n').find((line) => line.trim()) || ''
        if (firstLine) {
          this.transcript.push({
            kind: failed ? 'tool-error' : 'tool-output',
            text: firstLine.trim(),
          })
        }
        return
      }
      case 'status': {
        if (event.phase === 'step_end' && event.usage) {
          const u = event.usage
          if (u.totalTokens) {
            this.tokensUsed += u.totalTokens
            this.usage = `↑${u.inputTokens ?? 0} ↓${u.outputTokens ?? 0} · 缓存 ${u.cacheReadTokens ?? 0}`
          }
        }
        if (event.phase === 'step_start' && !this.transcript.some((e) => e.status === 'running')) {
          this.setPhase('thinking')
        }
        return
      }
      default:
        return
    }
  }

  onAgentDone(result) {
    // 跨目录的废 sessionId：id 已经在 onAgentEvent 里丢掉了，同一句话自动重来一次。
    if (!result.ok && this.sessionCwdMismatch && !this.retriedTurn) {
      this.sessionCwdMismatch = false
      if (this.retryTurn()) return
    }
    this.retriedTurn = false
    this.busy = false
    this.liveText = null
    for (const entry of this.transcript) {
      if (entry.status === 'running') entry.status = result.ok ? 'ok' : 'error'
    }
    const flags = this.userContext
    this.userContext = {}
    if (result.ok) {
      this.setPhase('done')
      this.seed++
      this.bubble = pickLine('done', this.seed)
      this.showCard({ phase: 'done', force: true, ...flags })
    } else {
      this.setPhase('error')
      this.seed++
      this.bubble = pickLine('error', this.seed)
      this.transcript.push({
        kind: 'error',
        text: result.error || `智能体退出（code ${result.code}）。`,
      })
      this.showCard({ phase: 'error', feeling: 'error', force: true })
    }
    this.idleSince = Date.now()
    // 「自动保存上一次会话」就落在这儿：每回合结束记一条摘要 + 记住 sessionId。
    this.turns = (this.turns || 0) + 1
    this.recordTurn({ prompt: this.turnPrompt, reply: this.reply, tools: this.turnTools, ok: result.ok })
    this.turnPrompt = ''
    this.turnTools = []
  }

  note(text) {
    this.transcript.push({ kind: 'note', text })
  }

  /**
   * 启动时把「表情包到底找没找到」直接写进对话。
   * 找不到目录是最常见的问题，写在脸上比让用户猜强。
   */
  noteStickerStatus() {
    const head = `鲸鱼娘 v${VERSION}`
    if (this.stickers.length) {
      this.note(`${head} · 已加载 ${this.stickers.length} 张表情包（${this.stickerDir}）`)
    } else if (this.stickerDir) {
      this.note(`${head} · ${this.stickerDir} 里一张 PNG 都没有。`)
    } else {
      this.note(
        `${head} · 没找到表情包目录。把 PNG 放进 ${this.cwd}\\表情包，` +
          '或用 --stickers <目录> 指定（VS Code 里是设置 whaleChan.stickers）。',
      )
    }
  }

  /**
   * 启动时把「形象卡读到没有」写在脸上。
   * 卡是主人能改的（也是应该改的），改了没生效时得一眼看得出来读的是哪一份。
   */
  noteCardStatus() {
    const info = this.characterInfo || {}
    if (info.source === 'off') return
    if (info.source === 'error') {
      this.note(`形象卡读不了：${info.error}`)
      this.note('这次退回旧的人设.md + 记忆.md。卡修好了敲 /card 重新读。')
      return
    }
    if (!this.character) {
      this.note('没找到形象卡，这次用旧的人设.md + 记忆.md（敲 /card 看该放哪儿）。')
      return
    }
    const weight = cardWeight(this.character)
    this.note(`形象卡 · ${cardSummary(this.character)}`)
    this.note(
      `${this.character.file}${info.source === 'bundled' ? '（第一次跑，已把自带的那张复制过来）' : ''}`,
    )
    this.note(
      `每轮带着 ${weight.total} 字（人设 ${weight.persona} + 记忆 ${weight.memory} + 日志 ${weight.log}）` +
        '｜想改就直接编辑这个文件 · /card 详情 · /favor +8 调好感度',
    )
  }

  /**
   * 启动时把「人设和记忆到底读到没有」写在脸上。
   * 这两个文件是主人能改的，改了没生效时得一眼看得出来读的是哪一份。
   */
  noteMemoryStatus(saved) {
    if (this.character) return // 有形象卡的时候就别再说一遍老机制了
    if (this.memoryOff) {
      this.note('记忆已关闭（启动时加了 --no-memory），这次谁都不记得。')
      return
    }
    const dir = this.memoryDir
    if (saved && saved.sessionId) {
      const short = String(saved.sessionId).replace(/^session-/, '').slice(0, 8)
      this.note(`接着上次聊（会话 ${short}｜${formatWhen(new Date(saved.updatedAt || Date.now()))}）`)
    }
    this.note(
      `人设 ${this.persona.length} 字 · 记忆 ${this.memoryCount} 条（${dir}）` +
        `｜/memory 看路径 · /remember <内容> 让她记住`,
    )
  }

  // -------------------------------------------------------------- 表情包气泡

  /** 现在该不该弹卡片：冷却期内不弹，除非 force。 */
  maybeCard(context, { force = false } = {}) {
    if (!this.stickers.length) return
    if (!force && Date.now() < this.cardCoolUntil) return
    this.showCard(context)
  }

  /**
   * 按「当前在干什么 + 刚才聊了什么」挑一张表情包，弹在界面中央。
   * 目录里没有对应分类时 matchSticker 会返回 null，这里就什么都不做。
   */
  showCard(context = {}) {
    if (!this.stickers.length) return
    this.cardSeq++
    const pick = matchSticker(this.stickers, {
      phase: this.phase,
      thinkingMs: this.turnStart && this.busy ? Date.now() - this.turnStart : 0,
      instant: Boolean(this.turnStart) && !this.busy && Date.now() - this.turnStart < 1500,
      balance: this.tokenBudget > 0 ? this.tokensUsed / this.tokenBudget : 0,
      seed: this.cardSeq,
      ...this.userContext,
      ...context,
    })
    if (!pick) return
    const feeling = pickFeeling(context.feeling || cardFeeling(this.phase), this.cardSeq)
    // 干完活那张看一下就收，别挡着用户读答案。
    const ms = context.phase === 'done' ? 4200 : CARD_MS
    this.card = { ...pick, feeling, until: Date.now() + ms }
    this.cardCoolUntil = Date.now() + 12000
  }

  dismissCard() {
    if (!this.card) return false
    this.card = null
    return true
  }

  // ------------------------------------------------------------------ 渲染

  render() {
    const canvas = this.canvas
    const { cols, rows } = canvas
    if (cols < 24 || rows < 6) return
    canvas.clear(THEME.bg)

    const bodyTop = 1
    const inputRow = rows - 2
    const statusRow = rows - 1
    const bodyH = Math.max(1, inputRow - bodyTop)

    this.renderHeader(canvas)

    // 只要放得下就画鲸鱼娘。以前是 cols<64||rows<16 就整块不画，而 VS Code 的
    // 集成终端面板常常只有十几行高，于是角色永远不会出现。
    let whaleWidth = 0
    if (cols >= 40 && bodyH >= 5) {
      const want = Math.max(18, Math.min(62, Math.round(cols * 0.44)))
      // 她是接近方的，所以面板再宽也用不上；按正文高度掐一下，别留一大块空地。
      const fitCap = Math.max(18, Math.min(want, (bodyH - 2) * 2 + 3))
      if (cols - fitCap >= 26) whaleWidth = fitCap
    }
    if (whaleWidth > 0) this.renderWhale(canvas, 0, bodyTop, whaleWidth, bodyH)
    this.whaleRect = whaleWidth > 0 ? { x: 0, y: bodyTop, w: whaleWidth, h: bodyH } : null
    if (whaleWidth === 0) this.spriteRect = null

    const chatX = whaleWidth > 0 ? whaleWidth + 1 : 0
    this.renderChat(canvas, chatX, bodyTop, cols - chatX, bodyH)

    this.renderInput(canvas, inputRow)
    this.renderStatus(canvas, statusRow)

    // 表情包气泡画在最上层：挂在她头顶，绝不进右栏。
    if (this.card && Date.now() < this.card.until) {
      this.renderCard(
        whaleWidth > 0
          ? { x: 0, y: bodyTop + 1, w: whaleWidth, h: bodyH - 1 }
          : { x: 0, y: bodyTop, w: cols, h: bodyH },
      )
    } else if (this.card) {
      this.card = null
    }
  }

  /**
   * 表情包气泡：一张用户自备的 PNG（渲染成半格像素画）+ 她的一句感想。
   * 尺寸跟着终端走，太小的窗口直接不画，免得糊成一团。
   */
  // 表情包以**气泡**的形式挂在她头顶上。
  // 它画在左栏、贴着她的 spriteRect 往上长，所以永远盖不到右边的对话区。
  renderCard(bounds) {
    const card = this.card
    if (!card) return
    const canvas = this.canvas
    const w = Math.min(bounds.w - 2, 46)
    if (w < 24) return

    const artW = Math.max(10, Math.min(20, Math.floor(w * 0.46)))
    // 只占她头顶空出来的那些行。
    const headY = this.spriteRect ? this.spriteRect.y : bounds.y + bounds.h
    const room = Math.max(0, headY - bounds.y - 1)
    if (room < 9) return
    const artMaxH = Math.max(0, room - 6) * 2
    const art = artMaxH >= 8 ? getStickerFit(card.file, artW, artMaxH) : null
    const artRows = art ? art.height >> 1 : 0

    const textW = Math.max(8, w - 4)
    const lines = wrapText(card.feeling, textW).slice(0, 3)
    const inner = 1 + (art ? artRows : 0) + lines.length + 1
    const h = Math.min(room, 2 + inner)
    if (h < 9) return

    // 底边贴在她头顶上方一格；头顶空间不够就顶到面板顶部。
    const x = bounds.x + Math.max(0, Math.round((bounds.w - w) / 2))
    const y = Math.max(bounds.y, headY - h - 1)

    // 圆角外框 —— 让它一眼读成「气泡」而不是「浮窗」
    canvas.fill(x, y, w, h, ' ', THEME.text, THEME.band)
    canvas.text(x, y, `╭${'─'.repeat(Math.max(0, w - 2))}╮`, THEME.accent, THEME.band)
    canvas.text(x, y + h - 1, `╰${'─'.repeat(Math.max(0, w - 2))}╯`, THEME.accent, THEME.band)
    for (let i = 1; i < h - 1; i++) {
      canvas.text(x, y + i, '│', THEME.accent, THEME.band)
      canvas.text(x + w - 1, y + i, '│', THEME.accent, THEME.band)
    }
    canvas.text(x + 2, y + 1, truncate(`✦ ${CARD_TITLE[card.key] || card.name}`, textW), THEME.white, THEME.band)

    let row = y + 2
    if (art) {
      const px = x + Math.max(1, Math.round((w - art.width) / 2))
      canvas.fill(px - 1, row, art.width + 2, artRows, ' ', THEME.white, CARD_BG)
      drawFrame(canvas, px, row, art, CARD_BG)
      row += artRows
    }
    for (const line of lines) {
      if (row >= y + h - 2) break
      canvas.text(x + 2 + Math.max(0, Math.floor((textW - line.length) / 2)), row, line, THEME.accent, THEME.band)
      row++
    }
    canvas.text(
      x + 2,
      y + h - 2,
      truncate(`— 表情包 / ${card.name}`, textW),
      THEME.faint,
      THEME.band,
    )

    // 指向她头顶的小尖角
    if (y + h < bounds.y + bounds.h) {
      canvas.text(x + Math.floor(w / 2), y + h, '▼', THEME.accent, THEME.panel)
    }
  }

  renderHeader(canvas) {
    const { cols } = canvas
    canvas.fill(0, 0, cols, 1, ' ', THEME.text, THEME.headerBg)
    let x = 1
    x = canvas.text(x, 0, '鲸鱼娘', THEME.white, THEME.headerBg)
    x = canvas.text(x + 1, 0, '·', THEME.faint, THEME.headerBg)
    x = canvas.text(x + 1, 0, '终端智能体', THEME.accent, THEME.headerBg)
    const backend = this.agent?.label || this.agent?.constructor?.name || '离线'
    x = canvas.text(x + 1, 0, `· ${backend}`, THEME.faint, THEME.headerBg)
    const right = truncate(this.cwd, Math.max(0, Math.floor(cols * 0.45)))
    canvas.text(Math.max(x + 1, cols - strWidth(right) - 2), 0, right, THEME.dim, THEME.headerBg)
  }

  renderWhale(canvas, x, y, width, height) {
    canvas.fill(x, y, width, height, ' ', THEME.text, THEME.panel)

    // 顶部：台词气泡
    canvas.fill(x, y, width, 1, ' ', THEME.accent, THEME.band)
    canvas.text(x + 1, y, '「', THEME.accent, THEME.band)
    canvas.text(x + 2, y, truncate(this.bubble, width - 4), THEME.accent, THEME.band)
    canvas.text(x + width - 1, y, '」', THEME.accent, THEME.band)

    // 底部：状态说明
    const sid = this.agent?.sessionId ? String(this.agent.sessionId).replace(/^session-/, '') : ''
    const sidLabel = sid ? (sid.length > 12 ? `${sid.slice(0, 8)}…` : sid) : '新会话'
    const caption = `${PHASE_LABEL[this.phase] ?? this.phase} · ${sidLabel}`
    canvas.fill(x, y + height - 1, width, 1, ' ', THEME.dim, THEME.bandDim)
    canvas.text(x + 2, y + height - 1, truncate(caption, width - 4), PHASE_COLOR[this.phase], THEME.bandDim)

    const availTop = y + 1
    // 表情包气泡挂在头顶时，她被让到下半截，把上面让给气泡。
    // 面板太矮就不让了 —— 那种尺寸下气泡本来也画不出来。
    const cardOn = !!(this.card && Date.now() < this.card.until) && height - 2 >= 17
    const availH = cardOn ? Math.max(5, Math.floor((height - 2) * 0.45)) : height - 2
    const availW = width - 2
    this.spriteRect = null
    if (availH < 2 || availW < 4) return

    const now = Date.now()
    const purring = this.hoverUntil > now || this.purrUntil > now
    const face = this.pickFace(purring)
    const frame = getQFrameFit(face, availW, availH * 2)
    const fw = frame.width
    const fh = frame.height
    const rowsTall = fh >> 1
    const ox = x + Math.floor((width - fw) / 2)
    // 她贴着面板底边站（「整体下移」），头顶空出来的地方正好留给表情包气泡。
    const oy = Math.max(availTop, y + height - 1 - rowsTall)
    drawFrame(canvas, ox, oy, frame, THEME.panel)
    this.spriteRect = { x: ox, y: oy, w: fw, h: rowsTall }
  }

  /** 平时按阶段挑表情；被鼠标碰到时改成眯眼享受的两帧循环。 */
  pickFace(purring) {
    if (purring) return HOVER_FACES[Math.floor(this.tickCount / HOVER_SPEED) % HOVER_FACES.length]
    const faces = PHASE_FACES[this.phase] || PHASE_FACES.idle
    const speed = PHASE_SPEED[this.phase] || 3
    return faces[Math.floor(this.tickCount / speed) % faces.length]
  }

  renderChat(canvas, x, y, width, height) {
    if (width < 8) return
    canvas.fill(x, y, width, height, ' ', THEME.text, THEME.bg)
    canvas.fill(x, y, width, 1, ' ', THEME.text, THEME.bandDim)
    canvas.text(x + 1, y, '对话', THEME.white, THEME.bandDim)
    const hint = this.scroll > 0 ? `↑ 已上翻 ${this.scroll} 行` : 'Enter 发送'
    canvas.text(Math.max(x + 6, x + width - strWidth(hint) - 2), y, hint, THEME.faint, THEME.bandDim)

    const inner = width - 2
    const lines = this.layoutTranscript(inner)
    const chatTop = y + 1
    const chatH = height - 1
    this.maxScroll = Math.max(0, lines.length - chatH)
    if (this.scroll > this.maxScroll) this.scroll = this.maxScroll
    const start = Math.max(0, lines.length - chatH - this.scroll)
    const visible = lines.slice(start, start + chatH)
    const offset = Math.max(0, chatH - visible.length)
    for (let i = 0; i < visible.length; i++) {
      canvas.text(x + 1, chatTop + offset + i, visible[i].text, visible[i].color, THEME.bg)
    }
  }

  layoutTranscript(width) {
    const out = []
    const push = (prefix, indent, text, color, widthOverride) => {
      const limit = Math.max(4, (widthOverride ?? width) - strWidth(prefix))
      const chunks = wrapText(text, limit)
      chunks.forEach((chunk, i) => {
        out.push({ text: (i === 0 ? prefix : indent) + chunk, color })
      })
    }
    for (const entry of this.transcript) {
      if (entry.kind === 'user') push('你 › ', '  ', entry.text, THEME.user)
      else if (entry.kind === 'assistant') push('鲸鱼娘 › ', '    ', entry.text, THEME.text)
      else if (entry.kind === 'tool') {
        const mark = entry.status === 'error' ? '✗' : entry.status === 'ok' ? '✓' : '⚙'
        const color = entry.status === 'error' ? THEME.error : entry.status === 'ok' ? THEME.ok : THEME.tool
        push(`  ${mark} `, '    ', entry.text, color)
      } else if (entry.kind === 'tool-output') push('    ↳ ', '      ', entry.text, THEME.faint)
      else if (entry.kind === 'tool-error') push('    ↳ ', '      ', entry.text, THEME.error)
      else if (entry.kind === 'error') push('  ✗ ', '    ', entry.text, THEME.error)
      else push('  · ', '    ', entry.text, THEME.dim)
      out.push({ text: '', color: THEME.dim })
    }
    while (out.length && out[out.length - 1].text === '') out.pop()
    return out
  }

  renderInput(canvas, row) {
    const { cols } = canvas
    canvas.fill(0, row, cols, 1, ' ', THEME.text, THEME.inputBg)
    if (this.busy) {
      const spin = SPINNER[this.tickCount % SPINNER.length]
      const seconds = this.turnStart ? ((Date.now() - this.turnStart) / 1000).toFixed(0) : '0'
      const label = this.phase === 'thinking' ? '鲸鱼娘正在思考' : '鲸鱼娘正在执行'
      canvas.text(1, row, `${spin} ${label}…  ${seconds}s`, THEME.warn, THEME.inputBg)
      const hint = 'Esc 取消'
      canvas.text(Math.max(2, cols - strWidth(hint) - 2), row, hint, THEME.faint, THEME.inputBg)
      return
    }
    canvas.text(0, row, ' › ', THEME.accent, THEME.inputBg)
    const fieldX = 3
    const fieldW = Math.max(4, cols - fieldX - 2)
    if (!this.input) {
      canvas.text(fieldX, row, truncate('主人，说点什么吧…（/help 看命令）', fieldW), THEME.faint, THEME.inputBg)
      this.caretCol = fieldX
      return
    }
    const { shown, caretCol } = visibleField(this.input, this.caret, fieldW)
    canvas.text(fieldX, row, shown, THEME.text, THEME.inputBg)
    this.caretCol = fieldX + caretCol
  }

  renderStatus(canvas, row) {
    const { cols } = canvas
    canvas.fill(0, row, cols, 1, ' ', THEME.dim, THEME.headerBg)
    const dot = this.busy ? '●' : this.phase === 'error' ? '✗' : this.phase === 'done' ? '✓' : '●'
    let x = 1
    x = canvas.text(x, row, dot, PHASE_COLOR[this.phase], THEME.headerBg)
    x = canvas.text(x + 1, row, PHASE_LABEL[this.phase] ?? this.phase, PHASE_COLOR[this.phase], THEME.headerBg)
    // 推理强度：一眼能看出现在烧的是哪一档。开着鼠标时它还是个按钮
    // —— 点一下往后换一档（记坐标见 onMouse，hot zone 会盖住它自己）。
    const effortText = this.mouseEnabled
      ? `思考 ${effortLabel(this.effort)} ↻`
      : `思考 ${effortLabel(this.effort)}`
    const effortX = x + 2
    this.effortRect = this.mouseEnabled ? { x: effortX, y: row, w: strWidth(effortText) } : null
    x = canvas.text(effortX, row, effortText, this.effort === 'default' ? THEME.faint : THEME.accent, THEME.headerBg)
    if (this.usage) x = canvas.text(x + 2, row, this.usage, THEME.faint, THEME.headerBg)
    // 余额 + 峰谷：高峰用 warn 色，谷时用 ok 色——贵不贵这件事最好不用读字。
    if (this.balanceEnabled) {
      const peak = peakInfo()
      x = canvas.text(x + 2, row, accountLine({ balance: this.balance }), peak.peak ? THEME.warn : THEME.ok, THEME.headerBg)
    }
    const tag = this.stickers.length ? `表情包 ${this.stickers.length}` : '表情包 ✗'
    x = canvas.text(x + 2, row, tag, this.stickers.length ? THEME.faint : THEME.warn, THEME.headerBg)
    const hints = 'Enter 发送 · Ctrl+C 取消/退出 · PgUp PgDn 滚动'
    const hintX = cols - strWidth(hints) - 2
    if (hintX > x + 2) canvas.text(hintX, row, hints, THEME.faint, THEME.headerBg)
  }

  /** 无 ANSI 的纯文本快照，用于 --screenshot 与自检。 */
  toPlainText() {
    const lines = []
    for (let y = 0; y < this.canvas.rows; y++) {
      let line = ''
      for (let x = 0; x < this.canvas.cols; x++) {
        const ch = this.canvas.chars[y * this.canvas.cols + x]
        line += ch === '' ? '' : ch
      }
      lines.push(line.replace(/\s+$/, ''))
    }
    return lines.join('\n')
  }
}

/** 计算单行输入在给定宽度里的可见片段与光标列。 */
export function visibleField(text, caret, width) {
  const chars = Array.from(text)
  const starts = []
  let acc = 0
  for (const ch of chars) {
    starts.push(acc)
    acc += charWidth(ch.codePointAt(0))
  }
  const caretChars = Array.from(text.slice(0, caret)).length
  const caretWidth = caretChars < starts.length ? starts[caretChars] : acc
  const offset = caretWidth >= width ? caretWidth - width + 1 : 0
  let shown = ''
  let caretCol = Math.max(0, caretWidth - offset)
  for (let i = 0; i < chars.length; i++) {
    const start = starts[i] - offset
    const w = charWidth(chars[i].codePointAt(0))
    if (start + w <= 0) continue
    if (start + w > width) break
    if (start >= 0) shown += chars[i]
  }
  if (caretCol >= width) caretCol = width - 1
  return { shown, caretCol }
}
