// 鲸鱼娘 Webview 面板的前端。
//
// 它本身没有智能体能力：所有对话都通过 postMessage 交给扩展宿主，扩展再和
// whalechan --bridge 那个 NDJSON 进程通信。这里只负责「画得好看」。

const vscode = acquireVsCodeApi()

const FRAMES = ['idle', 'blink', 'joy0', 'joy1', 'cheer', 'oops']
const F = Object.fromEntries(FRAMES.map((name, index) => [name, index]))

const PHASE_FRAME = { greet: 'joy0', idle: 'idle', thinking: 'blink', working: 'idle', done: 'cheer', error: 'oops' }
const PHASE_LABEL = { idle: '闲着', thinking: '在想…', working: '在动手', done: '做完了', error: '出错了' }

const el = {
  pet: document.getElementById('pet'),
  bubble: document.getElementById('bubble'),
  hearts: document.getElementById('hearts'),
  log: document.getElementById('log'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  stop: document.getElementById('stop'),
  fresh: document.getElementById('fresh'),
  pat: document.getElementById('pat'),
  phase: document.getElementById('phase'),
  stickerBadge: document.getElementById('sticker-badge'),
  account: document.getElementById('account'),
  effort: document.getElementById('effort'),
  favor: document.getElementById('favor'),
  memory: document.getElementById('memory'),
  cardLayer: document.getElementById('card-layer'),
}

const state = {
  phase: 'idle',
  busy: false,
  hover: false,
  patUntil: 0,
  blinkUntil: 0,
  nextBlink: Date.now() + 2600,
  version: '',
  streaming: null,
  cardTimer: null,
}

// ------------------------------------------------------------------ 画角色

function currentFrame() {
  const now = Date.now()
  if (state.hover || now < state.patUntil) {
    // 被摸的时候两帧爱心交替，看起来在动
    return Math.floor(now / 260) % 2 === 0 ? F.joy0 : F.joy1
  }
  if (now < state.blinkUntil) return F.blink
  const base = PHASE_FRAME[state.phase] || 'idle'
  if (base === 'idle' && now > state.nextBlink) {
    state.nextBlink = now + 2600 + Math.random() * 3200
    state.blinkUntil = now + 150
    return F.blink
  }
  return F[base] ?? 0
}

let lastFrame = -1
function tick() {
  const frame = currentFrame()
  if (frame !== lastFrame) {
    lastFrame = frame
    el.pet.style.setProperty('--frame', String(frame))
  }
  if (el.phase) el.phase.textContent = PHASE_LABEL[state.phase] || state.phase
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

function say(text) {
  if (!text) return
  el.bubble.textContent = text
  el.bubble.style.opacity = '1'
}

function popHearts(count = 6) {
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span')
    span.textContent = Math.random() < 0.35 ? '💙' : '💗'
    span.style.left = `${18 + Math.random() * 64}%`
    span.style.top = `${48 + Math.random() * 22}%`
    span.style.animationDelay = `${i * 70}ms`
    el.hearts.appendChild(span)
    setTimeout(() => span.remove(), 1800 + i * 70)
  }
}

function pat() {
  state.patUntil = Date.now() + 1400
  el.pet.classList.remove('pat')
  void el.pet.offsetWidth
  el.pet.classList.add('pat')
  popHearts(7)
  // 「摸摸头」是她好感度唯一会自己涨的地方。涨不涨由 bridge 说了算
  // （每分钟最多一次），这里只负责把动作报上去。
  vscode.postMessage({ type: 'pat' })
}

el.pet.addEventListener('mouseenter', () => {
  state.hover = true
})
el.pet.addEventListener('mouseleave', () => {
  state.hover = false
})
el.pet.addEventListener('click', pat)
el.pat.addEventListener('click', pat)

// ------------------------------------------------------------------ 对话流

function clearStream() {
  state.streaming = null
}

function addRow(className, text) {
  const row = document.createElement('div')
  row.className = `row ${className}`
  const body = document.createElement('div')
  body.className = className.includes('note') || className.includes('tool') || className.includes('think') || className.includes('stderr') || className.includes('files') ? className.split(' ')[0] : 'bubble-msg'
  body.textContent = text
  row.appendChild(body)
  el.log.appendChild(row)
  scrollDown()
  return body
}

function scrollDown() {
  el.log.scrollTop = el.log.scrollHeight
}

function assistantRow() {
  if (state.streaming?.body?.isConnected) return state.streaming.body
  const row = document.createElement('div')
  row.className = 'row'
  const name = document.createElement('div')
  name.className = 'whale-name'
  name.textContent = '鲸鱼娘'
  const body = document.createElement('div')
  body.className = 'bubble-msg'
  row.append(name, body)
  el.log.appendChild(row)
  clearStream()
  state.streaming = { body }
  scrollDown()
  return body
}

function userRow(text) {
  clearStream()
  const row = document.createElement('div')
  row.className = 'row me'
  const body = document.createElement('div')
  body.className = 'bubble-msg'
  body.textContent = text
  row.appendChild(body)
  el.log.appendChild(row)
  scrollDown()
}

let lastToolRow = null

// 会改文件、值得让 VS Code 刷新 / 跟过去的工具名。
const FILE_TOOLS = new Set(['write', 'edit', 'str_replace', 'apply_patch', 'create', 'mkdir', 'notebook_edit'])

/** 从工具入参里捞出一个文件路径（不同工具字段名不一样）。 */
function fileOf(input) {
  if (!input || typeof input !== 'object') return null
  const raw = input.filePath || input.file_path || input.path || input.file || input.absolutePath || null
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

/** 把文件路径做成可点的胶囊；点了就让扩展在编辑器里打开它。 */
function fileChip(label, filePath) {
  const chip = document.createElement('span')
  chip.className = 'chip'
  chip.textContent = label
  chip.title = `在编辑器里打开 ${filePath}`
  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    vscode.postMessage({ type: 'openFile', path: filePath })
  })
  return chip
}

