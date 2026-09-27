// 鲸鱼娘终端 —— VS Code 扩展
//
// 它做的事情很简单：把 whale-chan 这个终端应用塞进 VS Code 的集成终端里。
// 于是鲸鱼娘就住在终端面板里，能聊天，也能通过 dsh 智能体跑命令、改文件。

const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { BridgeHub, WhaleViewProvider, WhaleEditorPanel } = require('./webview')

const TERMINAL_NAME = '鲸鱼娘'

let whaleTerminal = null

function config() {
  return vscode.workspace.getConfiguration('whaleChan')
}

/** 找 node：扩展宿主里的 process.execPath 是 Code.exe，不能直接用。 */
function findNode() {
  const configured = config().get('nodePath')
  if (configured && fs.existsSync(configured)) return configured
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'),
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/homebrew/bin/node',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    const nvm = path.join(process.env.APPDATA || '', 'nvm')
    const versions = fs
      .readdirSync(nvm)
      .filter((name) => name.startsWith('v'))
      .sort()
      .reverse()
    for (const version of versions) {
      const candidate = path.join(nvm, version, 'node.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  } catch {
    /* 没装 nvm */
  }
  return 'node'
}

/** 找 whalechan 入口：设置 → 工作区里的 whale-chan/ → 扩展自带的 vendor 副本。 */
function findCli(context) {
  const configured = config().get('cliPath')
  if (configured && fs.existsSync(configured)) return configured
  const folders = vscode.workspace.workspaceFolders || []
  const relatives = [
    'whale-chan/bin/whalechan.mjs',
    'bin/whalechan.mjs',
    'tools/whale-chan/bin/whalechan.mjs',
  ]
  for (const folder of folders) {
    for (const relative of relatives) {
      const candidate = path.join(folder.uri.fsPath, relative)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  const vendored = path.join(context.extensionPath, 'vendor', 'whale-chan', 'bin', 'whalechan.mjs')
  if (fs.existsSync(vendored)) return vendored
  return null
}

function cliArguments() {
  const args = []
  const profile = config().get('profile')
  const permission = config().get('permission')
  const stickers = config().get('stickers')
  if (profile) args.push('--profile', profile)
  if (permission) args.push('--permission', permission)
  if (stickers) args.push('--stickers', stickers)
  return args
}

function terminalOptions(context, cwd) {
  const cli = findCli(context)
  const folders = vscode.workspace.workspaceFolders
  const workingDirectory = cwd || (folders && folders.length ? folders[0].uri.fsPath : undefined)
  if (!cli) {
    // 退回到 PATH 上的 whalechan（用户可能已经全局安装过）
    return {
      name: TERMINAL_NAME,
      shellPath: process.platform === 'win32' ? 'whalechan.cmd' : 'whalechan',
      shellArgs: cliArguments(),
      cwd: workingDirectory,
      iconPath: undefined,
    }
  }
  return {
    name: TERMINAL_NAME,
    shellPath: findNode(),
    shellArgs: [cli, ...cliArguments()],
    cwd: workingDirectory,
  }
}

function openTerminal(context, cwd) {
  if (whaleTerminal) {
    try {
      whaleTerminal.show(false)
      return whaleTerminal
    } catch {
      whaleTerminal = null
    }
  }
  whaleTerminal = vscode.window.createTerminal(terminalOptions(context, cwd))
  whaleTerminal.show(false)
  return whaleTerminal
}

function oneLine(text, limit = 4000) {
  const flat = String(text).replace(/\s*\n\s*/g, ' ⏎ ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function promptForSelection(editor) {
  const selection = editor.selection
  const text = editor.document.getText(selection.isEmpty ? undefined : selection)
  const relative = vscode.workspace.asRelativePath(editor.document.uri, false)
  const language = editor.document.languageId
  const where = selection.isEmpty ? '整个文件' : '选中的这段'
  return `请看看 ${relative}（${language}）的${where}，先解释它在做什么，如果有问题直接改掉：\n\`\`\`${language}\n${oneLine(text)}\n\`\`\``
}

async function sendToWhale(context, prompt) {
  const terminal = openTerminal(context)
  // 等鲸鱼娘把界面画出来、进入原始输入模式，再把话喂进去，否则开头几个字会被吞掉。
  await new Promise((resolve) => setTimeout(resolve, 1500))
  terminal.sendText(oneLine(prompt).replace(/\r?\n/g, ' '), true)
}

// ------------------------------------------------------------ 编辑器自动检测
//
// 「在插件商店装一次，家里所有编辑器都配上」：调用 vendor 里的 ide/setup.mjs，
// 让它去扫 VS Code 家族（Code / Cursor / Windsurf / VSCodium / Trae）和 JetBrains
// 全家桶（PyCharm / IDEA / WebStorm …），该装扩展的装扩展，该写配置的写配置。

function findSetupScript(context) {
  const vendored = path.join(context.extensionPath, 'vendor', 'whale-chan', 'ide', 'setup.mjs')
  if (fs.existsSync(vendored)) return vendored
  const inRepo = path.join(context.extensionPath, '..', '..', 'ide', 'setup.mjs')
  if (fs.existsSync(inRepo)) return inRepo
  return null
}

/** 跑一遍检测，拿回 JSON 结果；脚本不在或跑挂了就返回 null。 */
function detectEditors(context) {
  const script = findSetupScript(context)
  if (!script) return null
  try {
    const res = require('child_process').spawnSync(findNode(), [script, '--json'], {
      encoding: 'utf8',
      timeout: 30000,
    })
    if (!res.stdout) return null
    return JSON.parse(res.stdout)
  } catch {
    return null
  }
}

/** 在终端里跑真正的配置流程，输出直接给用户看（VS Code 家族装扩展 / JetBrains 写 External Tools）。 */
function setupOtherEditors(context, vsixPath) {
  const script = findSetupScript(context)
  if (!script) {
    vscode.window.showWarningMessage('没找到 ide/setup.mjs，跳过自动配置。')
    return null
  }
  const args = [script]
  if (vsixPath && fs.existsSync(vsixPath)) args.push('--vsix', vsixPath)
  else if (config().get('extensionId')) args.push('--id', config().get('extensionId'))
  const terminal = vscode.window.createTerminal({
    name: '鲸鱼娘 · 编辑器检测',
    shellPath: findNode(),
    shellArgs: args,
  })
  terminal.show(false)
  return terminal
}

/** 检测里「不是当前这个编辑器」的那些。 */
function otherEditors(found) {
  if (!found || !Array.isArray(found.editors)) return []
  return found.editors.filter((editor) => editor.kind === 'jetbrains')
}

/** 把相对路径按工作区根目录展开。 */
function resolvePath(target) {
  if (!target) return null
  const cwd = (vscode.workspace.workspaceFolders || [])[0]?.uri?.fsPath
  if (path.isAbsolute(target) || !cwd) return path.resolve(target)
  return path.resolve(cwd, target)
}

/** 在编辑器里打开一个文件。preserveFocus=true 时只「露出来」，不抢走输入焦点。 */
async function openPath(target, { preview = true, preserveFocus = false } = {}) {
  const full = resolvePath(target)
  if (!full) return
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(full))
    await vscode.window.showTextDocument(doc, { preview, preserveFocus })
  } catch (error) {
    vscode.window.showWarningMessage(`鲸鱼娘想打开 ${target}，但失败了：${error.message}`)
  }
}

/**
 * webview 发来的「宿主侧」请求 —— 目的只有一个：**让她干的活儿在你眼前摊开**，
 * 而不是只留一句「我改好了」。
 *   openFile    → 在编辑器里打开那个文件
 *   fileTouched → 刷新资源管理器；如果是写操作且开了 followFiles，顺手把文件露出来
 */
async function onHostMessage(message) {
  if (!message) return
  if (message.type === 'openFile') {
    await openPath(message.path)
    return
  }
  if (message.type !== 'fileTouched') return
  // 外部进程新建的文件，VS Code 的资源管理器不一定马上看得到，手动刷一次。
  try {
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
  } catch {
    /* 个别发行版没这个命令，忽略 */
  }
  if (!message.write) return
  if (vscode.workspace.getConfiguration('whaleChan').get('followFiles') === false) return
  // preserveFocus：她一边写，你一边还能接着在面板里打字。
  await openPath(message.path, { preview: true, preserveFocus: true })
}

function activate(context) {
  // ---------------------------------------------------------- 面板版（真彩）
  const output = vscode.window.createOutputChannel('鲸鱼娘')
  context.subscriptions.push(output)

  const folders = vscode.workspace.workspaceFolders
  const hub = new BridgeHub({
    nodePath: findNode(),
    cli: findCli(context),
    args: cliArguments(),
    cwd: folders && folders.length ? folders[0].uri.fsPath : undefined,
    output,
    onHostMessage: (message) => onHostMessage(message),
  })
  context.subscriptions.push({ dispose: () => hub.stop() })

  const provider = new WhaleViewProvider(hub, context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('whaleChan.view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  let bigPanel = null
  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.openPanel', () => {
      if (bigPanel) {
        bigPanel.reveal(vscode.ViewColumn.Active)
        return
      }
      bigPanel = WhaleEditorPanel.create(hub, context)
      bigPanel.onDidDispose(() => {
        bigPanel = null
      })
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.pat', () => {
      const had = provider.views && provider.views.size > 0
      if (!had && !bigPanel) vscode.commands.executeCommand('whaleChan.openPanel')
      hub.command({ type: 'sticker' })
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.open', () => openTerminal(context)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.detectIdes', async () => {
      const found = detectEditors(context)
      if (!found) return vscode.window.showWarningMessage('检测脚本没跑起来，用 node ide/setup.mjs 手动跑一下。')
      const names = found.editors.map((e) => e.label).join('、') || '（一个都没找到）'
      const pick = await vscode.window.showInformationMessage(
        `鲸鱼娘：这台电脑上有 ${names}。要一起配上吗？`,
        '一起配上',
        '只看结果',
      )
      if (pick === '一起配上') setupOtherEditors(context, config().get('vsixPath'))
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.setupIdes', () =>
      setupOtherEditors(context, config().get('vsixPath')),
    ),
  )

  // 首次装上时自动扫一次；只提示，不擅自改动别的编辑器。
  if (config().get('autoDetectIdes') !== false && !context.globalState.get('whaleChan.idesChecked')) {
    context.globalState.update('whaleChan.idesChecked', true)
    setTimeout(() => {
      const others = otherEditors(detectEditors(context))
      if (!others.length) return
      const names = others.map((e) => e.label).join('、')
      vscode.window
        .showInformationMessage(
          `鲸鱼娘：检测到这台电脑上还装了 ${names}。要顺手把它们也配上吗？`,
          '一起配上',
          '以后再说',
        )
        .then((choice) => {
          if (choice === '一起配上') setupOtherEditors(context, config().get('vsixPath'))
        })
    }, 5000)
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.askSelection', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return vscode.window.showWarningMessage('先打开一个文件吧～')
      await sendToWhale(context, promptForSelection(editor))
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('whaleChan.askFile', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return vscode.window.showWarningMessage('先打开一个文件吧～')
      const relative = vscode.workspace.asRelativePath(editor.document.uri, false)
      await sendToWhale(context, `请读一下 ${relative}，说明它的作用，并指出可以改进的地方。`)
    }),
  )

  // 「终端 ▸ 新建终端」下拉里的「鲸鱼娘」配置
  if (typeof vscode.window.registerTerminalProfileProvider === 'function') {
    context.subscriptions.push(
      vscode.window.registerTerminalProfileProvider('whaleChan.profile', {
        provideTerminalProfile() {
          return new vscode.TerminalProfile(terminalOptions(context))
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === whaleTerminal) whaleTerminal = null
    }),
  )

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  status.text = '$(heart) 鲸鱼娘'
  status.tooltip = '点一下打开鲸鱼娘面板（终端版用 Ctrl+Alt+W）'
  status.command = 'whaleChan.openPanel'
  status.show()
  context.subscriptions.push(status)
}

function deactivate() {
  whaleTerminal = null
}

module.exports = { activate, deactivate }
