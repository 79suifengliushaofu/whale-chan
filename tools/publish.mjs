#!/usr/bin/env node
// 一条命令把鲸鱼娘发到三个地方。
//
//   node tools/publish.mjs            # 真的发
//   node tools/publish.mjs --dry      # 只说要干什么、检查令牌在不在
//   node tools/publish.mjs --only npm # 只发某一个（npm | vscode | ovsx）
//
// 令牌全部从环境变量读，**永远不写进仓库**：
//   VSCE_PAT  Azure DevOps 的 PAT（scope 至少勾 Marketplace ▸ Manage）
//   OVSX_PAT  open-vsx.org 的 token
//   NPM_TOKEN npm 的 Automation token（不填也行，前提是你已经 npm login 过）
//
// 这三个都不是我在这个会话里能替你申请的 —— 见 whale-chan/发布方案.md。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(ROOT, 'whale-chan')
const EXT = path.join(PKG, 'ide', 'vscode')
const DIST = path.join(ROOT, 'whale-chan-dist')
const VSCE = path.join(ROOT, 'tools', 'pub', 'node_modules', '.bin', 'vsce.cmd')
const OVSX = path.join(ROOT, 'tools', 'pub', 'node_modules', '.bin', 'ovsx.cmd')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null

function step(title) {
  console.log('')
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`)
}

function run(command, commandArgs, options = {}) {
  console.log(`$ ${command} ${commandArgs.join(' ')}`)
  if (dry) return { status: 0, skipped: true }
  const r = spawnSync(command, commandArgs, { stdio: 'inherit', shell: true, ...options })
  return { status: r.status === null ? 1 : r.status }
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version
}

function npmEnv() {
  const token = process.env.NPM_TOKEN
  if (!token) return {}
  // 令牌只落在临时 .npmrc 里，进程一结束就没。
  const rc = path.join(os.tmpdir(), `whale-chan-npmrc-${process.pid}`)
  fs.writeFileSync(rc, `//registry.npmjs.org/:_authToken=${token}\n`, 'utf8')
  return { NPM_CONFIG_USERCONFIG: rc, cleanup: rc }
}

function main() {
  const v = version()
  const want = (name) => !only || only === name

  step('环境')
  const vsce = Boolean(process.env.VSCE_PAT)
  const ovsx = Boolean(process.env.OVSX_PAT)
  const npmToken = Boolean(process.env.NPM_TOKEN)
  console.log(`  版本          ${v}`)
  console.log(`  VSCE_PAT      ${vsce ? '在' : '不在（跳过 VS Code Marketplace）'}`)
  console.log(`  OVSX_PAT      ${ovsx ? '在' : '不在（跳过 Open VSX）'}`)
  console.log(`  NPM_TOKEN     ${npmToken ? '在' : '不在（会退回到你本机 npm login 的身份）'}`)
  console.log(`  vsce 工具     ${fs.existsSync(VSCE) ? '已装' : '没装（先跑 npm install --prefix tools/pub @vscode/vsce ovsx）'}`)

  if (want('vscode') || want('ovsx')) {
    step('打包 vsix')
    const r = run(process.execPath, [path.join(ROOT, 'tools', 'build-vsix.mjs')])
    if (r.status !== 0) return 1
  }

  const vsix = path.join(DIST, `whale-chan-terminal-${v}.vsix`)
  if ((want('vscode') || want('ovsx')) && !fs.existsSync(vsix) && !dry) {
    console.log(`  ✗ 没找到 ${vsix}`)
    return 1
  }

  if (want('vscode')) {
    step('VS Code Marketplace')
    if (!vsce) console.log('  跳过：没有 VSCE_PAT')
    else {
      // 先验令牌，再发布。令牌错了 vsce 会直接抛 401，但那时你已经等了一轮上传。
      run(VSCE, ['verify-pat', process.env.VSCE_PAT])
      const r = run(VSCE, ['publish', '--packagePath', vsix, '--skip-duplicate'], { env: { ...process.env } })
      if (r.status !== 0) {
        console.log('  ✗ 发布失败。最常见的两个原因：')
        console.log('     ① publisher「whale-chan」还没建 —— 先去 https://marketplace.visualstudio.com/manage 建一个（ID 建完不能改）')
        console.log('     ② PAT 的 scope 没勾 Marketplace ▸ Manage')
        return 1
      }
    }
  }

  if (want('ovsx')) {
    step('Open VSX')
    if (!ovsx) console.log('  跳过：没有 OVSX_PAT')
    else {
      // 命名空间要先建，建过会报错，无所谓 —— 这里只是免得第一次发布直接失败。
      run(OVSX, ['create-namespace', 'whale-chan'])
      const r = run(OVSX, ['publish', vsix, '--skip-duplicate'], { env: { ...process.env } })
      if (r.status !== 0) {
        console.log('  ✗ 发布失败。检查一下 OVSX_PAT 是不是 open-vsx.org 的（不是 GitHub 的）。')
        return 1
      }
    }
  }

  if (want('npm')) {
    step('npm')
    const env = npmEnv()
    const r = run('npm', ['publish', '--access', 'public', '--provenance=false'], {
      cwd: PKG, env: { ...process.env, ...env },
    })
    if (env.cleanup) fs.rmSync(env.cleanup, { force: true })
    if (r.status !== 0) return 1
  }

  step('完成')
  console.log('  VS Code Marketplace 大约 5 分钟后能在网页上看到；Open VSX 立刻生效。')
  console.log('  npm 装法：npx whale-chan --help')
  return 0
}

process.exit(main())