/** 本轮她动过的文件，用来在回合结束时列一份清单。 */
const touched = new Set()

function formatLeft(ms) {
  const total = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  if (days > 0) return `${days}天${hours}小时`
  if (hours > 0) return `${hours}小时${mins}分`
  return `${mins}分`
}

// ------------------------------------------------- 推理强度 / 好感度 / 记忆

const EFFORT_WORD = { default: '默认', off: '关', low: '低', high: '高', max: '最强' }

/** 推理强度那排小按钮：把当前那一档点亮。比下拉框好在「不用点开就知道现在是什么档」。 */
function setEffort(value) {
  if (!el.effort) return
  const want = EFFORT_WORD[value] ? value : 'default'
  for (const button of el.effort.querySelectorAll('button[data-effort]')) {
    button.classList.toggle('on', button.dataset.effort === want)
  }
  el.effort.dataset.value = want
}

/** 好感度。第一次拿到值之前显示「—」，不要假装是 0。 */
function setFavor(value) {
  if (!el.favor) return
  const ok = typeof value === 'number' && Number.isFinite(value)
  el.favor.textContent = ok ? `♥ ${Math.round(value)}%` : '♥ —'
  if (ok) el.favor.classList.add('favor')
}

/**
 * 面板里的斜杠命令。
 * 以前这里是无条件 postMessage({type:'ask'})，所以 /memory 会被当成
 * 一句「提示词」发给智能体 —— 她会认真回答一个叫 /memory 的问题。
 * 现在本地先认一遍，认得出来就当成命令发给 bridge。
 */
const COMMANDS = {
  '/balance': () => vscode.postMessage({ type: 'balance' }),
  '/memory': () => vscode.postMessage({ type: 'memory' }),
  '/card': () => vscode.postMessage({ type: 'memory' }),
  '/forget': () => vscode.postMessage({ type: 'forget' }),
  '/new': () => vscode.postMessage({ type: 'new' }),
  '/sticker': () => vscode.postMessage({ type: 'sticker' }),
}

