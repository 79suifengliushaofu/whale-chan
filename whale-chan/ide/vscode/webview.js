// 鲸鱼娘 Webview 面板（扩展宿主侧）。
//
// 「终端一列 = 一个像素」是硬天花板，所以另开一条路：用真的 HTML + 真彩 PNG 画她。
// 面板可以挂在底部面板区（和 终端/问题/输出 并排），也可以开成一个大标签页。
//
// 数据流：
//   webview  ──postMessage──▶  BridgeHub  ──stdin──▶  whalechan --bridge
//   webview  ◀─postMessage──   BridgeHub  ◀─stdout──  whalechan --bridge

const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const HISTORY_LIMIT = 300

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}

/**
 * 管一个 `whalechan --bridge` 子进程，并把事件广播给所有打开的 webview。
 * 新打开的 webview 会先收到一份历史事件，所以切标签页不会「白屏」。
 */
class BridgeHub {
  constructor(options) {
    this.options = options // { nodePath, cli, args, cwd }
    this.child = null
    this.buffer = ''
    this.history = []
    this.listeners = new Set()
    this.output = options.output
    this.onHostMessage = options.onHostMessage || null
    this.stopping = false
  }

  listener(webview) {
    return (message) => {
      try {
        webview.postMessage(message)
      } catch {
        /* webview 已经销毁 */
      }
    }
  }

  subscribe(webview) {
    const fn = this.listener(webview)
    this.listeners.add(fn)
    for (const message of this.history) fn(message)
    this.ensureStarted()
    return { dispose: () => this.listeners.delete(fn) }
  }

  broadcast(message) {
    if (message.type !== 'card') {
      this.history.push(message)
      if (this.history.length > HISTORY_LIMIT) this.history.shift()
    }
    for (const fn of this.listeners) fn(message)
  }

  command(message) {
    // 这些是 webview 发给「扩展宿主」的，不是发给 --bridge 子进程的：
    // 打开文件、刷新资源管理器、跳到改动过的文件。别混进 stdin 里。
    if (
      this.onHostMessage &&
      message &&
      (message.type === 'openFile' || message.type === 'fileTouched' || message.type === 'setupIdes')
    ) {
      this.onHostMessage(message)
      return
    }
    if (!this.child) {
      this.ensureStarted()
      if (!this.child) return
    }
    if (message && message.type === 'ready') {
      // 已经 subscribe 时给过历史了，这里不用重复
      return
    }
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      this.broadcast({ type: 'error', message: `送不进去：${error.message}` })
    }
  }

  ensureStarted() {
    if (this.child) return
    const { nodePath, cli, args, cwd } = this.options
    if (!cli) {
      this.broadcast({
        type: 'error',
        message: '没找到 whalechan 入口。装一下扩展的 vendor 或者设置 whaleChan.cliPath。',
      })
      return
    }
    try {
      this.child = spawn(nodePath, [cli, '--bridge', ...args], {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      this.broadcast({ type: 'error', message: `起不来：${error.message}` })
      return
    }

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let index
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (!line) continue
        try {
          this.broadcast(JSON.parse(line))
        } catch {
          this.output?.appendLine(`[bridge] 非 JSON：${line.slice(0, 200)}`)
        }
      }
    })

    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => {
      this.output?.append(chunk)
      const text = String(chunk).trim()
      if (text) this.broadcast({ type: 'stderr', text: text.slice(0, 600) })
    })

    this.child.on('error', (error) => {
      this.broadcast({ type: 'error', message: `后端出错：${error.message}` })
    })

    this.child.on('close', (code) => {
      this.child = null
      if (!this.stopping) {
        this.broadcast({ type: 'note', text: `后端退出了（code ${code}）。发一句话就会重新起来。` })
        // 显式补一条 phase:idle：面板的发送键只在 phase/done 上解锁，
        // 后端死在回合中途时不会有 done，光发 note 会让它永久卡在 busy。
        this.broadcast({ type: 'phase', phase: 'idle' })
      }
    })
  }

  stop() {
    this.stopping = true
    this.listeners.clear()
    if (this.child) {
      try {
        this.child.stdin.end()
        this.child.kill()
      } catch {
        /* 已经没了 */
      }
      this.child = null
    }
  }
}

