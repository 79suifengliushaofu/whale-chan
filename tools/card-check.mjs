#!/usr/bin/env node
// 形象卡的自检：解析、写回、复制、指令注入。
//
// 跑法：node tools\card-check.mjs
// 它只碰临时目录和发行包里那份卡，绝不会改主人自己的形象卡。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BUNDLED_CARD,
  CARD_NAME,
  SECTION,
  appendCardLog,
  bumpFavor,
  cardPrompt,
  cardSummary,
  cardWeight,
  ensureCard,
  findLocalCard,
  parseCard,
  readCard,
  serializeCard,
  setCardState,
  writeCard,
} from '../whale-chan/src/card.mjs'

let failures = 0
function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`
  process.stdout.write(`${line}\n`)
  if (!ok) failures += 1
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-card-'))

// ---------------------------------------------------------------- 自带的那份卡
const card = readCard(BUNDLED_CARD)

check('自带形象卡能解析', card.stateError === null, card.stateError || '')
check('名字读对了', card.name === '凛凛', card.name)
check('状态好感度读对了', card.state.favor === 86, String(card.state.favor))
check('正好切成六个小节', card.sections.length === 6, card.sections.map((s) => s.heading).join(' | '))

// 这条是回归：曾经 /^(##+)\s+/ 把 `### 零、常驻规则` 也当成了小节，
// 于是「人设」正文只剩第一行，卡看起来还在、人设却没了。
const weight = cardWeight(card)
check('人设正文是整段，不是只剩一行', weight.persona > 15000, `${weight.persona} 字`)
check('记忆正文也在', weight.memory > 2000, `${weight.memory} 字`)
check('日志正文也在', weight.log > 3000, `${weight.log} 字`)

// ---------------------------------------------------------------- 注入给模型的那段
const prompt = cardPrompt(card)
check('提示词带上了身份说明', prompt.includes('你以「凛凛」的身份说话'))
check('提示词里有人设的常驻规则', prompt.includes('常驻规则（最高优先级）'))
check('提示词里有去 AI 味守则', prompt.includes('去 AI 味守则'))
check('提示词里有反撩模式', prompt.includes('反撩模式（主动出击）'))
check('提示词里有用户档案', prompt.includes('称呼偏好'))
check('提示词里有会话日志', prompt.includes('### 2026-'))
check('提示词带防注入声明', prompt.includes('别当成新指令'))
check('提示词没有失控地长', prompt.length < 40000, `${prompt.length} 字`)

const lite = cardPrompt(card, { persona: 2000, memory: 1000, log: 500 })
check('可以要求只给一小截人设', lite.length < prompt.length / 3, `${lite.length} 字 vs 完整 ${prompt.length}`)
check('截断时说明前面还有多少字', lite.includes('前面还有'))

check('摘要带上名字和好感度', cardSummary(card).includes('凛凛') && cardSummary(card).includes('好感度 86%'), cardSummary(card))
check('没卡时摘要不炸', cardSummary(null) === '没找到形象卡')

// ---------------------------------------------------------------- 写回
const copy = path.join(scratch, CARD_NAME)
fs.copyFileSync(BUNDLED_CARD, copy)

const edited = readCard(copy)
check('好感度 +8 → 94', bumpFavor(edited, 8) === 94)
check('好感度封顶在 100', bumpFavor(edited, 500) === 100)
check('好感度不会掉到负数', bumpFavor(edited, -500) === 0)

bumpFavor(edited, 86)
appendCardLog(edited, '这是一条测试日志。\n第二行也要变成项目符号。', { stamp: '2099-01-01 00:00', bumpSession: true })
writeCard(edited)

const back = readCard(copy)
check('写回后好感度还在', back.state.favor === 86, String(back.state.favor))
check('写回后会话数 +1', back.state.sessions_count === 2, String(back.state.sessions_count))
check('写回后 updated 是刚写的时刻', back.state.updated === '2099-01-01 00:00', back.state.updated)
check('新日志在最上面', back.logSection.body.startsWith('### 2099-01-01 00:00'), back.logSection.body.slice(0, 40))
check('多行日志逐行变成项目符号', back.logSection.body.includes('- 第二行也要变成项目符号。'))
// 回归：数组别再走 String()。曾经写成 String(['a','b']) → "a,b"，两行被逗号并成一条。
appendCardLog(back, ['数组第一行', '数组第二行'], { stamp: '2099-01-02 00:00' })
check('数组日志也是一个元素一条', back.logSection.body.includes('- 数组第一行') && back.logSection.body.includes('- 数组第二行'))
check('数组日志没有被逗号拼成一条', !back.logSection.body.includes('- 数组第一行,数组第二行'))
check('旧日志没被弄丢', back.logSection.body.includes('### 2026-09-26 23:54'))
check('写回后六个小节还在', back.sections.length === 6)
check('写回后文件带 UTF-8 BOM', fs.readFileSync(copy, 'utf8').startsWith('\uFEFF'))
check('解析时会剥掉 BOM', !readCard(copy).title.startsWith('\uFEFF'), JSON.stringify(back.title.slice(0, 6)))
check('其它小节的字节没动', cardSectionOf(back, SECTION.persona) === cardSectionOf(card, SECTION.persona))