function runCommand(text) {
  const space = text.search(/\s/)
  const head = (space === -1 ? text : text.slice(0, space)).toLowerCase()
  const rest = space === -1 ? '' : text.slice(space + 1).trim()

  if (head === '/help') {
    addRow('note', '命令：/memory 看她的人设和记忆在哪 · /remember <内容> 让她记住一件事 · /forget 忘掉上次的会话 · /favor +8 调好感度 · /effort <默认|关|低|高|最强> 改推理强度 · /balance 查余额 · /new 开新会话 · /clear 清空对话')
    return
  }
  if (head === '/remember') {
    if (!rest) addRow('note', '写法：/remember 主人喜欢喝冰美式')
    else vscode.postMessage({ type: 'remember', text: rest })
    return
  }
  if (head === '/favor') {
    // 没带参数就只是问一句「现在多少」，带参数才是改。
    if (!rest) vscode.postMessage({ type: 'favor', delta: 0 })
    else vscode.postMessage({ type: 'favor', delta: rest })
    return
  }
  if (head === '/effort') {
    if (!rest) {
      addRow('note', `现在的推理强度是「${EFFORT_WORD[el.effort?.dataset.value] || '默认'}」。写法：/effort 高`)
      return
    }
    vscode.postMessage({ type: 'effort', value: rest })
    return
  }
  if (head === '/clear') {
    el.log.textContent = ''
    addRow('note', '对话已清空（记忆和会话历史都还在）。')
    return
  }
  const fn = COMMANDS[head]
  if (fn) {
    fn()
    return
  }
  addRow('note', `不认识的命令 ${head}。打 /help 看看有哪些。`)
}

