#!/usr/bin/env node
// 鲸鱼娘 · 编辑器检测与自动配置
//
// 「装一次，全机器都能用」：扫描这台电脑上装了哪些编辑器（VS Code 家族 +
// JetBrains 全家桶），能自动配的直接配好，配不了的说清楚要手动做什么。
//
//   node ide/setup.mjs                 检测并配置（默认行为）
//   node ide/setup.mjs --list          只检测，不动任何文件
//   node ide/setup.mjs --json          机器可读的结果（给 VS Code 扩展调用）
//   node ide/setup.mjs --vsix <路径>   给 VS Code 家族装这个 .vsix
//   node ide/setup.mjs --id <扩展 ID>  给 VS Code 家族装市场里的这个 ID
//   node ide/setup.mjs --here          只配置当前进程所在的编辑器（VS Code 内部用）
//
// 退出码：0 = 至少配好了一个；2 = 什么都没找到；1 = 出错。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')

// ---------------------------------------------------------------- 小工具

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

/** 在 PATH 里找一个可执行文件（Windows 上还要试 .cmd/.exe/.bat）。 */
function which(cmd) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', '.ps1', ''] : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext)
      if (exists(full)) return full
    }
  }
  return null
}

function firstExisting(paths) {
  for (const p of paths) if (p && exists(p)) return p
  return null
}

// ---------------------------------------------------------------- VS Code 家族

// cli 是命令行工具名；app 是用来在常见安装位置里找目录的名字。
const VSCODE_FAMILY = [
  { id: 'code', label: 'VS Code', cli: 'code', dirs: ['Microsoft VS Code', 'Microsoft VS Code Insiders'] },
  { id: 'code-insiders', label: 'VS Code Insiders', cli: 'code-insiders', dirs: ['Microsoft VS Code Insiders'] },
  { id: 'cursor', label: 'Cursor', cli: 'cursor', dirs: ['cursor', 'Cursor'] },
  { id: 'windsurf', label: 'Windsurf', cli: 'windsurf', dirs: ['Windsurf'] },
  { id: 'codium', label: 'VSCodium', cli: 'codium', dirs: ['VSCodium'] },
  { id: 'trae', label: 'Trae', cli: 'trae', dirs: ['Trae'] },
]

function candidatesFor(entry) {
  const out = []
  for (const dir of entry.dirs) {
    if (process.platform === 'win32') {
      out.push(path.join(LOCALAPPDATA, 'Programs', dir, 'bin', `${entry.cli}.cmd`))
      out.push(path.join(LOCALAPPDATA, 'Programs', dir, 'bin', entry.cli))
      out.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', dir, 'bin', `${entry.cli}.cmd`))
    } else if (process.platform === 'darwin') {
      out.push(`/Applications/${dir}.app/Contents/Resources/app/bin/${entry.cli}`)
      out.push(`/usr/local/bin/${entry.cli}`)
    } else {
      out.push(`/usr/bin/${entry.cli}`, `/usr/local/bin/${entry.cli}`, `/snap/bin/${entry.cli}`)
    }
  }
  return out
}

function findVscodeFamily() {
  const found = []
  for (const entry of VSCODE_FAMILY) {
    const cli = which(entry.cli) || firstExisting(candidatesFor(entry))
    if (cli) found.push({ kind: 'vscode', id: entry.id, label: entry.label, cli })
  }
  return found
}

// ---------------------------------------------------------------- JetBrains

const JETBRAINS_PRODUCTS = [
  ['PyCharm', 'PyCharm'],
  ['IntelliJIdea', 'IntelliJ IDEA'],
  ['IdeaIC', 'IntelliJ IDEA Community'],
  ['WebStorm', 'WebStorm'],
  ['GoLand', 'GoLand'],
  ['CLion', 'CLion'],
  ['PhpStorm', 'PhpStorm'],
  ['RubyMine', 'RubyMine'],
  ['Rider', 'Rider'],
  ['DataGrip', 'DataGrip'],
  ['DataSpell', 'DataSpell'],
  ['RustRover', 'RustRover'],
  ['Aqua', 'Aqua'],
  ['MPS', 'MPS'],
]

