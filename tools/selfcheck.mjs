// whale-chan 自检：不依赖真实 TTY，直接驱动界面对象，验证键盘、渲染与事件流。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { WhaleApp } from '../whale-chan/src/app.mjs'
import { DemoAgent } from '../whale-chan/src/demo.mjs'
import { visibleField } from '../whale-chan/src/app.mjs'
import { honorificRatio, lineTotal, feelingTotal, pickLine, tsundereRatio } from '../whale-chan/src/bubble.mjs'
import { cachedBalance, isPeakTime, seedBalance } from '../whale-chan/src/account.mjs'
import { effortPatchYaml, isEffort } from '../whale-chan/src/effort.mjs'
import { memoryDir, memoryPath, readMemory } from '../whale-chan/src/memory.mjs'

let failures = 0

function check(name, condition, extra = '') {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures++
  process.stdout.write(`${mark}  ${name}${condition ? '' : `  ${extra}`}\n`)
}

// ---- 台词库 ----
// 主人是「签名称呼」，不是句句都喊：喊多了像客服话术，傲娇的气口会被挤没。
// 所以这里锁的是区间——既不能一句都不喊，也不能句句都喊。
check('台词库至少 50 条', lineTotal() >= 50, `实际 ${lineTotal()} 条`)
check('感想池够用', feelingTotal() >= 20, `实际 ${feelingTotal()} 条`)
check(
  '「主人」是称呼不是口头禅（15%~45%）',
  honorificRatio() >= 0.15 && honorificRatio() <= 0.45,
  `实际 ${(honorificRatio() * 100).toFixed(1)}%`,
)
check('傲娇味够浓（≥40%）', tsundereRatio() >= 0.4, `实际 ${(tsundereRatio() * 100).toFixed(1)}%`)
check(
  '七个状态都有台词',
  ['greet', 'idle', 'thinking', 'working', 'done', 'error', 'happy'].every((s) => Boolean(pickLine(s, 0))),
)