function handleEvent(msg) {
  switch (msg.type) {
    case 'hello':
      state.version = msg.version
      el.stickerBadge.textContent =
        msg.stickerCount > 0 ? `表情包 ${msg.stickerCount}` : '表情包 ✗（放几张 PNG 到 表情包/）'
      el.stickerBadge.className = `badge ${msg.stickerCount > 0 ? 'ok' : 'warn'}`
      document.getElementById('ver').textContent = `v${msg.version} · ${msg.dsh}`
      if (msg.effort) setEffort(msg.effort)
      setFavor(msg.card && typeof msg.card.favor === 'number' ? msg.card.favor : msg.favor)
      addRow('note', `鲸鱼娘 v${msg.version} · 工作目录 ${msg.cwd}`)
      if (msg.stickerCount > 0) addRow('note', `表情包 ${msg.stickerCount} 张 · ${msg.stickerDir}`)
      // 人设和记忆：这两句是给「怎么感觉她不像上次那个人了」准备的答案。
      if (msg.card && msg.card.summary) {
        // 有形象卡的时候，人设和记忆其实是卡里的两个小节，分开报反而看不懂。
        addRow('note', `形象卡 · ${msg.card.summary}`)
        addRow('note', `${msg.card.file}${msg.card.source === 'bundled' ? '（自带的那张）' : ''}`)
      } else if (msg.memoryEnabled) {
        addRow('note', `人设 ${msg.personaChars} 字 · 记忆 ${msg.memoryCount} 条 · ${msg.memoryDir}`)
      } else {
        addRow('note', '记忆已关闭，这次她是全新的。')
      }
      if (msg.memoryEnabled && msg.sessionId) {
        addRow('note', `接着上次聊（会话 ${String(msg.sessionId).replace(/^session-/, '').slice(0, 8)}）`)
      }
      break

    case 'memory':
      if (msg.card && msg.card.summary) {
        addRow('note', `形象卡 · ${msg.card.summary}`)
      } else {
        addRow('note', msg.enabled ? `记忆 ${msg.count} 条 · 人设 ${msg.personaChars} 字` : '记忆已关闭。')
      }
      break

    case 'favor':
      if (msg.after != null) setFavor(msg.after)
      // quiet = 只是问一句「现在多少」，不改也没必要刷一行日志。
      if (!msg.quiet) {
        addRow('note', msg.ok ? `好感度 ${msg.before} → ${msg.after}` : String(msg.error || '好感度没动'))
      }
      break

    case 'bubble':
      say(msg.text)
      break

    // 余额 + 峰谷：贵不贵这件事最好不用读字，高峰染成暖色、谷时染成绿色。
    // 内部拆成 <b>钱</b><i>峰谷</i><em>倒计时</em> 三段，窄面板靠 CSS 丢后两段。
    case 'account':
      if (el.account) {
        const money =
          msg.ok && msg.balance != null
            ? `${msg.currency === 'CNY' ? '¥' : ''}${Number(msg.balance).toFixed(2)} ${msg.currency === 'CNY' ? '' : msg.currency}`.trim()
            : msg.enabled
              ? '余额 —'
              : '余额 关'
        const peakWord = msg.peak ? '峰时' : '谷时'
        const left = msg.remainMs != null ? `${msg.countdownLabel} ${formatLeft(msg.remainMs)}` : ''
        el.account.innerHTML =
          `<b>${money}</b>` +
          (msg.enabled ? `<i>${peakWord}</i>` : '') +
          (msg.enabled && left ? `<em>${left}</em>` : '')
        el.account.className = `pill ${msg.enabled ? (msg.peak ? 'peak' : 'valley') : 'off'}`
        el.account.title = msg.enabled
          ? `现在${peakWord}${left ? ` · ${left}` : ''}` +
            `\n余额来源：${msg.source || '未知'}${msg.error ? `\n读取失败：${msg.error}` : ''}\n点一下立刻重查`
          : '启动时带了 --no-balance'
      }
      break

    case 'effort':
      if (msg.value) setEffort(msg.value)
      if (msg.error) addRow('error', `推理强度没改成功：${msg.error}`)
      else addRow('note', `推理强度改成「${msg.label}」，下一个回合生效。`)
      break

    case 'phase':
      state.phase = msg.phase
      state.busy = msg.phase === 'thinking' || msg.phase === 'working'
      el.send.disabled = state.busy
      el.stop.disabled = !state.busy
      break

    case 'thinking':
      clearStream()
      addRow('think', String(msg.text).slice(0, 400))
      break

    case 'tool': {
      const tool = String(msg.tool || 'tool')
      const input = msg.input || {}
      const file = fileOf(input)
      const detail = file || input.command || input.pattern || input.query || ''
      clearStream()
      lastToolRow = addRow('tool', `⚙ ${tool}${detail ? ` · ${String(detail).slice(0, 110)}` : ''}`)
      // 有文件路径的话贴一个可点的胶囊，并通知扩展刷新 / 跳到该文件。
      if (file) {
        lastToolRow.append(' ')
        lastToolRow.appendChild(fileChip('打开', file))
        if (FILE_TOOLS.has(tool)) touched.add(file)
        vscode.postMessage({ type: 'fileTouched', path: file, tool, write: FILE_TOOLS.has(tool) })
      }
      break
    }

    case 'tool_result': {
      const body = document.createElement('div')
      body.className = `tool-out${msg.status === 'error' ? ' error' : ''}`
      body.textContent = String(msg.result || '').slice(0, 1600)
      const row = document.createElement('div')
      row.className = 'row'
      row.appendChild(body)
      el.log.appendChild(row)
      scrollDown()
      break
    }

    case 'text':
      state.phase = 'working'
      assistantRow().textContent += msg.text
      scrollDown()
      break

    case 'stderr':
      addRow('stderr', String(msg.text).slice(0, 500))
      break

    case 'session':
      document.getElementById('session').textContent = `会话 ${String(msg.sessionId).replace(/^session-/, '').slice(0, 8)}`
      break

    case 'reset':
      el.log.innerHTML = ''
      clearStream()
      addRow('note', '新会话，之前说过的我都不记得了哦。')
      break

    case 'cancelled':
      addRow('note', '好，停下了。')
      break

    case 'error':
      addRow('note', msg.message)
      break

    case 'done':
      clearStream()
      state.busy = false
      el.send.disabled = false
      el.stop.disabled = true
      // 先把她动过的文件列出来，点一下就开 —— 「她干了什么」要看得见。
      if (touched.size) {
        const line = addRow('files', `改了 ${touched.size} 个文件：`)
        for (const file of touched) {
          line.append(' ')
          line.appendChild(fileChip(file.split(/[\\/]/).pop() || file, file))
        }
        touched.clear()
      }
      if (msg.ok) {
        addRow('note', `—— 完成，用了 ${(msg.elapsed / 1000).toFixed(1)} 秒 ——`)
      } else {
        addRow('note', `—— 出错了（${(msg.elapsed / 1000).toFixed(1)} 秒）——`)
      }
      break

    case 'card':
      showCard(msg)
      break

    default:
      break
  }
}

