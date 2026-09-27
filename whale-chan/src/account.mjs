// 余额 + 峰谷时段 + 推理强度。
//
// 三件事放在一起，因为它们都是「主人的钱包和脑子」相关的配置：
//   1. 余额：走 DeepSeek 官方 `GET /user/balance`，和挂件同源。
//   2. 峰谷：北京时间周一至周五 9:00–12:00、14:00–18:00 是高峰，
//      其余（含周末、调休上班的周末、法定节假日全天）是谷时，谷价 = 高峰价 ÷ 2。
//   3. 推理强度：DeepSeek 支持 off / low / high / max，靠 profile patch 传给 DSH。
//
// 峰谷规则与价目表是从 `dsh-whale-widget`（MIT 代码）核对过来的，注释保留了口径来源，
// 因为它记录的是「官方什么时候改过规则」，删掉以后没人知道该怎么改。
//
// ⚠️ 凭据只经手一次、只用于发余额请求，绝不写进日志、绝不进 transcript。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BALANCE_URL = 'https://api.deepseek.com/user/balance'
export const BALANCE_TTL_MS = 25000
export const BALANCE_TIMEOUT_MS = 8000

/** DeepSeek 认的推理强度（顺序即由弱到强）。 */
export const EFFORTS = ['off', 'low', 'high', 'max']
export function isEffort(value) {
  return EFFORTS.includes(String(value || '').toLowerCase())
}

// ===== 峰谷时段 =====
//
// 官方口径：**北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00** 为高峰；
// 其余时段 —— 包括周末、调休上班的周末、以及中国法定节假日全天 —— 一律按谷时计费。
//   时间线：2026-08-17 峰谷定价实施 → 2026-08-23 起周末全天谷价 →
//           2026-09-19 明确「调休上班的周末 + 法定节假日全天」也按谷时算。
const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000) // 北京时间 2026-08-23 00:00
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000) // 北京时间 2026-09-19 00:00

// 《国务院办公厅关于 2026 年部分节假日安排的通知》。只需列放假的日期：
// 调休上班日全部落在周末（2026 年为 1/4、2/14、2/28、5/9、9/20、10/10），本来就按谷时算。
// ⚠️ 每年 11 月国务院发布次年安排后，必须往这里补下一年的日期。
export const HOLIDAY_VALLEY = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
}

function beijingDate(timeSec) {
  return new Date(Number(timeSec) * 1000 + 8 * 3600 * 1000)
}

/** 这一刻是不是高峰时段。（timeSec 是 epoch 秒） */
export function isPeakTime(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return false
  const bj = beijingDate(n)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay() // bj 用 UTC 读出来就是北京日历日
    if (dow === 0 || dow === 6) return false
  }
  if (n >= HOLIDAY_VALLEY_FROM_SEC && HOLIDAY_VALLEY[bj.toISOString().slice(0, 10)]) return false
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

/** 下一个峰谷切换时刻（epoch 秒）；与 isPeakTime 完全同源。扫 12 天足够覆盖最长假期。 */
export function nextPeakChangeAt(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return null
  const cur = isPeakTime(n)
  const day0 = Math.floor((n + 8 * 3600) / 86400) * 86400 // 北京当日 00:00（在 +8h 平移坐标系里）
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (cand <= n + 1) continue
      if (isPeakTime(cand) !== cur) return cand
    }
  }
  return null
}

/** 一次性拿齐「现在贵不贵、什么时候变」。 */
export function peakInfo(timeSec = Math.floor(Date.now() / 1000)) {
  const peak = isPeakTime(timeSec)
  const changeAt = nextPeakChangeAt(timeSec)
  return {
    peak,
    changeAt,
    remainMs: changeAt ? (changeAt - timeSec) * 1000 : null,
    label: peak ? '高峰' : '谷时',
    // 「距谷时」= 现在是高峰；「距高峰」= 现在是谷时
    countdownLabel: peak ? '距谷时' : '距高峰',
  }
}

// ===== 价目表（人民币元 / 百万 token）=====
//
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 2026-09-10 起 Flash 降价：缓存命中 0.05→0.02、未命中 1.5→1、输出 4.5→4（高峰 = 谷时 × 2）。
// Pro 是 Flash 的 3 倍价。数组是 [谷时价, 高峰价]。
const FLASH_PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }
const PRO_PRICE = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }
export const PRICING = {
  'deepseek-flash': FLASH_PRICE,
  'deepseek-v4-flash': FLASH_PRICE,
  'deepseek-v4-flash-vision-exp': FLASH_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  _default: FLASH_PRICE,
}

export function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICING)) {
    if (key === '_default') continue
    if (m.includes(key)) return PRICING[key]
  }
  return PRICING._default
}

/**
 * 用 DSH 的 usage 估这一轮花了多少。
 * 口径（与 dsh-whale-widget 一致）：inputTokens 是「未命中缓存的输入」，
 * cacheReadTokens 是命中部分，outputTokens 已包含 reasoningTokens，cacheWriteTokens 已并入 inputTokens。
 */
export function estimateCost(model, usage, timeSec = Math.floor(Date.now() / 1000)) {
  if (!usage || typeof usage !== 'object') return 0
  const p = priceFor(model)
  const i = p ? (isPeakTime(timeSec) ? 1 : 0) : 0
  const miss = Number(usage.inputTokens) || 0
  const hit = Number(usage.cacheReadTokens) || 0
  const out = Number(usage.outputTokens) || 0
  return (hit / 1e6) * p.hit[i] + (miss / 1e6) * p.miss[i] + (out / 1e6) * p.out[i]
}

