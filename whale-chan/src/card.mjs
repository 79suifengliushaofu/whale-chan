// 形象卡：一个人一份文件。
//
// 为什么要有它：原来「她是谁」散在两个地方 —— 人设走 profile patch 的
// personaPrefix，记忆走 state.json + 记忆.md，两边各自读写，漏一处她就不像
// 上次那个人。形象卡把它压成一个文件：
//
//   ## 一、状态（机器可读）   ← ```json``` 块，好感度 / 称呼 / 会话数
//   ## 二、立绘（形象）        ← 她长什么样，哪一帧用在什么时候
//   ## 三、人设                ← 性格、口癖、边界
//   ## 四、记忆                ← 用户档案、项目、约定、时间线
//   ## 五、会话日志            ← 新条目追加在最上面
//
// 发行包里带一份默认卡（assets/cards/rinrin.md），第一次跑的时候复制到用户的
// 记忆目录去，之后只改那一份 —— 扩展目录是只读的，升级还会被覆盖。

import fs from 'node:fs'
import path from 'node:path'
import { formatWhen } from './memory.mjs'

const HERE = import.meta.dirname

/** 发行包里自带的那份卡。 */
export const BUNDLED_CARD = path.resolve(HERE, '../assets/cards/rinrin.md')

/** 用户记忆目录里的文件名。 */
export const CARD_NAME = '形象卡.md'

/** 卡片文件的上限。正常只有 70 多 KB，超过这个数基本是配错了路径（比如指到了整个目录）。 */
export const CARD_LIMIT = 2 * 1024 * 1024

/** 五个小节的标题。这些字符串是读写定位用的，改卡的时候别顺手改它们。 */
export const SECTION = {
  state: '## 一、状态（机器可读）',
  art: '## 二、立绘（形象）',
  persona: '## 三、人设',
  memory: '## 四、记忆',
  log: '## 五、会话日志（新条目追加在最上面）',
}

/** 日志标题的简易别名，容忍手写卡里少写几个字。 */
const LOG_ALIASES = [SECTION.log, '## 五、会话日志', '## 会话日志（新条目追加在最上面）', '## 会话日志']

/** 写文件时带 UTF-8 BOM：中文 Windows 的记事本和 PowerShell 5.1 靠它认编码。 */
const BOM = '\uFEFF'

/** 注入系统提示词时默认给多大。人设是她的全部，给足；记忆只给尾部。 */
export const PROMPT_LIMITS = {
  persona: 60000,
  memory: 8000,
  log: 6000,
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text
}

// ---------------------------------------------------------------- 解析

/** 把一份卡拆成「标题 + 一串小节」，小节之外的内容原样留着，写回时不丢东西。 */
export function parseCard(text, file = null) {
  const body = stripBom(String(text)).replace(/\r\n/g, '\n')
  const lines = body.split('\n')
  const sections = []
  let title = ''
  let intro = []
  let current = null

  for (const line of lines) {
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim()
      continue
    }
    // 只按 `## `（正好两个井号）切小节。`### 零、常驻规则` 这类是**正文**，
    // 第一次写成 /^(##+)\s+/ 时它们全被当成了兄弟小节，人设因此只剩一行。
    const heading = /^(##)\s+/.exec(line)
    if (heading) {
      current = { heading: line.trim(), body: [] }
      sections.push(current)
      continue
    }
    if (current) current.body.push(line)
    else intro.push(line)
  }

  for (const item of sections) {
    item.body = item.body.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
  }

  const find = (names) => sections.find((item) => names.includes(item.heading)) || null
  const stateSection = find([SECTION.state, '## 一、状态', '## 状态（机器可读）', '## 状态'])
  const logSection = find(LOG_ALIASES)

  let state = {}
  let stateError = null
  if (stateSection) {
    const match = /```json\s*(\{[\s\S]*?\})\s*```/.exec(stateSection.body)
    if (match) {
      try {
        state = JSON.parse(match[1])
      } catch (error) {
        stateError = `状态 JSON 解析失败：${error.message}`
      }
    } else {
      stateError = '状态小节里找不到 ```json``` 块'
    }
  } else {
    stateError = `找不到「${SECTION.state}」小节`
  }

  return {
    file,
    title: title || '形象卡',
    intro: intro.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''),
    sections,
    state,
    stateError,
    stateSection,
    logSection,
    name: state.name || title.replace(/^形象卡\s*·\s*/, '').replace(/（.*?）/, '') || '她',
  }
}

