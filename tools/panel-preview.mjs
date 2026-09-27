// 生成一个「不用装 VS Code 也能看」的面板预览 HTML。
//   node tools/panel-preview.mjs [输出路径]
//
// 它把 ide/vscode/media 里的 panel.css / panel.js 原样内联，再配一个假后端 ——
// 所以你在浏览器里看到的版式，就是 VS Code Webview 里的版式。
// 顺便用 headless Edge 截图（tools/panel-shot.mjs）就能自动化验收。

import fs from 'node:fs'
import path from 'node:path'

const PKG = 'C:/harness/whale-chan'
const MEDIA = path.join(PKG, 'ide', 'vscode', 'media')
const OUT = process.argv[2] || 'C:/harness/whale-chan-dist/panel-preview.html'

const css = fs.readFileSync(path.join(MEDIA, 'panel.css'), 'utf8')
const js = fs.readFileSync(path.join(MEDIA, 'panel.js'), 'utf8')
const sheet = fs.readFileSync(path.join(PKG, 'assets', 'whale-web.png')).toString('base64')
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version

const stickerDir = path.join(PKG, 'assets', 'stickers')
const names = fs.readdirSync(stickerDir).filter((name) => /\.png$/i.test(name))
const stickerFile = names.find((name) => name.includes('傲娇')) || names[0]
const sticker = fs.readFileSync(path.join(stickerDir, stickerFile)).toString('base64')
const stickerName = stickerFile.replace(/\.png$/i, '')

// 假后端：不开定时器，同步把一整轮对话推给界面，这样截图一定能截到完整版式。
const driver = String.raw`
const fire = (data) => window.dispatchEvent(new MessageEvent('message', { data }))
window.__handleOutgoing = (message) => {
  if (message.type === 'sticker') {
    fire({ type: 'card', key: 'pat', name: ${JSON.stringify(stickerName)}, title: '摸头时间',
      feeling: '呀…好舒服…才、才没有很享受呢！再摸一下也不是不行啦。',
      png: ${JSON.stringify(sticker)}, ms: 999999 })
    return
  }
  if (message.type === 'openFile') { fire({ type: 'bubble', text: '（预览里打不开 ' + message.path + '）' }); return }
  if (message.type === 'fileTouched') { return }
  if (message.type === 'new') { fire({ type: 'reset' }); return }
  if (message.type !== 'ask') return
  fire({ type: 'phase', phase: 'thinking' })
  fire({ type: 'bubble', text: '唔…先理一理思路，不许笑我。' })
  fire({ type: 'thinking', text: '先把 src/ 里所有 console.log 找出来…' })
  fire({ type: 'phase', phase: 'working' })
  fire({ type: 'tool', tool: 'pwsh', input: { command: 'rg -n "console\\.log" src/' } })
  fire({ type: 'tool_result', status: 'completed', result: 'src/agent.mjs:42\nsrc/app.mjs:118' })
  fire({ type: 'tool', tool: 'read', input: { filePath: 'C:/harness/demo-project/src/agent.mjs' } })
  fire({ type: 'tool', tool: 'write', input: { filePath: 'C:/harness/demo-project/src/logger.mjs' } })
  fire({ type: 'tool_result', status: 'completed', result: '写了 24 行' })
  fire({ type: 'tool', tool: 'edit', input: { filePath: 'C:/harness/demo-project/src/app.mjs' } })
  fire({ type: 'tool_result', status: 'completed', result: '替换 2 处' })
  fire({ type: 'text', text: '找到两处啦。我、我才不是特意帮你找的哦，是顺手…' })
  fire({ type: 'card', key: 'done', name: ${JSON.stringify(stickerName)}, title: '哼，做完了',
    feeling: '做完啦！…那个，做得还不错吧？你倒是看看我呀。',
    png: ${JSON.stringify(sticker)}, ms: 999999 })
  fire({ type: 'phase', phase: 'done' })
  fire({ type: 'done', ok: true, elapsed: 5189 })
  fire({ type: 'bubble', text: '做完了…你、你倒是看看我呀。' })
}

fire({ type: 'hello', version: ${JSON.stringify(VERSION)}, cwd: 'C:/harness/demo-project', dsh: 'dsh headless',
  stickerCount: 29, stickerDir: 'C:/harness/表情包', effort: 'default', effortLabel: '跟随默认',
  sessionId: 'session-ecc38b20-2acb-4f00-8735-185e2fbdefd6', memoryEnabled: true,
  memoryDir: 'C:/Users/admin/.dsh/whale-chan', memoryCount: 5, personaChars: 19032,
  card: { summary: '凛凛 · 好感度 86% · 称呼「宝宝」 · 第 3 次会话',
    file: 'C:/Users/admin/.dsh/whale-chan/形象卡.md', source: 'bundled', favor: 86 } })
fire({ type: 'account', enabled: true, ok: true, balance: 2.06, currency: 'CNY', source: 'dsh-credentials',
  error: null, peak: false, peakLabel: '谷时', countdownLabel: '距高峰', remainMs: 120348000,
  text: '余额 ¥2.06 · 谷时 · 距高峰 2天0小时', effort: 'default', effortLabel: '跟随默认' })
fire({ type: 'bubble', text: '嗨～我是鲸鱼娘！以后这里就归我管啦。' })
fire({ type: 'phase', phase: 'idle' })

// 假装用户说了一句话，然后走完整条链路
const input = document.getElementById('input')
input.value = '帮我把 src/ 里所有 console.log 换成 logger'
document.getElementById('send').click()
`

const stub = `window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__handleOutgoing(m) })`

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>鲸鱼娘面板 · 离线预览</title>
<style>${css}</style>
<style>body{background:#0b1120}.ribbon{position:fixed;right:10px;bottom:8px;color:#5d6f95;font:11px sans-serif;z-index:99}</style>
</head>
<body>
<div id="app">
  <header>
    <div class="row top">
      <span class="title">🐋 <span class="word">鲸鱼娘</span></span>
      <span class="spacer"></span>
      <button id="pat" data-short="✋" title="摸摸头">摸摸头</button>
      <button id="fresh" data-short="＋" title="新会话">新会话</button>
      <button id="stop" data-short="■" disabled title="停一下">停一下</button>
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
      <div id="pet" style="--sheet: url('data:image/png;base64,${sheet}')"></div>
      <div id="hearts"></div>
    </div>
    <div id="chat-pane"><div id="log"></div></div>
  </main>
  <footer>
    <textarea id="input" rows="1" placeholder="主人，跟她说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
    <span class="hint">她说的话都是真的会去执行的</span>
    <button id="send">发送</button>
  </footer>
</div>
<script>${stub}</script>
<script>${js}</script>
<script>${driver}</script>
</body>
</html>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, html)
process.stdout.write(`${OUT}  ${(html.length / 1024).toFixed(1)} KB（表情包：${stickerName}）\n`)
