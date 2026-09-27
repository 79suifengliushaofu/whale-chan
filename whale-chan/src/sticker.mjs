// 表情包选择器。
//
// 用户在 `表情包/` 目录里放了一堆 PNG，**文件名就是分类**，比如
// 「思考时间大于10s时使用.png」「用户生气时使用 (2).png」「完成任务后傲娇地使用.png」。
// 这里把「当前在干什么 + 刚才聊了什么」映射到文件名关键词，挑一张弹出来。
//
// 目录里没有的东西也能跑：匹配不到就返回 null，界面自然不弹卡片。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件自带的表情包（`assets/stickers/`），缩过图，随包分发。 */
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'stickers')

/** 找表情包目录：显式指定 > 环境变量 > 工作目录/上级 > 用户主目录 > 自带的。 */
export function resolveStickerDir(options = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  const cwd = options.cwd || process.cwd()
  const candidates = []
  if (options.explicit) candidates.push(options.explicit)
  if (process.env.WHALE_STICKER_DIR) candidates.push(process.env.WHALE_STICKER_DIR)
  for (const name of ['表情包', 'stickers']) {
    candidates.push(path.join(cwd, name))
    candidates.push(path.join(path.dirname(cwd), name))
    candidates.push(path.join(path.dirname(path.dirname(cwd)), name))
  }
  candidates.push(path.join(home, '表情包'))
  candidates.push(path.join(home, '.dsh', 'whale-chan', '表情包'))
  // 用户自己的图永远优先；自带的只是兜底，保证在哪儿都能弹。
  candidates.push(BUNDLED)
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir
    } catch {
      /* 继续找下一个 */
    }
  }
  return null
}

/** 读目录，返回 [{ file, name }]，name 是去掉 .png 的文件名。 */
export function loadStickers(dir) {
  if (!dir) return []
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((f) => /\.png$/i.test(f))
    .sort()
    .map((f) => ({ file: path.join(dir, f), name: f.replace(/\.png$/i, '') }))
}

// ---------------------------------------------------------------- 触发规则
// 从上到下第一条命中的生效，所以「具体状态」要排在「通用状态」前面。

const RULES = [
  { key: 'balance-zero', files: ['余额为0时使用'], test: (c) => c.balance >= 1 },
  { key: 'balance-low', files: ['token余额较少时使用', '余额较少时使用'], test: (c) => c.balance >= 0.85 },
  { key: 'user-angry', files: ['用户生气时使用'], test: (c) => c.hostile },
  { key: 'flirty', files: ['和用户调情时使用', '和用户暧昧时使用'], test: (c) => c.flirty },
  { key: 'net-error', files: ['网络异常或链接异常时使用'], test: (c) => c.phase === 'error' },
  // 「想太久」只在真的处于思考态时算数，干活干久了的走下面的 working。
  {
    key: 'slow-think',
    files: ['思考时间大于10s时使用'],
    test: (c) => c.phase === 'thinking' && c.thinkingMs >= 10000,
  },
  { key: 'vague', files: ['对用户意图模糊时使用', '网络延迟高'], test: (c) => c.vague },
  { key: 'instant', files: ['超短时间给出回答时使用'], test: (c) => c.instant },
  { key: 'soon', files: ['结果即将出炉时间使用'], test: (c) => c.almost },
  { key: 'working', files: ['工作间使用'], test: (c) => c.phase === 'working' },
  { key: 'done-tsun', files: ['完成任务后傲娇地使用'], test: (c) => c.phase === 'done' && c.seed % 2 === 0 },
  { key: 'done', files: ['完成任务时使用'], test: (c) => c.phase === 'done' },
  { key: 'hallucinating', files: ['幻觉时使用'], test: (c) => c.hedging },
  { key: 'user-fast', files: ['用户高效完成工作后使用'], test: (c) => c.userFast },
  { key: 'user-scoff', files: ['用户对结果表示不屑时使用'], test: (c) => c.scoff },
  {
    key: 'thinking',
    files: ['思考时间大于10s时使用', '网络延迟高'],
    test: (c) => c.phase === 'thinking',
  },
  {
    key: 'idle',
    files: ['无聊时使用', '无聊时间使用', '空闲使用', '没有对话时使用'],
    test: () => true,
  },
]

const HOSTILE = /(生气|气死|讨厌|好烦|垃圾|废物|笨蛋|蠢|闭嘴|滚|没用|太慢|怎么这么|搞什么|不行啊)/
const FLIRTY = /(喜欢你|爱你|抱抱|贴贴|亲亲|摸摸|宝宝|老婆|好乖|想你|么么|可爱)/i
const SCOFF = /(就这|不屑|一般般|就那样|还不如|没意思|差评|无感)/
const VAGUE = /(随便|都行|你看着办|不知道|不清楚|也许|大概|可能吧|反正)/
const USER_FAST = /(我搞定了|我自己写好|已经完成|很快|秒了)/
const HEDGING = /(可能|大概|也许|应该差不多|不确定|或许是|我觉得吧)/

/** 把「用户刚说的话 + 智能体刚说的话」翻译成一组布尔特征。 */
export function readContext(text = '', reply = '') {
  return {
    hostile: HOSTILE.test(text),
    flirty: FLIRTY.test(text),
    scoff: SCOFF.test(text),
    vague: VAGUE.test(text),
    userFast: USER_FAST.test(text),
    hedging: HEDGING.test(reply),
  }
}

function gather(stickers, patterns, seen) {
  const hits = []
  for (const pattern of patterns) {
    for (const sticker of stickers) {
      if (seen.has(sticker.file)) continue
      if (sticker.name.startsWith(pattern) || sticker.name.includes(pattern)) {
        hits.push(sticker)
        seen.add(sticker.file)
      }
    }
  }
  return hits
}

/**
 * 挑一张表情包。
 * @param {Array<{file:string,name:string}>} stickers
 * @param {object} context phase / thinkingMs / seed / 以及 readContext() 的布尔特征
 * @returns {{file:string,name:string,key:string}|null}
 */
export function matchSticker(stickers, context = {}) {
  if (!stickers || !stickers.length) return null
  const ctx = {
    phase: 'idle',
    thinkingMs: 0,
    seed: 0,
    instant: false,
    almost: false,
    balance: 0,
    ...context,
  }
  const seen = new Set()
  for (const rule of RULES) {
    let hit = false
    try {
      hit = Boolean(rule.test(ctx))
    } catch {
      hit = false
    }
    if (!hit) continue
    const hits = gather(stickers, rule.files, seen)
    if (hits.length) return { ...hits[ctx.seed % hits.length], key: rule.key }
  }
  return null
}