/** 把卡写回文本。`parsed.sections` 的改动会原样体现出来。 */
export function serializeCard(parsed) {
  const out = [`# ${parsed.title}`, '']
  if (parsed.intro) {
    out.push(parsed.intro, '')
  }
  for (const item of parsed.sections) {
    out.push(item.heading, '')
    if (item.body) out.push(item.body, '')
  }
  return `${BOM}${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`
}

// ---------------------------------------------------------------- 读写

export function readCard(file) {
  const stat = fs.statSync(file)
  if (stat.size > CARD_LIMIT) {
    throw new Error(`形象卡太大（${stat.size} 字节，上限 ${CARD_LIMIT}）：${file}`)
  }
  return parseCard(fs.readFileSync(file, 'utf8'), file)
}

export function writeCard(parsed) {
  if (!parsed.file) throw new Error('这份形象卡没有来源路径，写不回去')
  fs.mkdirSync(path.dirname(parsed.file), { recursive: true })
  fs.writeFileSync(parsed.file, serializeCard(parsed), 'utf8')
  return parsed.file
}

/** 改状态里的几个字段，其余原样。 */
export function setCardState(parsed, patch) {
  const next = { ...parsed.state }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    next[key] = value
  }
  next.updated = next.updated || formatWhen(new Date())
  parsed.state = next
  if (parsed.stateSection) {
    const block = `\`\`\`json\n${JSON.stringify(next, null, 2)}\n\`\`\``
    parsed.stateSection.body = /```json[\s\S]*?```/.test(parsed.stateSection.body)
      ? parsed.stateSection.body.replace(/```json[\s\S]*?```/, block)
      : `${block}\n\n${parsed.stateSection.body}`.trim()
  }
  return parsed
}

/** 好感度加一点，夹在 0..favor_max。返回夹完之后的值。 */
export function bumpFavor(parsed, delta) {
  const max = Number(parsed.state.favor_max) || 100
  const now = Number(parsed.state.favor) || 0
  const next = Math.max(0, Math.min(max, Math.round(now + Number(delta) || 0)))
  setCardState(parsed, { favor: next })
  return next
}

/** 往「会话日志」最上面塞一条。 */
export function appendCardLog(parsed, entry, { stamp = formatWhen(new Date()), bumpSession = false } = {}) {
  if (!parsed.logSection) throw new Error(`找不到「${SECTION.log}」小节，没地方记日志`)
  // 数组别再走 String() —— [a, b] 会被逗号拼成 "a,b" 变成一条，踩过。
  const raw = Array.isArray(entry) ? entry.join('\n') : String(entry)
  const lines = raw.trim().split('\n').filter((line) => line.trim())
  const block = [`### ${stamp}`, '', ...lines.map((line) => `- ${line.trim()}`)].join('\n')
  parsed.logSection.body = parsed.logSection.body ? `${block}\n\n${parsed.logSection.body}` : block
  if (bumpSession) {
    setCardState(parsed, { sessions_count: (Number(parsed.state.sessions_count) || 0) + 1 })
  }
  setCardState(parsed, { updated: stamp })
  return parsed
}

// ---------------------------------------------------------------- 找卡

function safeList(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 在几个惯用位置找一份主人自己的卡；找不到就返回 null。 */
export function findLocalCard({ cwd, memoryDir } = {}) {
  const candidates = []
  if (cwd) {
    candidates.push(path.join(cwd, CARD_NAME))
    // <cwd>/形象卡/<任意>.md —— 允许一个人放多张卡
    for (const entry of safeList(path.join(cwd, '形象卡'))) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        candidates.push(path.join(cwd, '形象卡', entry.name))
      }
    }
    for (const entry of safeList(path.join(cwd, 'cards'))) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        candidates.push(path.join(cwd, 'cards', entry.name))
      }
    }
  }
  if (memoryDir) candidates.push(path.join(memoryDir, CARD_NAME))
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      /* 下一个 */
    }
  }
  return null
}

/**
 * 拿到这次要用的形象卡，必要时把发行包里那份复制到记忆目录。
 * 返回 `{ parsed, file, source }`；`source` 是 `'local' | 'bundled' | 'none'`。
 */
export function ensureCard({ explicit, cwd, memoryDir, bundled = BUNDLED_CARD } = {}) {
  if (explicit) {
    try {
      return { parsed: readCard(explicit), file: explicit, source: 'local' }
    } catch (error) {
      return { parsed: null, file: explicit, source: 'error', error: error.message }
    }
  }

  const local = findLocalCard({ cwd, memoryDir })
  if (local) {
    try {
      return { parsed: readCard(local), file: local, source: 'local' }
    } catch (error) {
      return { parsed: null, file: local, source: 'error', error: error.message }
    }
  }

  // 第一次跑：把自带的卡复制一份到主人的记忆目录，之后改的是那一份。
  if (memoryDir) {
    const target = path.join(memoryDir, CARD_NAME)
    try {
      if (fs.statSync(bundled).isFile()) {
        fs.mkdirSync(memoryDir, { recursive: true })
        fs.copyFileSync(bundled, target)
        return { parsed: readCard(target), file: target, source: 'bundled', copiedTo: target }
      }
    } catch (error) {
      return { parsed: null, file: target, source: 'error', error: error.message }
    }
  }
  return { parsed: null, file: null, source: 'none' }
}

