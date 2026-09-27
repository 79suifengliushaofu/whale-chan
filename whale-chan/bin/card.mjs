#!/usr/bin/env node
//
// 形象卡小工具 —— 不用开鲸鱼娘也能读写她的形象卡。
//
//   node bin/card.mjs show                      她在读哪份卡、好感度多少、每轮带多少字
//   node bin/card.mjs log "今天把 console.log 都换掉了"    追加一条会话日志
//   node bin/card.mjs session "第一次会话"        追加日志并把 sessions_count +1
//   node bin/card.mjs favor +8                  好感度动一下（自动夹在 0..favor_max）
//   node bin/card.mjs set address_user_as 主人    改状态里的一个字段
//   node bin/card.mjs patch 补丁.json            按一份补丁批量改（状态 + 好感度 + 日志）
//   node bin/card.mjs path                      只打印卡的路径（给别的脚本用）
//   node bin/card.mjs init                      没有卡就从发行包复制一张过来
//
// 选项：--card <文件> 指定卡 · --dir <目录> 记忆目录 · --cwd <目录> 工作目录
//
// 「补丁」是一份 JSON，字段都可以省：
//   { "state": { "address_user_as": "主人", "favor": 88 },
//     "favor": "+8",
//     "log": ["一行", "另一行"] }
// state 直接合并进卡里的状态 JSON；favor 是增量或绝对值；log 逐行追加。

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  appendCardLog,
  bumpFavor,
  cardSummary,
  cardWeight,
  ensureCard,
  setCardState,
  writeCard,
} from '../src/card.mjs'

function parseArgs(argv) {
  const options = { command: '', rest: [], card: null, dir: null, cwd: process.cwd() }
  const args = [...argv]
  while (args.length) {
    const item = args.shift()
    if (item === '--card') options.card = args.shift() || null
    else if (item === '--dir') options.dir = args.shift() || null
    else if (item === '--cwd') options.cwd = args.shift() || process.cwd()
    else if (item === '-h' || item === '--help') options.command = 'help'
    else if (!options.command) options.command = item
    else options.rest.push(item)
  }
  if (!options.command) options.command = 'show'
  return options
}

/** 值是 "8" / "8.5" / "true" / "false" / "null" 就转成真类型，其它原样当字符串。 */
function coerce(raw) {
  const text = String(raw)
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d+\.\d+$/.test(text)) return Number(text)
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  return text
}

function open(options) {
  const memoryDir = options.dir || null
  const info = ensureCard({ explicit: options.card, cwd: options.cwd, memoryDir })
  if (!info.parsed) {
    const why = info.source === 'error' ? `：${info.error}` : '（工作目录和记忆目录里都没有「形象卡.md」）'
    throw new Error(`没找到形象卡${why}`)
  }
  return info
}

function print(info) {
  const weight = cardWeight(info.parsed)
  console.log(`形象卡：${info.file}（${info.source === 'bundled' ? '从发行包复制来的' : '本地的'}）`)
  console.log(`状态：${cardSummary(info.parsed)}`)
  console.log(`分量：人设 ${weight.persona} 字 · 记忆 ${weight.memory} 字 · 日志 ${weight.log} 字（每轮都带）`)
}

const HELP = `形象卡小工具

  node bin/card.mjs show                     看她在读哪份卡、好感度多少、每轮带多少字
  node bin/card.mjs log "内容"               追加一条会话日志
  node bin/card.mjs session "内容"           追加日志并 sessions_count +1
  node bin/card.mjs favor +8                 好感度动一下（夹在 0..favor_max）
  node bin/card.mjs set 字段 值              改状态里的一个字段
  node bin/card.mjs patch 补丁.json          按一份补丁批量改
  node bin/card.mjs path                     只打印卡的路径
  node bin/card.mjs init                     没有卡就从发行包复制一张

选项：--card <文件> · --dir <记忆目录> · --cwd <工作目录>`

function run(options) {
  const command = options.command
  if (command === 'help' || command === '--help') {
    console.log(HELP)
    return 0
  }
  if (command === 'path') {
    const info = open(options)
    console.log(info.file)
    return 0
  }
  if (command === 'init') {
    const info = ensureCard({ explicit: options.card, cwd: options.cwd, memoryDir: options.dir || null })
    if (!info.parsed) throw new Error(info.error || '发行包里也没有自带卡')
    print(info)
    return 0
  }
  if (command === 'show') {
    print(open(options))
    return 0
  }
  if (command === 'log' || command === 'session') {
    const info = open(options)
    const body = options.rest.join(' ').trim()
    if (!body) throw new Error(`用法：card.mjs ${command} "内容"`)
    appendCardLog(info.parsed, body.split('\n'), { bumpSession: command === 'session' })
    writeCard(info.parsed)
    print(info)
    return 0
  }
  if (command === 'favor') {
    const info = open(options)
    const raw = options.rest[0]
    if (raw === undefined) throw new Error('用法：card.mjs favor +8 · favor -3 · favor 45')
    const delta = /^[+-]\d+$/.test(raw) ? Number(raw) : undefined
    const target = delta === undefined ? Number(raw) : undefined
    if (delta === undefined && !Number.isFinite(target)) throw new Error(`看不懂的好感度：${raw}`)
    const before = Number(info.parsed.state.favor) || 0
    const after = bumpFavor(info.parsed, delta === undefined ? target - before : delta)
    writeCard(info.parsed)
    print(info)
    console.log(`好感度：${before} → ${after}`)
    return 0
  }
  if (command === 'set') {
    const info = open(options)
    const [key, ...valueParts] = options.rest
    if (!key || !valueParts.length) throw new Error('用法：card.mjs set 字段 值')
    const value = coerce(valueParts.join(' '))
    setCardState(info.parsed, { [key]: value })
    writeCard(info.parsed)
    print(info)
    console.log(`${key} = ${JSON.stringify(value)}`)
    return 0
  }
  if (command === 'patch') {
    const file = options.rest[0]
    if (!file) throw new Error('用法：card.mjs patch 补丁.json')
    // PowerShell 的 Set-Content -Encoding UTF8 会写 BOM，很多编辑器也会。
    // 不去掉的话 JSON.parse 会报 "Unexpected token '﻿'" —— 这坑踩过一次。
    const raw = fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '')
    const patch = JSON.parse(raw)
    const info = open(options)
    if (patch.state && typeof patch.state === 'object') setCardState(info.parsed, patch.state)
    if (patch.favor !== undefined) {
      const raw = String(patch.favor)
      if (/^[+-]\d+$/.test(raw)) bumpFavor(info.parsed, Number(raw))
      else bumpFavor(info.parsed, Number(raw) - (Number(info.parsed.state.favor) || 0))
    }
    if (patch.log) {
      const lines = Array.isArray(patch.log) ? patch.log : [patch.log]
      appendCardLog(info.parsed, lines, { bumpSession: Boolean(patch.session) })
    }
    writeCard(info.parsed)
    print(info)
    return 0
  }
  throw new Error(`不认识的动作：${command}（敲 card.mjs help 看用法）`)
}

function main() {
  try {
    process.exitCode = run(parseArgs(process.argv.slice(2)))
  } catch (error) {
    console.error(String(error && error.message ? error.message : error))
    process.exitCode = 1
  }
}

// 只有真的当脚本跑才执行 —— 被 import 去用 parseArgs 的时候不能顺手把命令跑了。
const isEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isEntry) main()

export { parseArgs, coerce, run }
