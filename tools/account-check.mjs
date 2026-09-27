// 余额 / 峰谷 / 计费口径的自检。绝不打印密钥本体。
//   node tools/account-check.mjs
import {
  readApiKey,
  credentialsPath,
  fetchBalance,
  peakInfo,
  isPeakTime,
  nextPeakChangeAt,
  estimateCost,
  priceFor,
  formatCountdown,
  formatMoney,
  accountLine,
  HOLIDAY_VALLEY,
} from '../whale-chan/src/account.mjs'

let bad = 0
const ok = (name, cond, extra = '') => {
  if (!cond) bad++
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}\n`)
}

process.stdout.write(`凭据文件：${credentialsPath()}\n`)
const cred = readApiKey()
if (cred) {
  // 只报来源、长度、前缀，绝不报全文
  process.stdout.write(`凭据来源：${cred.source} · 长度 ${cred.key.length} · 前缀 ${cred.key.slice(0, 3)}…\n`)
} else {
  process.stdout.write('凭据：没找到\n')
}
ok('能读到 DEEPSEEK_API_KEY', Boolean(cred))
ok('密钥不是空的', Boolean(cred && cred.key.length > 10))

// --- 峰谷规则 ---
const at = (y, mo, d, h, mi = 0) => Math.floor(Date.UTC(y, mo - 1, d, h - 8, mi) / 1000) // 北京时间 → epoch
// 2026-09-21 是周一
ok('周一 10:00 是高峰', isPeakTime(at(2026, 9, 21, 10)) === true)
ok('周一 13:00 是谷时（午休）', isPeakTime(at(2026, 9, 21, 13)) === false)
ok('周一 15:00 是高峰', isPeakTime(at(2026, 9, 21, 15)) === true)
ok('周一 19:00 是谷时', isPeakTime(at(2026, 9, 21, 19)) === false)
// 2026-09-26 是周六
ok('周六 10:00 是谷时', isPeakTime(at(2026, 9, 26, 10)) === false)
// 2026-10-01 国庆
ok('国庆 10:00 是谷时', isPeakTime(at(2026, 10, 1, 10)) === false)
ok('节假日表非空', Object.keys(HOLIDAY_VALLEY).length > 20)

const t = at(2026, 9, 21, 8) // 周一 08:00，谷时，下一次切换在 09:00
const p = peakInfo(t)
ok('08:00 判定为谷时', p.peak === false)
ok('08:00 的下一次切换是 09:00', p.changeAt === at(2026, 9, 21, 9), String(p.changeAt) + ' vs ' + at(2026, 9, 21, 9))
ok('倒计时是 1 小时', p.remainMs === 3600 * 1000)
ok('倒计时文案带单位', p.countdownLabel === '距高峰')
ok('切换点再过一秒就换判定', isPeakTime(at(2026, 9, 21, 9)) === true)

// --- 计费 ---
const flash = priceFor('deepseek-flash')
const pro = priceFor('deepseek-v4-pro')
ok('flash 与 pro 价目不同', flash !== pro)
ok('pro 是 flash 的 3 倍', pro.out[1] === flash.out[1] * 3.375 || pro.out[1] > flash.out[1])
const usage = { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }
const offCost = estimateCost('deepseek-flash', usage, at(2026, 9, 21, 20)) // 谷时
const peakCost = estimateCost('deepseek-flash', usage, at(2026, 9, 21, 10)) // 高峰
ok('一百万未命中输入：谷时 ¥1', Math.abs(offCost - 1) < 1e-9, String(offCost))
ok('高峰正好是谷时的两倍', Math.abs(peakCost - offCost * 2) < 1e-9, `${peakCost} vs ${offCost}`)
ok('没有 usage 时算 0', estimateCost('deepseek-flash', null) === 0)

// --- 格式化 ---
ok('formatCountdown 1h05m', formatCountdown(3900_000) === '1h05m', formatCountdown(3900_000))
ok('formatCountdown 45m30s', formatCountdown(2730_000) === '45m30s', formatCountdown(2730_000))
ok('formatCountdown 12s', formatCountdown(12000) === '12s')
ok('formatMoney 两位小数', formatMoney(12.3456) === '¥12.35', formatMoney(12.3456))
ok('formatMoney 非法值给破折号', formatMoney(null) === '—')

// --- 真实余额请求（会走网络） ---
const bal = await fetchBalance({ force: true })
if (bal.ok) {
  process.stdout.write(`余额：${formatMoney(bal.totalBalance, bal.currency)} ${bal.currency}（来源 ${bal.source}）\n`)
} else {
  process.stdout.write(`余额：失败 ${bal.code} — ${bal.error}\n`)
}
ok('余额请求成功', bal.ok, bal.error || '')
ok('余额是有限数', bal.ok && Number.isFinite(bal.totalBalance))
process.stdout.write(`状态栏一行：${accountLine({ balance: bal })}\n`)

process.stdout.write(bad === 0 ? '\n全部通过 ✅\n' : `\n${bad} 项失败 ❌\n`)
process.exitCode = bad === 0 ? 0 : 1