function findSheet(context) {
  const candidates = [
    path.join(context.extensionPath, 'vendor', 'whale-chan', 'assets', 'whale-web.png'),
    path.join(context.extensionPath, 'media', 'whale-web.png'),
    path.join(context.extensionPath, '..', '..', 'assets', 'whale-web.png'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function createHtml(webview, context, title) {
  const nonce = getNonce()
  const asset = (name) =>
    webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', name)).toString()
  const sheetPath = findSheet(context)
  const sheet = sheetPath
    ? webview.asWebviewUri(vscode.Uri.file(sheetPath)).toString()
    : asset('whale-web.png')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('panel.css')}">
<title>${title || '鲸鱼娘'}</title>
</head>
<body>
<div id="app">
  <header>
    <div class="row top">
      <span class="title">🐋 <span class="word">鲸鱼娘</span></span>
      <span class="spacer"></span>
      <button id="pat" data-short="✋" title="摸摸头（顺便让她弹一张表情包）">摸摸头</button>
      <button id="fresh" data-short="＋" title="丢掉当前会话，重新开始">新会话</button>
      <button id="stop" data-short="■" disabled title="打断当前回合">停一下</button>
    </div>
    <div class="row info">
      <button class="pill" id="account" title="点一下立刻重查余额和峰谷时段">余额 …</button>
      <span class="seg" id="effort" title="推理强度：她要想多久。点一下立刻换，下一个回合生效。">
        <span class="cap">思考</span>
        <button type="button" data-effort="default" title="跟随 profile 默认">默认</button>
        <button type="button" data-effort="off" title="完全不思考，最快也最便宜">关</button>
        <button type="button" data-effort="low" title="只想一点点">低</button>
        <button type="button" data-effort="high" title="认真想，日常推荐">高</button>
        <button type="button" data-effort="max" title="想到底，最慢也最贵">最强</button>
      </span>
      <button class="pill" id="favor" title="好感度。摸摸头会涨，每分钟最多一次。">♥ —</button>
      <button class="pill" id="memory" title="看她的人设、记忆和形象卡放在哪">记忆</button>
      <span class="meta" id="ver"></span>
      <span class="meta" id="phase"></span>
      <span class="badge" id="sticker-badge">表情包…</span>
      <span class="meta" id="session"></span>
    </div>
  </header>
  <main>
    <div id="pet-pane">
      <div id="bubble">…</div>
      <div id="card-layer"></div>
      <div id="pet" style="--sheet: url('${sheet}')"></div>
      <div id="hearts"></div>
    </div>
    <div id="chat-pane">
      <div id="log"></div>
    </div>
  </main>
  <footer>
    <textarea id="input" rows="1" placeholder="主人，跟她说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
    <span class="hint">她说的话都是真的会去执行的</span>
    <button id="send">发送</button>
  </footer>
</div>
<script nonce="${nonce}" src="${asset('panel.js')}"></script>
</body>
</html>`
}

/** 挂在底部面板区的「鲸鱼娘」标签页。 */
class WhaleViewProvider {
  constructor(hub, context) {
    this.hub = hub
    this.context = context
    this.views = new Set()
  }

  resolveWebviewView(view) {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }
    view.webview.html = createHtml(view.webview, this.context, '鲸鱼娘')
    const sub = this.hub.subscribe(view.webview)
    view.webview.onDidReceiveMessage((message) => this.hub.command(message))
    this.views.add(view)
    view.onDidDispose(() => {
      sub.dispose()
      this.views.delete(view)
    })
  }

  reveal() {
    const first = [...this.views][0]
    if (first) first.show?.(true)
  }
}

/** 同一个界面，但开成一个占满窗口的标签页。 */
class WhaleEditorPanel {
  static create(hub, context) {
    const panel = vscode.window.createWebviewPanel(
      'whaleChan.panel',
      '🐋 鲸鱼娘',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    )
    panel.webview.html = createHtml(panel.webview, context, '鲸鱼娘')
    const sub = hub.subscribe(panel.webview)
    panel.webview.onDidReceiveMessage((message) => hub.command(message))
    panel.onDidDispose(() => sub.dispose())
    return panel
  }
}

module.exports = { BridgeHub, WhaleViewProvider, WhaleEditorPanel, createHtml, findSheet }
