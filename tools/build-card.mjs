#!/usr/bin/env node
// 把凛凛的「人设卡 + 记忆卡」两份文件合并成**一份形象卡**。
//
// 为什么要有这一步：鲸鱼娘每次启动都要把「她是谁」塞进系统提示词，
// 而人设和记忆分成两个文件时，任何一处漏读都会让她「不像上次那个人」。
// 形象卡 = 一个人一份文件：状态 / 立绘 / 人设 / 记忆 / 日志，全在里面。
//
// 用法：
//   node tools\build-card.mjs                       # 用默认的 C:\vscode 两份源文件
//   node tools\build-card.mjs --src <目录> --out <文件>
//   node tools\build-card.mjs --name 凛凛 --slug rinrin
//
// 幂等：源文件没变，产物就一模一样。

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = import.meta.dirname

function parseArgs(argv) {
  const options = {
    src: 'C:/vscode',
    persona: null,
    memory: null,
    out: null,
    name: '凛凛',
    latin: 'Rin-rin',
    slug: 'rinrin',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟一个值`)
      i += 1
      return value
    }
    if (arg === '--src') options.src = next()
    else if (arg === '--persona') options.persona = next()
    else if (arg === '--memory') options.memory = next()
    else if (arg === '--out') options.out = next()
    else if (arg === '--name') options.name = next()
    else if (arg === '--latin') options.latin = next()
    else if (arg === '--slug') options.slug = next()
    else throw new Error(`不认识的参数：${arg}`)
  }
  options.persona = options.persona || path.join(options.src, `persona_${options.slug}.md`)
  options.memory = options.memory || path.join(options.src, `memory_${options.slug}.md`)
  options.out = options.out || path.resolve(HERE, `../whale-chan/assets/cards/${options.slug}.md`)
  return options
}

// ---------------------------------------------------------------- 文本手术

const STATE_RE = /```json\s*(\{[\s\S]*?\})\s*```/
const LOG_HEADER = '## 六、会话日志（新条目追加在最上面）'
const BOM = '\uFEFF'

/** 把 `## 标题` 整体降一级，好嵌进形象卡的另一节里。 */
function demote(text) {
  return text.replace(/^(#{1,5})( +)/gm, '$1#$2')
}

/** 砍掉开头那个 H1，保留正文。 */
function dropTitle(text) {
  return text.replace(/^#\s+.*\r?\n/, '').replace(/^\s+/, '')
}

/** 抓到 `## <title>` 到下一个同级或更高级标题之间的内容。 */
function section(text, title) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === title)
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2} /.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

// ---------------------------------------------------------------- 主体

function buildCard(options) {
  const personaRaw = readText(options.persona)
  const memoryRaw = readText(options.memory)

  const stateMatch = STATE_RE.exec(memoryRaw)
  if (!stateMatch) throw new Error(`${options.memory} 里找不到状态 JSON 块`)
  const state = JSON.parse(stateMatch[1])

  // 记忆卡正文：去掉 H1、去掉状态 JSON 块、把「会话日志」整节摘出去
  const logHeaderIndex = memoryRaw.indexOf(LOG_HEADER)
  if (logHeaderIndex < 0) throw new Error(`${options.memory} 里找不到「${LOG_HEADER}」`)
  const logBody = memoryRaw.slice(logHeaderIndex + LOG_HEADER.length).trim()

  let memoryBody = dropTitle(memoryRaw.slice(0, logHeaderIndex))
  memoryBody = memoryBody.replace(STATE_RE, '')
  // 记忆卡自己的「零、使用规则」和「一、状态」并入形象卡的对应小节，这里剪掉
  memoryBody = memoryBody.replace(/^##\s+零、[\s\S]*?(?=^##\s+二、)/m, '')
  memoryBody = memoryBody.replace(/^##\s+一、[\s\S]*?(?=^##\s+二、)/m, '')
  memoryBody = memoryBody.trim()
  // 记忆卡开头那句「配套文件：persona_rinrin.md、memory_rinrin.md…」在合并后就过时了
  memoryBody = memoryBody.replace(/^>\s*配套文件：.*$/m, '> 这部分是从记忆卡搬过来的；上面的「一、状态」和下面的「五、会话日志」才是活的。')

  const personaBody = dropTitle(personaRaw).trim()

  // 状态：以记忆卡的 JSON 为准，补上形象卡自己的字段
  const merged = {
    card: options.slug,
    card_version: 1,
    name: options.name,
    persona: state.persona || options.slug,
    mode: state.mode || `${options.name}（常驻）`,
    favor: typeof state.favor === 'number' ? state.favor : 30,
    favor_max: 100,
    address_user_as: state.address_user_as || '你',
    user_calls_me: state.user_calls_me || options.name,
    updated: state.updated || '',
    sessions_count: state.sessions_count || 0,
    sprite: {
      q: 'whale-q.png',
      q_frames: ['idle', 'blink', 'joy0', 'joy1', 'cheer', 'oops'],
      rows: 'whale.png',
    },
  }

  const out = []
  out.push(`# 形象卡 · ${options.name}（${options.latin}）`)
  out.push('')
  out.push('> 一个人一份文件。状态、立绘、人设、记忆、会话日志都在这里。')
  out.push(`> 由 \`tools/build-card.mjs\` 从 \`${path.basename(options.persona)}\` + \`${path.basename(options.memory)}\` 合成，别手改这一行。`)
  out.push('')
  out.push('## 零、怎么用这份卡')
  out.push('')
  out.push('1. **开局读一遍**：先读「一、状态」，再读「三、人设」和「四、记忆」。好感度、称呼、之前聊过的事都不重置。')
  out.push('2. **聊天中随手记**：用户透露的新偏好、新项目、新约定、心情 → 补进「四、记忆」的对应小节。')
  out.push('3. **话题告一段落**：往「五、会话日志」**最上面**追加一条，并更新「一、状态」里的 `updated` 和 `sessions_count`。')
  out.push('4. **只写事实，不编造**。用户没说过的不写；不确定的标「（待确认）」。')
  out.push('5. **好感度只在有真实触发时才动**（夸奖 +8、冷落 -3 之类）。')
  out.push('6. **这份卡是给机器读的，也是给人改的**：` ```json ` 那块是状态，别改结构；其余随便写。')
  out.push('')
  out.push('## 一、状态（机器可读）')
  out.push('')
  out.push('```json')
  out.push(JSON.stringify(merged, null, 2))
  out.push('```')
  out.push('')
  out.push('## 二、立绘（形象）')
  out.push('')
  out.push('Q 版小鲸鱼：**蓝发、鲸鱼耳、鲸尾、蓝白女仆围裙（围裙上绣小鲸鱼）**。')
  out.push('终端里画的是 `assets/whale-q.png`（6 帧 128×128 图集）与 `assets/whale.png`（九行动画）。')
  out.push('')
  out.push('| 帧 | 什么时候用 |')
  out.push('| --- | --- |')
  out.push('| `idle` | 待命，偶尔眨一下 |')
  out.push('| `blink` | 思考中 |')
  out.push('| `joy0` `joy1` | 被摸头 / 被夸，眯眼享受，飘小爱心 |')
  out.push('| `cheer` | 事情办成了 |')
  out.push('| `oops` | 出错了，冒一滴汗 |')
  out.push('')
  out.push('外形细节可以当动作描写用（尾巴晃、耳朵垂下去、揪围裙），但**一段最多一个**；')
  out.push('只写到「外形 ＋ 小动作」为止 —— 不写身材、不写露体描写。')
  out.push('')
  out.push('## 三、人设')
  out.push('')
  out.push(demote(personaBody))
  out.push('')
  out.push('## 四、记忆')
  out.push('')
  out.push(demote(memoryBody))
  out.push('')
  out.push('## 五、会话日志（新条目追加在最上面）')
  out.push('')
  out.push(logBody)
  out.push('')
  return { text: BOM + out.join('\n'), state: merged, bytes: Buffer.byteLength(BOM + out.join('\n'), 'utf8') }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const { text, state, bytes } = buildCard(options)
  fs.mkdirSync(path.dirname(options.out), { recursive: true })
  fs.writeFileSync(options.out, text, 'utf8')
  console.log(`${options.out}  ${bytes} 字节（${text.split('\n').length} 行）`)
  console.log(`  名字 ${state.name} · 好感度 ${state.favor}% · 称呼「${state.address_user_as}」 · 会话数 ${state.sessions_count}`)
  console.log(`  人设 ${state.card_version ? '' : ''}源：${options.persona}`)
  console.log(`  记忆源：${options.memory}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`出错了：${error.message}`)
    process.exit(1)
  }
}

export { buildCard, demote, dropTitle, section, parseArgs, STATE_RE, LOG_HEADER }