function type(app, text) {
  for (const ch of text) app.handleKey({ kind: 'text', value: ch, length: 1 })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 自检会把「一回合」跑完，而每回合结束都会往记忆里追加一条。
// 所以这里必须把记忆目录指到临时目录去 —— 否则跑一次自检就往主人真人的
// 记忆.md 里塞一句 DemoAgent 的假台词，而且再也没人分得清哪些是真聊过的。
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-selfcheck-'))
const realMemoryDir = memoryDir()
function realMemorySize() {
  try {
    return fs.readFileSync(memoryPath(realMemoryDir), 'utf8').length
  } catch {
    return -1
  }
}
const realMemoryBefore = realMemorySize()

const app = new WhaleApp({ agent: new DemoAgent(), cwd: 'C:/harness/demo-project', memoryDir: scratch, card: 'off' })
app.canvas.resize(100, 30)
app.stop = () => {
  app.stopped = true
}

// ---------------------------------------------------------------- 渲染
app.render()
let plain = app.toPlainText()
check('渲染出标题栏', plain.includes('鲸鱼娘'))
check('渲染出终端智能体', plain.includes('终端智能体'))
check('渲染出对话栏', plain.includes('对话'))
check('渲染出输入提示', plain.includes('说点什么吧'))
check('渲染出状态栏快捷键', plain.includes('Enter 发送'))
check('鲸鱼娘像素画已画出（半格字符）', plain.includes('▀'))

// ---------------------------------------------------------------- 输入
type(app, '你好呀鲸鱼娘')
check('中文输入进入缓冲', app.input === '你好呀鲸鱼娘', `实际 ${JSON.stringify(app.input)}`)
app.handleKey({ kind: 'key', name: 'left' })
app.handleKey({ kind: 'key', name: 'left' })
app.handleKey({ kind: 'text', value: '，' })
check('插入到光标处', app.input === '你好呀鲸，鱼娘', `实际 ${JSON.stringify(app.input)}`)
app.handleKey({ kind: 'text', value: '\x7f' })
check('退格删除光标左侧', app.input === '你好呀鲸鱼娘', `实际 ${JSON.stringify(app.input)}`)
app.handleKey({ kind: 'text', value: '\x15' })
check('Ctrl+U 清空输入', app.input === '')
app.handleKey({ kind: 'text', value: '\r' })
check('空输入不触发提交', app.busy === false)

// ------------------------------------------------------------ 长行可视窗口
const long = '这是一段很长的中文文本'.repeat(4)
const field = visibleField(long, long.length, 20)
check('超宽输入被裁剪到可视宽度', [...field.shown].length <= 20)
check('光标列落在可视窗口内', field.caretCol >= 0 && field.caretCol < 20)

// ------------------------------------------------------------ 对话回合
type(app, '帮我看看目录里的文件')
app.handleKey({ kind: 'text', value: '\r' })
check('提交后进入忙碌态', app.busy === true)
check('用户消息进入记录', app.transcript[0].kind === 'user')

app.tickCount = 3
app.render()
plain = app.toPlainText()
check('忙碌时输入行显示进度', plain.includes('鲸鱼娘正在'))

await sleep(4200)

check('收到智能体回复', app.transcript.some((e) => e.kind === 'assistant'))
check('收到工具调用', app.transcript.some((e) => e.kind === 'tool'))
check('回合结束回到完成态', app.phase === 'done', `实际 ${app.phase}`)
check('忙碌态已解除', app.busy === false)

app.tickCount = 20
check('认出了表情包目录', app.stickers.length > 0, app.stickerDir || '（没找到）')
check('回合结束后弹出表情包气泡', Boolean(app.card), `stickers=${app.stickers.length}`)
check('气泡带感想文字', Boolean(app.card && app.card.feeling), app.card?.feeling || '')
check('气泡可以收起', app.dismissCard() === true && app.card === null)
app.render()
plain = app.toPlainText()
check('对话内容出现在画面上', plain.includes('我先看看这个目录里有什么'), JSON.stringify(app.transcript[1]))

// ---------------------------------------------------------------- 滚动
app.canvas.resize(100, 12)
app.render()
check('小窗口下产生可滚动余量', app.maxScroll > 0, `maxScroll=${app.maxScroll}`)
app.handleKey({ kind: 'key', name: 'pageup' })
check('PgUp 上翻', app.scroll > 0)
app.handleKey({ kind: 'key', name: 'pagedown' })
check('PgDn 下翻回到最新', app.scroll === 0)

// ---------------------------------------------------------------- 命令
app.handleKey({ kind: 'text', value: '\r' })
type(app, '/help')
app.handleKey({ kind: 'text', value: '\r' })
check('/help 输出提示', app.transcript.some((e) => e.kind === 'note' && e.text.includes('/clear')))
type(app, '/clear')
app.handleKey({ kind: 'text', value: '\r' })
check(
  '/clear 清空记录',
  app.transcript.length === 1 && app.transcript[0].kind === 'note',
  `实际 ${JSON.stringify(app.transcript)}`,
)

// ---------------------------------------------------------------- 余额 / 峰谷 / 推理强度
app.canvas.resize(118, 30)
seedBalance({ ok: true, totalBalance: 2.06, currency: 'CNY', source: 'demo' })
app.balance = cachedBalance()
app.effort = 'high'
app.render()
const statusLine = app.toPlainText().split('\n').slice(-1)[0]
check('状态栏显示余额', statusLine.includes('¥2.06'), statusLine)
check('状态栏显示峰谷', statusLine.includes('谷时') || statusLine.includes('峰时'), statusLine)
check('状态栏显示推理强度', statusLine.includes('思考 高'), statusLine)

// 状态栏上的「思考 X」开着鼠标时是个真按钮 —— 终端里没别的地方放按钮，
// 所以就是把它渲染时的坐标记下来。热区必须排在「点在鲸鱼娘身上」前面：
// 状态栏那一行也落在 whaleRect 的纵向范围里，顺序反了就永远点不到。
app.mouseEnabled = true
app.render()
const zone = app.effortRect
check('开着鼠标时「思考」变成可点按钮', Boolean(zone) && zone.y === app.canvas.rows - 1, JSON.stringify(zone))
check('按钮上带一个「可以点」的记号', app.toPlainText().split('\n').slice(-1)[0].includes('思考 高 ↻'))
let cycled = 0
const realCycleEffort = app.cycleEffort.bind(app)
app.cycleEffort = () => {
  cycled += 1
}
const mouseAt = (x, y) => app.onMouse({ kind: 'mouse', button: 0, x, y, release: false })
if (zone) mouseAt(zone.x + 1, zone.y + 1)
check('点中状态栏的「思考」会换档', cycled === 1, `cycled=${cycled}`)
mouseAt(3, 3)
check('点别处不会换档', cycled === 1, `cycled=${cycled}`)
app.cycleEffort = realCycleEffort
app.mouseEnabled = false
app.render()
check('关掉鼠标后按钮就没了', app.effortRect === null, JSON.stringify(app.effortRect))
app.effort = 'high'

// 峰谷边界：北京周一 10:00 是高峰，工作日午休是谷时。
// 注意「周末全天谷价」是 **2026-08-23 00:00（北京）之后** 才生效的规则，
// 所以不能用 5 月的周六来测——那天按官方规则仍然算高峰。
const beijingMonday10 = Math.floor(Date.UTC(2026, 4, 4, 2, 0, 0) / 1000) // 周一 10:00 UTC+8
const beijingSaturday10AfterRule = Math.floor(Date.UTC(2026, 7, 29, 2, 0, 0) / 1000) // 2026-08-29 周六
check('工作日 10 点算高峰', isPeakTime(beijingMonday10) === true)
check('周末 10 点算谷时（2026-08-23 规则生效后）', isPeakTime(beijingSaturday10AfterRule) === false)
const noon = Math.floor(Date.UTC(2026, 4, 4, 4, 0, 0) / 1000) // 周一 12:00，午休谷时
check('工作日 12 点算谷时', isPeakTime(noon) === false)

// 推理强度只认这五档，别让错值漏到 dsh 命令行里
check('off/low/high/max/default 都合法', ['off', 'low', 'high', 'max', 'default'].every((v) => v === 'default' || isEffort(v)))
check('乱写的档位被挡住', isEffort('ultra') === false && isEffort('') === false)
check('patch 会带上 provider 和 model', (() => {
  const yaml = effortPatchYaml({ provider: 'deepseek-official', model: 'deepseek-flash', effort: 'low' })
  return yaml.includes('provider: deepseek-official') && yaml.includes('model: deepseek-flash') && yaml.includes('reasoningEffort: low')
})())
check('缺 provider 时直接报错', (() => {
  try {
    effortPatchYaml({ effort: 'low' })
    return false
  } catch {
    return true
  }
})())

// ---------------------------------------------------------------- 窄屏
app.canvas.resize(50, 14)
app.render()
check('窄屏渲染不崩溃', app.toPlainText().split('\n').length === 14)
app.canvas.resize(20, 5)
app.render()
check('极小窗口安全退出渲染', app.toPlainText().split('\n').length === 5)

// 自检自己不该留下痕迹：记忆写到临时目录去了，主人的真文件一个字节都不能变。
check('自检走了一圈，记忆确实写进了临时目录', readMemory(scratch).length > 0, `len=${readMemory(scratch).length}`)
check('主人的真记忆文件没被自检碰过', realMemorySize() === realMemoryBefore, `前 ${realMemoryBefore} → 后 ${realMemorySize()}`)

// 形象卡那条路：有卡的时候她就该写卡，而不是同时写卡又写记忆.md
//（不然同一件事记两遍，两边慢慢分叉）。
const cardScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-card-selfcheck-'))
// 主人记忆目录里那份卡也不能被动：自检必须用 --memory-dir 指到临时目录去。
const realCardPath = path.resolve(realMemoryDir, '形象卡.md')
const realCardBefore = fs.existsSync(realCardPath) ? fs.readFileSync(realCardPath, 'utf8') : null
const cardApp = new WhaleApp({ agent: new DemoAgent(), cwd: 'C:/harness/demo-project', memoryDir: cardScratch })
check('第一次跑会把自带形象卡复制进记忆目录', Boolean(cardApp.character), cardApp.characterInfo ? cardApp.characterInfo.source : 'none')
check('卡里的人设被读进来了', cardApp.promptPersona().includes('凛凛'), `${cardApp.promptPersona().length} 字`)
check('每轮只写卡，不再另外写记忆.md', readMemory(cardScratch).length === 0, `记忆 len=${readMemory(cardScratch).length}`)
const cardFileBefore = fs.readFileSync(path.resolve(cardScratch, '形象卡.md'), 'utf8')
cardApp.characterCounted = true
cardApp.recordTurn({ prompt: '自检用的一句话', reply: '自检用的一句回复', tools: ['read'], ok: true })
const cardFileAfter = fs.readFileSync(path.resolve(cardScratch, '形象卡.md'), 'utf8')
check('回合结束会往形象卡日志里追加一条', cardFileAfter.length > cardFileBefore.length)
check('新日志写在最上面', /## 五、会话日志（新条目追加在最上面）\n\n### /.test(cardFileAfter))
check('卡里能看到这一回合', cardFileAfter.includes('自检用的一句话'))
check('主人的真形象卡也没被自检碰过', (fs.existsSync(realCardPath) ? fs.readFileSync(realCardPath, 'utf8') : null) === realCardBefore)
fs.rmSync(cardScratch, { recursive: true, force: true })
fs.rmSync(scratch, { recursive: true, force: true })

// `bin/whalechan.mjs` 同时是 CLI 入口和 parseArgs/resolveDsh 的导出者。
// 少了入口判断的话，任何 import 它的脚本都会顺手启动一个 TUI（我踩过：探针整个挂住）。
const binPath = path.resolve(import.meta.dirname, '../whale-chan/bin/whalechan.mjs')
const probe = spawnSync(
  process.execPath,
  ['-e', 'import(process.argv[1]).then(() => process.stdout.write("imported"))', pathToFileURL(binPath).href],
  { timeout: 20000, encoding: 'utf8' },
)
check('import bin/whalechan.mjs 不会启动界面', probe.status === 0 && (probe.stdout || '').includes('imported'), `${probe.status} ${probe.stderr || ''}`.slice(0, 120))

process.stdout.write(failures === 0 ? '\n全部通过 ✅\n' : `\n${failures} 项失败 ❌\n`)
process.exit(failures === 0 ? 0 : 1)