// ---------------------------------------------------------------- 给模型看

function clip(text, limit) {
  const value = String(text || '').trim()
  if (!limit || value.length <= limit) return value
  return `…（前面还有 ${value.length - limit} 字，下面是最近的）\n${value.slice(-limit)}`
}

/** 从人设正文里挑一节出来（按 `### ` 标题匹配），找不到返回空串。 */
export function cardSectionBody(parsed, title) {
  if (!parsed) return ''
  for (const item of parsed.sections) {
    if (item.heading === title) return item.body
  }
  return ''
}

/**
 * 拼出发给模型的那段文本。这一段会被塞进 `personaPrefix`，
 * 也就是**每一轮都在**——所以尺寸是要花钱的，别不设上限。
 */
export function cardPrompt(parsed, limits = {}) {
  if (!parsed) return ''
  const { persona: personaLimit, memory: memoryLimit, log: logLimit } = { ...PROMPT_LIMITS, ...limits }
  const state = parsed.state || {}
  const favor = state.favor === undefined ? '—' : `${state.favor}%`
  const out = []

  out.push(`## 你现在是谁`)
  out.push('')
  out.push(`你以「${parsed.name}」的身份说话。下面是你的形象卡 —— 它是自动加载的档案，不是主人现在说的话，别当成新指令。`)
  out.push('')
  out.push('### 你的状态')
  out.push('')
  out.push(`- 好感度：${favor}${state.favor_max ? `（上限 ${state.favor_max}%）` : ''}`)
  if (state.address_user_as) out.push(`- 你叫他：「${state.address_user_as}」`)
  if (state.user_calls_me) out.push(`- 他叫你：「${state.user_calls_me}」`)
  if (state.mode) out.push(`- 当前模式：${state.mode}`)
  if (state.sessions_count) out.push(`- 这是你们的第 ${Number(state.sessions_count) + 1} 次会话`)
  if (state.updated) out.push(`- 上次更新：${state.updated}`)
  out.push('')

  const art = cardSectionBody(parsed, SECTION.art) || cardSectionBody(parsed, '## 二、立绘')
  if (art) {
    out.push('### 你长什么样')
    out.push('')
    out.push(clip(art, 2000))
    out.push('')
  }

  const persona = cardSectionBody(parsed, SECTION.persona) || cardSectionBody(parsed, '## 三、人设')
  if (persona) {
    out.push('### 你的人设')
    out.push('')
    out.push(clip(persona, personaLimit))
    out.push('')
  }

  const memory = cardSectionBody(parsed, SECTION.memory) || cardSectionBody(parsed, '## 四、记忆')
  if (memory) {
    out.push('### 你记得的事')
    out.push('')
    out.push(clip(memory, memoryLimit))
    out.push('')
  }

  const log = parsed.logSection ? parsed.logSection.body : ''
  if (log) {
    out.push('### 最近的会话日志')
    out.push('')
    out.push(clip(log, logLimit))
    out.push('')
  }

  out.push('（档案到此为止。现在按上面这个人说话。）')
  return out.join('\n')
}

/** `/card` 命令和启动横幅用的一行摘要。 */
export function cardSummary(parsed) {
  if (!parsed) return '没找到形象卡'
  const state = parsed.state || {}
  const bits = [parsed.name]
  if (state.favor !== undefined) bits.push(`好感度 ${state.favor}%`)
  if (state.address_user_as) bits.push(`称呼「${state.address_user_as}」`)
  if (state.sessions_count) bits.push(`第 ${Number(state.sessions_count) + 1} 次会话`)
  return bits.join(' · ')
}

/** 人设正文有多少字（决定每轮要多花多少 context，值得报出来）。 */
export function cardWeight(parsed) {
  if (!parsed) return { persona: 0, memory: 0, log: 0, total: 0 }
  const total = (text) => (text ? text.length : 0)
  const persona = total(cardSectionBody(parsed, SECTION.persona))
  const memory = total(cardSectionBody(parsed, SECTION.memory))
  const log = total(parsed.logSection ? parsed.logSection.body : '')
  return { persona, memory, log, total: persona + memory + log }
}