// ===== 余额 =====

/** 极简 YAML 子集解析：只认缩进映射和标量，够读 .credentials.yaml。 */
function parseSimpleYaml(text) {
  const root = {}
  const stack = [{ indent: -1, node: root }]
  for (const raw of String(text).split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+):\s*(.*)$/.exec(trimmed)
    if (!m) continue
    const key = unquote(m[1].trim())
    const value = m[2].trim()
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].node
    if (value === '') {
      const child = {}
      parent[key] = child
      stack.push({ indent, node: child })
    } else {
      parent[key] = unquote(value)
    }
  }
  return root
}

function unquote(value) {
  const v = String(value)
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1)
  }
  return v
}

/** DSH 的凭据文件路径。 */
export function credentialsPath(env = process.env) {
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, '.credentials.yaml')
}

/**
 * 找 DeepSeek 的 key：先环境变量，再 DSH 的凭据库。
 * 返回 `{ key, source }` 或 null。**调用方绝不要把它写进日志。**
 */
export function readApiKey(env = process.env) {
  if (env.DEEPSEEK_API_KEY && String(env.DEEPSEEK_API_KEY).trim()) {
    return { key: String(env.DEEPSEEK_API_KEY).trim(), source: 'env' }
  }
  let doc
  try {
    doc = parseSimpleYaml(fs.readFileSync(credentialsPath(env), 'utf8'))
  } catch {
    return null
  }
  const ref = doc && doc.refs && doc.refs.DEEPSEEK_API_KEY
  if (!ref) return null
  const records = (doc && doc.records) || {}
  const record = records[ref]
  const secret = record && record.payload && record.payload.secret
  if (secret) return { key: String(secret).trim(), source: 'dsh-credentials' }
  // 有些版本 refs 里直接就是密钥本身
  if (/^(sk|Bearer)/i.test(String(ref)) || String(ref).length > 20) {
    return { key: String(ref).trim(), source: 'dsh-credentials' }
  }
  return null
}

function pickBalanceInfo(list) {
  if (!Array.isArray(list) || !list.length) return null
  const cny = list.find((w) => String((w && w.currency) || '').toUpperCase() === 'CNY')
  return cny || list[0]
}

let balanceCache = null
let balanceInFlight = null

/**
 * 读余额。同一个进程里 25 秒内复用，失败也记下来免得疯狂重试。
 * 返回 `{ ok, totalBalance, currency, source, error, at }`。
 */
export async function fetchBalance({ force = false, timeoutMs = BALANCE_TIMEOUT_MS, env = process.env } = {}) {
  const now = Date.now()
  if (!force && balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache
  if (balanceInFlight) return balanceInFlight

  balanceInFlight = (async () => {
    const cred = readApiKey(env)
    if (!cred) {
      return { ok: false, code: 'NO_KEY', error: '没找到 DEEPSEEK_API_KEY（环境变量和 DSH 凭据里都没有）', at: Date.now() }
    }
    let res
    try {
      res = await fetch(BALANCE_URL, {
        headers: { Authorization: 'Bearer ' + cred.key },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      return { ok: false, code: 'NETWORK', error: '余额接口连不上：' + String((err && err.message) || err).slice(0, 120), at: Date.now() }
    }
    if (!res.ok) {
      return { ok: false, code: 'HTTP', error: `余额接口返回 HTTP ${res.status}`, at: Date.now() }
    }
    let data
    try {
      data = await res.json()
    } catch {
      return { ok: false, code: 'PARSE', error: '余额接口返回的不是合法 JSON', at: Date.now() }
    }
    const info = pickBalanceInfo(data && data.balance_infos)
    const total = info && Number(info.total_balance)
    if (!info || !Number.isFinite(total)) {
      return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常', at: Date.now() }
    }
    return {
      ok: true,
      totalBalance: total,
      currency: String(info.currency || 'CNY').toUpperCase(),
      source: cred.source,
      at: Date.now(),
    }
  })()

  try {
    balanceCache = await balanceInFlight
  } finally {
    balanceInFlight = null
  }
  return balanceCache
}

/** 把缓存放进来（离线预览 / 自检用）。 */
export function seedBalance(snapshot) {
  balanceCache = snapshot ? { ...snapshot, at: Date.now() } : null
}

export function cachedBalance() {
  return balanceCache
}

// ===== 格式化 =====

export function formatMoney(value, currency = 'CNY') {
  // null / undefined / 空串 = 「还不知道」，不是 0，别显示成 ¥0.00
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return sign + n.toFixed(2)
}

/** 把毫秒差写成「3h20m」「45m」「12s」。 */
export function formatCountdown(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** 状态栏 / 徽章上那一小段字：`余额 ¥12.34 · 谷时 · 距高峰 1h05m`。 */
export function accountLine({ balance, timeSec = Math.floor(Date.now() / 1000) } = {}) {
  const peak = peakInfo(timeSec)
  const parts = []
  if (balance && balance.ok) parts.push(`余额 ${formatMoney(balance.totalBalance, balance.currency)}`)
  else if (balance && balance.code === 'NO_KEY') parts.push('余额 未配 key')
  else if (balance && balance.error) parts.push('余额 读取失败')
  parts.push(peak.label)
  if (peak.remainMs != null) parts.push(`${peak.countdownLabel} ${formatCountdown(peak.remainMs)}`)
  return parts.join(' · ')
}