/** JetBrains 把每个产品的配置放在 %APPDATA%\\JetBrains\\<产品><版本>\\，认出目录就等于认出了产品。 */
function findJetbrains() {
  const root = path.join(APPDATA, 'JetBrains')
  let names = []
  try {
    names = fs.readdirSync(root)
  } catch {
    return []
  }
  const found = []
  for (const name of names) {
    if (name === 'consentOptions' || name.startsWith('.')) continue
    const product = JETBRAINS_PRODUCTS.find(([prefix]) => name.startsWith(prefix))
    if (!product) continue
    const dir = path.join(root, name)
    let isDir = false
    try {
      isDir = fs.statSync(dir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    found.push({ kind: 'jetbrains', id: name, label: `${product[1]} ${name.slice(product[0].length)}`.trim(), dir })
  }
  return found
}

// ---------------------------------------------------------------- 配置动作

function installVscodeExtension(editor, spec, { dry }) {
  if (dry) return { ok: true, action: 'dry-run', detail: `${editor.cli} --install-extension ${spec}` }
  // Windows 上 code/cursor 都是 .cmd 批处理，必须过 shell；而过 shell 时带空格的路径要自己加引号。
  const useShell = process.platform === 'win32'
  const cmd = useShell && /\s/.test(editor.cli) ? `"${editor.cli}"` : editor.cli
  const res = useShell
    ? spawnSync(`${cmd} --install-extension "${spec}" --force`, { encoding: 'utf8', shell: true })
    : spawnSync(cmd, ['--install-extension', spec, '--force'], { encoding: 'utf8' })
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim()
  const ok = res.status === 0 && !/not recognized|not found|Unable to install/i.test(out)
  return { ok, action: 'install-extension', spec, detail: out.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') }
}

const EXTERNAL_TOOLS_NAME = '鲸鱼娘'

/**
 * 找本地现成的 .vsix。
 *
 * 开发机上（还没发到市场）装 VS Code 扩展只能靠本地包；扩展被 vendor 进
 * 其他扩展里时找不到，这时才回落到市场 ID。
 */
function findLocalVsix() {
  const roots = [
    path.join(HERE, '..', '..', 'whale-chan-dist'),
    path.join(HERE, '..', '..'),
    path.join(HERE, '..'),
  ]
  const hits = []
  for (const root of roots) {
    let names = []
    try {
      names = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const n of names) {
      if (!/\.vsix$/i.test(n) || !/whale-chan/i.test(n)) continue
      const full = path.join(root, n)
      try {
        hits.push({ full, mtime: fs.statSync(full).mtimeMs })
      } catch {
        /* 忽略 */
      }
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime)
  return hits.length ? hits[0].full : null
}

// ---------------------------------------------------------------- 装到 PATH 上

/**
 * 把运行时装到一个固定目录并挂进用户 PATH。
 *
 * 这是 JetBrains 那边唯一能真正跑起交互界面的办法：PyCharm 没有 VS Code 那种
 * 「终端 profile」扩展点，但它自带的 Terminal 是个真正的 PTY —— 只要 `whalechan`
 * 在 PATH 上，敲一下就能用，跟 VS Code 里完全一样。
 */
function launcherDir() {
  return path.join(LOCALAPPDATA, 'Programs', 'whale-chan')
}

function copyTree(src, dst) {
  let n = 0
  let entries = []
  try {
    entries = fs.readdirSync(src, { withFileTypes: true })
  } catch {
    return 0
  }
  fs.mkdirSync(dst, { recursive: true })
  for (const e of entries) {
    const from = path.join(src, e.name)
    const to = path.join(dst, e.name)
    if (e.isDirectory()) n += copyTree(from, to)
    else {
      fs.copyFileSync(from, to)
      n++
    }
  }
  return n
}

/** 读注册表里用户 PATH 的**原始**值（含 %VAR%，不是展开后的）。 */
function readUserPath() {
  if (process.platform !== 'win32') return null
  const res = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return null
  const line = res.stdout.split(/\r?\n/).find((l) => /\bREG_(EXPAND_)?SZ\b/.test(l))
  if (!line) return null
  return line.split(/ {4,}/).slice(2).join('    ').trim()
}

function writeUserPath(value) {
  // 必须用 reg 直接写：setx 会把 %VAR% 展开、还会在 1024 字符处截断，属于毁 PATH 操作。
  const res = spawnSync(
    'reg',
    ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'],
    { encoding: 'utf8' },
  )
  return res.status === 0
}

function installLauncher({ dry, addPath = true }) {
  const pkgRoot = path.join(HERE, '..')
  const src = path.join(pkgRoot, 'bin', 'whalechan.mjs')
  if (!exists(src)) return { ok: false, action: 'skip', detail: `找不到 ${src}` }

  const dir = launcherDir()
  const cmd = path.join(dir, 'whalechan.cmd')
  if (dry) return { ok: true, action: 'dry-run', detail: `会装到 ${dir} 并${addPath ? '挂进 PATH' : '（不挂 PATH）'}` }

  let copied = 0
  for (const sub of ['bin', 'src', 'assets', 'ide']) copied += copyTree(path.join(pkgRoot, sub), path.join(dir, sub))
  // package.json 必须带上：bin/whalechan.mjs 的 --version 要读它。
  for (const f of ['package.json', 'README.md', 'LICENSE', 'ASSETS-NOTICE.md', '开发文档.md']) {
    const from = path.join(pkgRoot, f)
    if (!exists(from)) continue
    fs.copyFileSync(from, path.join(dir, f))
    copied++
  }
  // 纯 ASCII，别在 .cmd 里写中文 —— cmd.exe 按 OEM 代码页读，中文会把后面的内容解析成命令。
  fs.writeFileSync(
    cmd,
    '@echo off\r\nnode "%~dp0bin\\whalechan.mjs" %*\r\n',
    'ascii',
  )
  if (process.platform !== 'win32') {
    const sh = path.join(dir, 'whalechan')
    fs.writeFileSync(sh, '#!/bin/sh\nexec node "$(dirname "$0")/bin/whalechan.mjs" "$@"\n', 'utf8')
    fs.chmodSync(sh, 0o755)
  }

  let pathNote = ''
  if (addPath) {
    const current = readUserPath()
    if (current === null) {
      pathNote = '（读不到用户 PATH，请手动把该目录加进 PATH）'
    } else if (
      !current
        .split(';')
        .map((p) => p.trim().toLowerCase())
        .includes(dir.toLowerCase())
    ) {
      const next = current.endsWith(';') || !current ? `${current}${dir};` : `${current};${dir}`
      pathNote = writeUserPath(next) ? '（已挂进用户 PATH，新开的终端才看得到）' : '（写 PATH 失败，请手动添加）'
    } else {
      pathNote = '（本来就在 PATH 上）'
    }
  }

  return {
    ok: true,
    action: 'launcher',
    dir,
    detail: `${dir}${pathNote}`,
    copied,
  }
}

function externalToolsXml(scriptPath) {
  const tool = (name, task, prompt) => `    <tool name="${name}" description="让鲸鱼娘接手这件事"
          showInMainMenu="true" showInEditor="true" showInProject="true" showInSearchPopup="true"
          disabled="false" useConsole="true" showConsoleOnStdOut="true" showConsoleOnStdErr="true"
          synchronizeAfterRun="true">
      <exec>
        <option name="COMMAND" value="node" />
        <option name="PARAMETERS" value="&quot;${scriptPath}&quot; --once &quot;${task}&quot;" />
        <option name="WORKING_DIRECTORY" value="$ProjectFileDir$" />
      </exec>
    </tool>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<toolSet name="External Tools">
${tool(`${EXTERNAL_TOOLS_NAME}：问这个文件`, '看一下 $FilePathRelativeToProjectRoot$，跟我说说它是什么、有没有问题。', '')}
${tool(`${EXTERNAL_TOOLS_NAME}：跑一个任务…`, '$Prompt$', '')}
</toolSet>
`
}

/** 把两条 External Tool 合并进 JetBrains 的 External Tools.xml，已有的不重复写。 */
function configureJetbrains(editor, { dry }) {
  const toolsDir = path.join(editor.dir, 'tools')
  const file = path.join(toolsDir, 'External Tools.xml')
  const scriptPath = path.join(HERE, '..', 'bin', 'whalechan.mjs').replace(/\\/g, '/')
  let xml = ''
  try {
    xml = fs.readFileSync(file, 'utf8')
  } catch {
    xml = ''
  }
  if (xml.includes(EXTERNAL_TOOLS_NAME)) {
    return { ok: true, action: 'already', detail: `已经有「${EXTERNAL_TOOLS_NAME}」了：${file}` }
  }
  if (dry) return { ok: true, action: 'dry-run', detail: `会写 ${file}` }
  fs.mkdirSync(toolsDir, { recursive: true })
  if (!xml.trim()) {
    fs.writeFileSync(file, externalToolsXml(scriptPath), 'utf8')
  } else {
    const inject = externalToolsXml(scriptPath)
    const inner = inject.slice(inject.indexOf('\n', inject.indexOf('<toolSet')) + 1, inject.lastIndexOf('</toolSet>'))
    if (/<\/toolSet>/.test(xml)) {
      fs.writeFileSync(file, xml.replace(/<\/toolSet>/, `${inner}</toolSet>`), 'utf8')
    } else {
      return { ok: false, action: 'skip', detail: `${file} 不是预期的 External Tools 格式，没敢动它。` }
    }
  }
  return { ok: true, action: 'wrote', detail: file }
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const o = { list: false, json: false, dry: false, vsix: null, id: null, here: false, noPath: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list' || a === '--detect') o.list = true
    else if (a === '--json') o.json = true
    else if (a === '--dry' || a === '--dry-run') o.dry = true
    else if (a === '--here') o.here = true
    else if (a === '--no-path') o.noPath = true
    else if (a === '--vsix') o.vsix = argv[++i] ?? null
    else if (a === '--id') o.id = argv[++i] ?? null
    else if (a === '--help' || a === '-h') o.help = true
  }
  return o
}

const HELP = `鲸鱼娘 · 编辑器检测与自动配置

用法：node ide/setup.mjs [选项]

  --list            只检测这台电脑上有哪些编辑器，不改任何东西
  --json            输出机器可读的 JSON（供 VS Code 扩展调用）
  --vsix <路径>     给 VS Code 家族装这个 .vsix
  --id <扩展 ID>    给 VS Code 家族装插件市场里的这个 ID（默认 whale-chan.whale-chan-terminal）
  --no-path         只装 whalechan 命令，不把它挂进用户 PATH
  --dry             只说会做什么，不真的动文件
  --here            只报告当前进程所在的编辑器（VS Code 扩展内部用）
`

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }

  const editors = [...findVscodeFamily(), ...findJetbrains()]
  const installSpec = options.vsix || options.id || findLocalVsix() || 'whale-chan.whale-chan-terminal'

  const vscodeInstalled = editors.filter((e) => e.kind === 'vscode')
  const currentEditor = process.env.VSCODE_CWD || process.env.TERM_PROGRAM

  const results = []
  let launcher = null
  if (!options.list && !options.json) {
    launcher = installLauncher({ dry: options.dry, addPath: !options.noPath })
    const jetbrains = editors.filter((e) => e.kind === 'jetbrains')
    for (const editor of vscodeInstalled) {
      if (options.here && currentEditor && !`${editor.cli}`.includes(currentEditor)) continue
      results.push({ editor, ...installVscodeExtension(editor, installSpec, options) })
    }
    for (const editor of jetbrains) {
      results.push({ editor, ...configureJetbrains(editor, options) })
    }
  } else if (options.json && !options.list) {
    launcher = installLauncher({ dry: options.dry, addPath: !options.noPath })
    for (const editor of editors) {
      results.push({
        editor,
        ok: true,
        action: editor.kind === 'vscode' ? 'install-extension' : 'write-external-tools',
        detail: '',
      })
    }
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          editors: editors.map((e) => ({ kind: e.kind, id: e.id, label: e.label, cli: e.cli || e.dir })),
          spec: installSpec,
          launcher,
          results: results.map((r) => ({
            editor: r.editor.label,
            kind: r.editor.kind,
            ok: r.ok,
            action: r.action,
            detail: r.detail,
          })),
        },
        null,
        2,
      )}\n`,
    )
    return editors.length ? 0 : 2
  }

  const lines = ['', '  🐋 鲸鱼娘 · 编辑器检测', '']
  if (!editors.length) {
    lines.push('  这台电脑上没找到认识的编辑器。', '  手动接法见 ide/jetbrains/README.md 与 ide/vscode/README.md。', '')
  } else if (options.list) {
    for (const e of editors) {
      lines.push(`  · ${e.label.padEnd(18)} ${e.cli || e.dir}`)
    }
    lines.push('')
    lines.push('  要不要顺手配上？直接跑 node ide/setup.mjs')
    lines.push('')
  } else {
    if (launcher) {
      const mark = launcher.ok ? '✓' : '✗'
      lines.push(`  ${mark} ${'whalechan 命令'.padEnd(18)} ${launcher.action === 'dry-run' ? '（演练，未改动）' : '装好了'}`)
      if (launcher.detail) lines.push(`      ${launcher.detail}`)
      lines.push('')
    }
    for (const r of results) {
      const mark = r.ok ? '✓' : '✗'
      const verb =
        r.action === 'install-extension'
          ? `装了 ${r.spec}`
          : r.action === 'already'
            ? '已经配过了'
            : r.action === 'wrote'
              ? '写好了 External Tools'
              : r.action === 'dry-run'
                ? '（演练，未改动）'
                : '需要手动处理'
      lines.push(`  ${mark} ${r.editor.label.padEnd(18)} ${verb}`)
      if (!r.ok || options.dry) lines.push(`      ${r.detail}`)
    }
    const missed = editors.filter((e) => e.kind === 'jetbrains')
    if (missed.length) {
      lines.push('')
      lines.push('  JetBrains（PyCharm / IDEA …）：')
      lines.push('    · 交互式对话：重启 IDE，在内置 Terminal 里直接敲 whalechan')
      lines.push('      （它没有 VS Code 那种「终端 profile」扩展点，所以只能靠 PATH 上的命令）')
      lines.push('    · 顺手干活：重启 IDE 后右键 ▸ External Tools ▸ 鲸鱼娘')
      lines.push('      （External Tools 的控制台不是真终端，画不出角色，只适合一次性任务）')
      lines.push('')
    }
    lines.push('')
    lines.push('  VS Code 家族的用户：新装的扩展需要重启编辑器窗口才会生效。')
    lines.push('')
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return editors.length ? 0 : 2
}

process.exitCode = main()
