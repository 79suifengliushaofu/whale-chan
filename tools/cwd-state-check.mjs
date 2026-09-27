// 回归测试：sessionId 必须「一个目录一个」。
//
// 背景（真事）：dsh 拒绝在 A 目录里续接「记在 B 目录」的会话 ——
//   {"type":"error","message":"session \"session-xxx\" was recorded in
//    \"C:\\harness\\demo-project\", not \"C:\\Users\\admin\\Desktop\""}   → exit 1
// 旧版 whale-chan 把 sessionId 存在一个全局 state.json 里，于是「在 A 项目聊过、
// 换到 B 目录打开」时第一句话必然「智能体退出（code 1）」。

import { normalizeCwd, sameCwd, sessionForCwd, withCwdSession } from '../whale-chan/src/memory.mjs'

let pass = 0
let fail = 0

function ok(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}\n      实际 ${a}\n      期望 ${b}`)
  }
}

console.log('路径归一化')
const win = process.platform === 'win32'
if (win) {
  ok('大小写不敏感', normalizeCwd('C:\\Harness\\Demo'), 'c:\\harness\\demo')
  ok('正斜杠也认', normalizeCwd('C:/harness/demo'), 'c:\\harness\\demo')
  ok('去掉尾部分隔符', normalizeCwd('C:\\harness\\demo\\\\'), 'c:\\harness\\demo')
  ok('混着写也认', sameCwd('C:\\Harness\\Demo\\', 'c:/harness/demo'), true)
} else {
  ok('大小写敏感', sameCwd('/tmp/A', '/tmp/a'), false)
  ok('去掉尾部分隔符', normalizeCwd('/tmp/a/'), '/tmp/a')
}
ok('空目录不相等', sameCwd('', ''), false)

console.log('\nsessionForCwd：只认自己那个目录')
const state = {
  sessionId: 'session-AAA',
  cwd: 'C:\\harness\\demo-project',
  byCwd: {
    [normalizeCwd('C:\\Users\\admin\\Desktop')]: { cwd: 'C:\\Users\\admin\\Desktop', sessionId: 'session-BBB' },
  },
}
ok('同目录 → 顶层那个', sessionForCwd(state, 'C:\\harness\\demo-project'), 'session-AAA')
ok('同目录（写法不同）', sessionForCwd(state, win ? 'c:/HARNESS/demo-project/' : 'C:\\harness\\demo-project'), 'session-AAA')
ok('别的目录 → 它自己那份', sessionForCwd(state, 'C:\\Users\\admin\\Desktop'), 'session-BBB')
ok('陌生目录 → null（开新会话）', sessionForCwd(state, win ? 'D:\\nowhere' : '/nowhere'), null)
ok('空 state → null', sessionForCwd(null, 'C:\\harness\\demo-project'), null)

console.log('\n⚠️ 关键回归：顶层 sessionId 属于别的目录时必须丢掉')
const stale = { sessionId: 'session-OLD', cwd: 'C:\\harness\\demo-project' }
ok('跨目录绝不返回旧 id', sessionForCwd(stale, 'C:\\Users\\admin\\Desktop'), null)
ok('旧文件没有 cwd 也不冒险', sessionForCwd({ sessionId: 'session-X' }, 'C:\\Users\\admin\\Desktop'), null)

console.log('\nwithCwdSession：记一份、只留最近 12 个')
const one = withCwdSession({}, 'C:\\harness\\demo-project', 'session-AAA', 2)
ok('写进去了', sessionForCwd({ ...one, cwd: 'C:\\harness\\demo-project', sessionId: 'session-AAA' }, 'C:\\harness\\demo-project'), 'session-AAA')
ok('键是归一化过的', Object.keys(one), [normalizeCwd('C:\\harness\\demo-project')])
ok('cwd 原样保存（好看）', one[normalizeCwd('C:\\harness\\demo-project')].cwd, 'C:\\harness\\demo-project')

let many = {}
for (let i = 0; i < 20; i++) {
  // ⚠️ withCwdSession 收的是**整个 state**，返回的是 byCwd 那张表。
  many = { ...many, byCwd: withCwdSession(many, win ? `C:\\p${i}` : `/p${i}`, `session-${i}`) }
}
ok('最多留 12 个', Object.keys(many.byCwd).length, 12)
ok('最新的那个在', Object.values(many.byCwd).some((v) => v.sessionId === 'session-19'), true)
ok('最老的那个被挤掉', Object.values(many.byCwd).some((v) => v.sessionId === 'session-0'), false)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