function showCard(msg) {
  if (state.cardTimer) clearTimeout(state.cardTimer)
  el.cardLayer.innerHTML = ''
  const card = document.createElement('div')
  card.className = 'card'

  const cap = document.createElement('div')
  cap.className = 'cap'
  const title = document.createElement('span')
  title.textContent = `✦ ${msg.title || '表情包'}`
  const name = document.createElement('span')
  name.className = 'n'
  name.textContent = msg.name
  cap.append(title, name)

  const body = document.createElement('div')
  body.className = 'body'
  const img = document.createElement('img')
  img.src = `data:image/png;base64,${msg.png}`
  img.alt = msg.name
  const feel = document.createElement('div')
  feel.className = 'feel'
  feel.textContent = msg.feeling || ''
  body.append(img, feel)

  const foot = document.createElement('div')
  foot.className = 'foot'
  foot.textContent = '点一下收起'
  card.append(cap, body, foot)
  card.addEventListener('click', hideCard)
  el.cardLayer.appendChild(card)
  el.cardLayer.classList.add('show')
  state.cardTimer = setTimeout(hideCard, msg.ms || 7000)
  say(msg.feeling || '')
}

function hideCard() {
  if (state.cardTimer) clearTimeout(state.cardTimer)
  state.cardTimer = null
  el.cardLayer.classList.remove('show')
}

el.cardLayer.addEventListener('click', (event) => {
  if (event.target === el.cardLayer) hideCard()
})

// ------------------------------------------------------------------ 输入

function send() {
  const text = el.input.value.trim()
  if (!text || state.busy) return
  hideCard()
  el.input.value = ''
  autoGrow()
  // 斜杠命令是给「她自己」的，不进对话流、不发给智能体 —— 否则 /memory
  // 会被当成一句提示词，而她会一本正经地回答一个叫 /memory 的问题。
  if (text.startsWith('/')) {
    runCommand(text)
    return
  }
  touched.clear()
  userRow(text)
  el.send.disabled = true
  state.busy = true
  vscode.postMessage({ type: 'ask', text })
}

function autoGrow() {
  el.input.style.height = 'auto'
  el.input.style.height = `${Math.min(120, el.input.scrollHeight)}px`
}

el.input.addEventListener('input', autoGrow)
el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
  if (event.key === 'Escape') vscode.postMessage({ type: 'cancel' })
})
el.send.addEventListener('click', send)
el.stop.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }))
if (el.account) el.account.addEventListener('click', () => vscode.postMessage({ type: 'balance' }))
// 推理强度：事件委托。那排按钮是活的，别一个个绑。
if (el.effort) {
  el.effort.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-effort]')
    if (button) vscode.postMessage({ type: 'effort', value: button.dataset.effort })
  })
}
if (el.favor) el.favor.addEventListener('click', () => vscode.postMessage({ type: 'favor', delta: 0 }))
if (el.memory) el.memory.addEventListener('click', () => vscode.postMessage({ type: 'memory' }))
el.fresh.addEventListener('click', () => {
  hideCard()
  vscode.postMessage({ type: 'new' })
})

window.addEventListener('message', (event) => handleEvent(event.data))
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideCard()
})

document.addEventListener('DOMContentLoaded', autoGrow)
vscode.postMessage({ type: 'ready' })