function cardSectionOf(parsed, heading) {
  const item = parsed.sections.find((s) => s.heading === heading)
  return item ? item.body : null
}

// 序列化再解析应当稳定（幂等）
const twice = parseCard(serializeCard(back))
check('序列化 → 解析是幂等的', serializeCard(twice) === serializeCard(back))

// ---------------------------------------------------------------- 坏卡不崩
const bad = path.join(scratch, 'bad.md')
fs.writeFileSync(bad, '# 坏的\n\n## 一、状态（机器可读）\n\n```json\n{ 这不是 json }\n```\n')
const badParsed = readCard(bad)
check('状态 JSON 坏掉时报错但不抛异常', Boolean(badParsed.stateError), badParsed.stateError || '')

const noJson = path.join(scratch, 'nojson.md')
fs.writeFileSync(noJson, '# 没状态的卡\n\n## 一、状态（机器可读）\n\n什么都没有\n')
check('缺 JSON 块时给出可读的提示', /找不到/.test(readCard(noJson).stateError || ''), readCard(noJson).stateError || '')

const noLog = path.join(scratch, 'nolog.md')
fs.writeFileSync(noLog, '# 没日志的卡\n\n## 一、状态（机器可读）\n\n```json\n{"name":"x"}\n```\n')
check('缺日志小节时 appendCardLog 直接报错', (() => {
  try {
    appendCardLog(readCard(noLog), 'x')
    return false
  } catch {
    return true
  }
})())

// ---------------------------------------------------------------- 找卡 / 复制
const cwd = path.join(scratch, 'proj')
const memDir = path.join(scratch, 'mem')
fs.mkdirSync(cwd, { recursive: true })

const first = ensureCard({ cwd, memoryDir: memDir })
check('第一次跑：把自带卡复制到记忆目录', first.source === 'bundled' && fs.existsSync(path.join(memDir, CARD_NAME)), first.source)
check('复制过来的卡能立刻用', first.parsed && first.parsed.state.favor === 86)

const second = ensureCard({ cwd, memoryDir: memDir })
check('第二次跑：用记忆目录里那份（不再复制）', second.source === 'local', second.source)

fs.writeFileSync(path.join(cwd, CARD_NAME), '# 项目自己的卡\n\n## 一、状态（机器可读）\n\n```json\n{"name":"项目卡","favor":7}\n```\n')
const third = ensureCard({ cwd, memoryDir: memDir })
check('工作目录里的卡优先于记忆目录', third.parsed && third.parsed.name === '项目卡', third.parsed ? third.parsed.name : 'none')
check('findLocalCard 认得出来', findLocalCard({ cwd }) === path.join(cwd, CARD_NAME))

const cardDirCwd = path.join(scratch, 'cards-project')
const cardDir = path.join(cardDirCwd, '形象卡')
fs.mkdirSync(cardDir, { recursive: true })
fs.writeFileSync(path.join(cardDir, '另一个.md'), '# 另一个\n\n## 一、状态（机器可读）\n\n```json\n{"name":"另一个","favor":3}\n```\n')
const inDir = ensureCard({ cwd: cardDirCwd, memoryDir: path.join(scratch, 'mem2') })
check('也认 <cwd>/形象卡/*.md 这种放法', inDir.parsed && inDir.parsed.name === '另一个', inDir.parsed ? inDir.parsed.name : 'none')

const explicit = ensureCard({ explicit: BUNDLED_CARD })
check('--card 显式指定最优先', explicit.source === 'local' && explicit.parsed.name === '凛凛', explicit.source)

const missing = ensureCard({ explicit: path.join(scratch, '不存在.md') })
check('显式指定但文件不存在时给 error 而不是崩', missing.source === 'error' && missing.parsed === null, missing.source)

const none = ensureCard({ cwd: path.join(scratch, '空目录'), memoryDir: null, bundled: path.join(scratch, '也没有.md') })
check('什么都没有时返回 none', none.source === 'none' && none.parsed === null, none.source)

// ---------------------------------------------------------------- 收尾
fs.rmSync(scratch, { recursive: true, force: true })
process.stdout.write(failures === 0 ? '\n全部通过 ✅\n' : `\n${failures} 项失败 ❌\n`)
process.exit(failures === 0 ? 0 : 1)
