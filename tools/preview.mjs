// 把鲸鱼娘界面渲染成 PNG，用来检查排版与配色。
//   node tools/preview.mjs <输出.png> [cols] [rows] [scale] [phase] [purr]
// purr 传 1 时强制进入「被摸」状态，用来看可爱享受的表情。
import fs from 'node:fs'
import path from 'node:path'
import { WhaleApp } from '../whale-chan/src/app.mjs'
import { seedBalance } from '../whale-chan/src/account.mjs'
import { canvasToPng } from './canvas-png.mjs'

function buildApp(cols, rows, phase, purr) {
  seedBalance({ ok: true, totalBalance: 2.06, currency: 'CNY', source: 'demo' })
  const app = new WhaleApp({
    agent: { label: 'dsh headless', sessionId: null },
    cwd: 'C:\\harness\\demo-project',
    // 截图必须确定性：显式指发行包里那张卡，免得读到 / 写到主人自己那份。
    card: path.resolve(import.meta.dirname, '../whale-chan/assets/cards/rinrin.md'),
    // 开着鼠标，状态栏那个「思考 X ↻」才会画出来 —— 它是截图里唯一的按钮。
    mouse: true,
  })
  app.canvas.resize(cols, rows)
  // 启动时那几行自报状态：截图里也要有，不然看不出形象卡到底挂没挂上。
  app.noteStickerStatus()
  app.noteCardStatus()
  app.noteMemoryStatus(app.memory && app.memory.state)
  app.transcript.push({ kind: 'user', text: '帮我把 src/ 里所有 console.log 换成 logger，然后跑一遍测试' })
  app.transcript.push({ kind: 'assistant', text: '好呀，我先看看有哪些文件用了 console.log～' })
  app.transcript.push({ kind: 'tool', text: 'pwsh: rg -n "console\\.log" src/', status: 'ok' })
  app.transcript.push({ kind: 'tool-output', text: 'src/agent.mjs:42   src/app.mjs:118   src/util.mjs:7' })
  app.transcript.push({ kind: 'assistant', text: '找到 3 处，已经全部替换成 logger 了，顺手补上了 import。' })
  app.transcript.push({ kind: 'tool', text: 'pwsh: node --test', status: 'running' })
  app.setPhase(phase)
  app.input = '顺便帮我写个 README'
  app.caret = app.input.length
  app.tickCount = 6
  if (purr) {
    app.purrUntil = Date.now() + 999999
    app.bubble = '嘿嘿…再摸一下嘛～'
  }
  return app
}

const output = process.argv[2] || 'C:/harness/whale-chan-dist/preview.png'
const cols = Number(process.argv[3] || 110)
const rows = Number(process.argv[4] || 32)
const scale = Number(process.argv[5] || 4)
const phase = process.argv[6] || 'working'
const purr = process.argv[7] === '1'
const card = process.argv[8] === '1'

const app = buildApp(cols, rows, phase, purr)
if (card) {
  app.cardCoolUntil = 0
  app.showCard({ phase, force: true })
}
app.render()
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, canvasToPng(app.canvas, scale))
process.stdout.write(`${output} ${cols}x${rows} scale=${scale} phase=${phase}\n`)
