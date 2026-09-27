import { loadStickers, matchSticker } from '../whale-chan/src/sticker.mjs'
const dir = 'C:/harness/表情包'
const s = loadStickers(dir)
console.log('表情包数量:', s.length)
const cases = [
  ['空闲', {}],
  ['思考 12s', { phase: 'thinking', thinkingMs: 12000 }],
  ['干活 20s', { phase: 'working', thinkingMs: 20000 }],
  ['完成', { phase: 'done', seed: 2 }],
  ['出错', { phase: 'error' }],
  ['用户夸/贴', { phase: 'idle', flirty: true }],
  ['用户发火', { phase: 'idle', hostile: true }],
  ['用户嫌慢', { phase: 'idle', userFast: true }],
  ['秒回', { phase: 'idle', instant: true }],
  ['余额低', { phase: 'idle', balance: 0.95 }],
]
for (const [name, ctx] of cases) {
  const r = matchSticker(s, { phase: 'idle', thinkingMs: 0, seed: 1, instant: false, almost: false, balance: 0, ...ctx })
  console.log(`  ${name.padEnd(10)} → ${r ? r.name : '（没有匹配）'}`)
}
