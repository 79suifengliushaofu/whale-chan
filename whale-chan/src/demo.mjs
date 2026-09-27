// 演示后端：没有安装 dsh 时也能完整体验鲸鱼娘的终端形态。
// 它故意产生和 headless 一样的 NDJSON 事件（text / tool_call / tool_result / final），
// 方便在没有 DSH 的机器上做回归与截图。

const CANNED = {
  list: [
    { type: 'text', text: '我先看看这个目录里有什么～' },
    { type: 'tool_call', tool: 'glob', input: { pattern: '*', path: '.' } },
    { type: 'tool_result', status: 'completed', result: 'src/\npackage.json\nREADME.md\n' },
    { type: 'text', text: '这里有 src/、package.json 和 README.md。要不要我帮你跑一下测试？' },
  ],
  default: [
    { type: 'text', text: '收到啦～我这就去看看。' },
    { type: 'tool_call', tool: 'read', input: { filePath: 'package.json' } },
    { type: 'tool_result', status: 'completed', result: '{ "name": "demo", "version": "1.0.0" }' },
    { type: 'text', text: '看完了。这是演示模式（--demo），没有真的调用智能体哦。' },
    { type: 'text', text: '装好 dsh 之后去掉 --demo，我就能真的读文件、跑命令、改代码了～' },
  ],
}

export class DemoAgent {
  constructor() {
    this.sessionId = 'demo-local'
    this.child = null
  }

  get label() {
    return '演示模式'
  }

  get running() {
    return Boolean(this.timer)
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.done) this.done({ ok: false, error: '已取消', text: '', stderr: '' })
    this.done = null
  }

  run(prompt, handlers = {}) {
    const script = /目录|文件|list|ls|tree/i.test(prompt) ? CANNED.list : CANNED.default
    const queue = [...script]
    handlers.onEvent?.({ type: 'session', sessionId: this.sessionId, cwd: process.cwd() })
    handlers.onEvent?.({ type: 'status', phase: 'turn_start', turn: 1 })
    let last = ''
    const step = () => {
      const event = queue.shift()
      if (!event) {
        handlers.onEvent?.({ type: 'final', text: last })
        const done = this.done
        this.done = null
        this.timer = null
        done?.({ ok: true, code: 0, text: last, stderr: '', sawEvent: true })
        return
      }
      if (event.type === 'text') last = event.text
      handlers.onEvent?.(event)
      this.timer = setTimeout(step, event.type === 'tool_call' ? 500 : 900)
    }
    this.done = handlers.onDone
    this.timer = setTimeout(step, 400)
    return null
  }
}
