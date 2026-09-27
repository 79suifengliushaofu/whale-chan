# 🐋 whale-chan · 鲸鱼娘终端

> 在**任何编译器 / IDE 的集成终端**里养一只鲸鱼娘。
> 她会用 2D 像素形象住在终端的一块面板里，可以跟她聊天，
> 也可以让她**替你动手**——跑命令、改文件、装依赖、看日志，
> 凡是你能在这个终端里做的事，她都能做。

![鲸鱼娘终端界面](../whale-chan-dist/preview.png)

> **不需要 API Key。** 她调用的是你本机**已经登录过**的 `dsh`（DeepSeek Harness），
> 凭据在 `~/.dsh/.credentials.yaml` 里由 DSH 自己管。VS Code 扩展只负责用 `node`
> 把这个 CLI 拉起来塞进集成终端，全程不碰任何密钥，也没有「填 Key」这一步。

> 鼠标停到她身上时：

![被摸的鲸鱼娘](../whale-chan-dist/preview-purr.png)

> 干活干久了、或者闲下来的时候，她会自己弹一张表情包出来发表感想：

![表情包气泡](../whale-chan-dist/preview-card.png)

左边是鲸鱼娘本人（真彩色半格像素画，会动），头顶是她的台词气泡；
右边是对话记录；底部是输入行和状态栏。
她不用一张静态图糊弄你：**待命 / 思考 / 执行 / 完成 / 出错**各有各的表情，
**把鼠标停到她身上，她会眯起眼睛露出超享受的表情**。
性格是 **Q 萌 + 傲娇 + 粘人**——嘴上说着「才、才不是为了主人呢」，行动上已经贴过来了。
她**管你叫「主人」**，而且备了 **106 条**现成台词（66 条头顶气泡 + 40 条表情包卡片上的感想），
不用调一次模型就能换着花样说话；加台词只要往 `src/bubble.mjs` 的数组里塞字符串。

---

## 🪟 VS Code：真彩面板（推荐）

终端里「一列 = 一个像素」，所以她永远是像素画。想要**清晰的真彩立绘 + CSS 动画 + 真鼠标事件**，
用 VS Code 的面板版：

![VS Code 面板](../whale-chan-dist/panel-w620.png)

- 命令面板（`Ctrl+Shift+P`）→ **「鲸鱼娘：打开对话面板」**，或 `Ctrl+Alt+Shift+W`；
- 点右下角状态栏的 **♡ 鲸鱼娘** 也能打开；
- 侧边栏多了一个 🐋 图标（`viewsContainers`），面板可以拖到侧边栏，也可以停到底部面板；
- 面板布局：**左栏是她本人**（真彩图集，会呼吸、眨眼、被摸，**站在左栏底部**），
  **中间是对话流**，**底部是输入框**；
- 顶栏分两排：**第一排**是她和三颗按钮 —— **摸摸头**（她眯眼 + 冒爱心，顺便涨一点好感度）、**新会话**、**停一下**（面板窄的时候自动收成图标）；
  **第二排**全是状态和开关 —— 余额峰谷、**推理强度那五个小按钮**、好感度、记忆。
  第二排会整块换行，不会把中文压成两行；
- 鼠标真的能用了——**把指针移到她身上**就会切到「可爱享受」的表情；
- 表情包是**从她头顶冒出来的对话气泡**（真彩 PNG，不是半格像素画），带一个指向她的小尖角。
  它长在她自己那一栏里，**永远不进对话区**，点一下就收；
- 输入框里也认斜杠命令（`/memory` `/remember` `/forget` `/favor` `/effort` `/balance` `/clear` `/help`），
  跟终端那一套完全一样。

### 她干的活，在你眼前摊开

「看不见她在干什么」是最影响信任的一件事，所以面板里做了这些：

- 每个文件操作都显示**完整路径**，旁边一枚 **`打开`** 胶囊，点一下就在编辑器里打开；
- 一轮结束时她会列一份 **「改了 N 个文件：a b c」**，每个文件名都能点；
- 她一写文件就自动 **刷新资源管理器**（外部进程建的文件 VS Code 不一定马上看得到）；
- 默认还会用 `preserveFocus` 把改动的文件**在旁边露出来** —— 你能看着她一层层写，
  但输入焦点还在面板上，不会打断你打字。不想要就关 `whaleChan.followFiles`。

面板和终端版**共用同一个后端进程**（`node bin/whalechan.mjs --bridge`，NDJSON 双向通信），
所以你切来切去，对话是同一份。

> 浏览器里先看看版式也行（不用装 VS Code）：
> ```powershell
> node C:\harness\tools\panel-preview.mjs
> start C:\harness\whale-chan-dist\panel-preview.html
> ```

---

## 30 秒上手

**最省事的一行** —— 不用 clone、不用装，直接从 npm 拉下来跑：

```powershell
npx whale-chan
```

想装到全局、以后随处喊她：

```powershell
npm i -g whale-chan
whalechan
```

从源码跑（改了代码想立刻看效果时用这个）：

```powershell
node C:\harness\whale-chan\bin\whalechan.mjs
```

如果本机没装 DeepSeek Harness，先看看界面长什么样：

```powershell
npx whale-chan --demo
```

想在任何目录里随口喊她，就把它挂到 PATH（`ide\bin\whalechan.cmd` 已经写好了相对路径）：

```powershell
$env:PATH = "C:\harness\whale-chan\ide\bin;$env:PATH"
whalechan
```

---

## 各个 IDE 怎么接

| IDE | 接法 | 一键？ |
| --- | --- | --- |
| **VS Code** | 装了 `whale-chan-terminal-1.3.9.vsix` 扩展：**真彩面板** + **终端下拉**双形态，`Ctrl+Alt+W` 开终端、`Ctrl+Alt+Shift+W` 开面板 | ✅ |
| **Cursor / Windsurf / VSCodium / Trae** | 扩展会**自动检测**到它们，点一下「一起配上」就装好 | ✅ |
| **PyCharm / IDEA / WebStorm** | 扩展会**自动检测**到它们并写好 External Tools；交互式对话在 Terminal 里敲 `whalechan` | ✅ |
| **任何其他 IDE** | 只要它有一个真终端，`whalechan` 就能跑。Vim、Emacs、Xcode、Eclipse…… 通吃 | ✅ |

因为她是**终端应用**而不是某个编辑器的插件，所以「任何编译器」这句话是字面成立的；
VS Code 扩展和 JetBrains 配置只是省掉你敲字的那一步。

### 装一次，全家配上（编辑器自动检测）

`ide/setup.mjs` 会扫这台电脑上装了哪些编辑器，能自动配的直接配好：

```powershell
node C:\harness\whale-chan\ide\setup.mjs --list    # 只看检测到哪些
node C:\harness\whale-chan\ide\setup.mjs           # 直接配好（JetBrains 写 External Tools）
node C:\harness\whale-chan\ide\setup.mjs --vsix <某.vsix>   # 顺手给 Cursor 之类的也装上
```

它认识：

- **VS Code 家族** —— `code` / `code-insiders` / `cursor` / `windsurf` / `codium` / `trae`
  （先查 PATH，再查 `%LOCALAPPDATA%\Programs\…\bin\`），找到就 `<cli> --install-extension`；
- **JetBrains 全家桶** —— 扫 `%APPDATA%\JetBrains\<产品><版本>\`，认出 PyCharm / IDEA / WebStorm /
  GoLand / CLion / PhpStorm / RubyMine / Rider / DataGrip / RustRover…，把两条 External Tool
  合并进它的 `tools\External Tools.xml`（已经配过就不重复写）。

装了 VS Code 扩展的话不用手动跑：**首次启动 5 秒后扩展会自己扫一遍**，
弹一句「检测到这台电脑上还装了 PyCharm 2025.2、IntelliJ IDEA 2026.2，要一起配上吗？」。
命令面板里也有「鲸鱼娘：检测这台电脑上的编辑器」和「鲸鱼娘：把鲸鱼娘配到其他编辑器里」。

### VS Code

```powershell
code --install-extension C:\harness\whale-chan-dist\whale-chan-terminal-1.3.9.vsix
```

> 装完**必须重载窗口**（`Ctrl+Shift+P` → 「Developer: Reload Window」）。
> `code --install-extension` 在版本号相同时**不会重新解包**，所以升级时版本号一定要变。

装完：

- **Ctrl+Alt+Shift+W** —— 打开**真彩面板**（推荐，清晰得多）；
- **Ctrl+Alt+W**（macOS：**Cmd+Alt+W**）—— 在集成终端里唤醒她；
- 终端面板右上角 **+ ▾** 下拉 → **「鲸鱼娘」**；
- 编辑器里选中代码 → 右键 → **「把选中的内容交给她」**，她会自己读文件、解释、需要就改；
- 右下角状态栏 **「♡ 鲸鱼娘」**（点一下开面板）。

扩展自带一份运行时（`vendor/whale-chan`），装完即用，不依赖工作区里有没有这个仓库。

### PyCharm / JetBrains

**先说清楚为什么它和 VS Code 不一样**：VS Code 有「终端 profile」这个扩展点，
所以鲸鱼娘能直接出现在终端下拉菜单里。**PyCharm 没有对应的 API**，
JetBrains 插件是 Kotlin 写的另一套东西，一个终端程序塞不进去。
另外 `External Tools` 的那个控制台**不是真终端**（没有 PTY），
角色的半格像素画在里面画不出来，只适合跑一次性任务。

所以 JetBrains 这边靠的是**把 `whalechan` 挂到 PATH 上** —— 它的内置 Terminal 是货真价实的 PTY：

```powershell
node C:\harness\whale-chan\ide\setup.mjs
```

跑完会：

1. 把运行时装到 `%LOCALAPPDATA%\Programs\whale-chan\`；
2. 把这个目录挂进**用户 PATH**（直接写注册表，不是 `setx`，不会截断你原来的 PATH）；
3. 给每个 JetBrains 产品写好 External Tools。

然后**重启 PyCharm**（它启动时才读 PATH）：

1. 打开 **Terminal** 工具窗（`Alt+F12`），输入 `whalechan` —— 这就是全部，
   和 VS Code 里长得一模一样，鼠标摸头、表情包都齐。
2. 随手一问：**右键 ▸ External Tools ▸ 鲸鱼娘：问这个文件**（用 `--once`，答案打到控制台）。
3. 想让**每次新开 Terminal 直接是鲸鱼娘**：`Settings ▸ Tools ▸ Terminal ▸ Shell path`
   填 `C:\Users\<你>\AppData\Local\Programs\whale-chan\whalechan.cmd`。

---

## 她和谁在说话？—— 智能体后端

鲸鱼娘本体只负责「好看」和「好用」，真正干活的是**本机的 DeepSeek Harness**：

```
终端界面 (whale-chan)  ──NDJSON──▶  dsh --profile headless --json  ──▶  完整智能体
     你打字 / 看画面                 读文件·写文件·跑 pwsh·上网·子代理·技能
```

她给 `dsh` 传 `--json`，逐行读事件流：

```json
{"type":"tool_call","callId":"call_1","tool":"pwsh","input":{"command":"node --test"}}
{"type":"text","text":"测试全过了，一共 12 个用例。"}
{"type":"status","phase":"turn_end","turn":3,"reason":{"kind":"completed"}}
```

对话是**连续**的：第一回合拿到的 `sessionId` 会通过 `--session-id` 喂给下一回合，
所以她记得你刚才让她做的事。`/new` 才会把这条线剪断。

**没有 `dsh` 也能用**：`--demo` 用一份内置剧本走完全相同的界面与事件路径，
用来确认「界面这一侧」是好的。

### ⚠️ 关于权限（重要）

`dsh headless` 没有交互式审批通道，它的审批策略是：

```
approval = (DSH_PERMISSION_MODE === 'danger-full-access') ? 'never' : 'ask'
```

也就是说，如果沿用默认的 `workspace-write`，任何要写文件或跑命令的工具都会
**fail closed**（`sandbox escalation ... requires approval, but no approval channel is available`），
鲸鱼娘就变成了只会聊天的花瓶。

所以 whale-chan 默认给子进程注入 `DSH_PERMISSION_MODE=danger-full-access`，
让「她能做的 = 你能做的」这句话成立。想收紧就加 `--permission workspace-write` 或 `read-only`，
代价是她只能看不能动。

---

## 用法

```
whalechan [选项]

  --demo                 离线演示，不调用真实后端
  --once <任务>          只跑一次任务，结果打到标准输出（适合脚本 / External Tool）
  --screenshot           渲染一帧纯文本界面后退出（自检用）
  --cols <n> --rows <n>  截图尺寸
  --cwd <目录>           智能体的工作目录（默认当前目录）
  --profile <名称>       DSH profile（默认 headless）
  --permission <模式>    read-only | workspace-write | danger-full-access
  --stickers <目录>      表情包目录（默认找 <工作目录>/表情包、~/表情包）
  --card <文件>          指定形象卡（默认在工作目录和记忆目录里找）
  --no-card              不挂形象卡，退回 人设.md + 记忆.md
  --effort <档位>        推理强度：off | low | high | max | default（默认 default）
  --no-balance           不查 DeepSeek 余额（状态栏就不显示余额和峰谷）
  --memory-dir <目录>    记忆和人设放哪（默认 ~/.dsh/whale-chan）
  --no-memory            这次启动不读也不写记忆，也不挂人设
```

对话里的命令：`/help` `/clear` `/new` `/forget` `/memory` `/remember` `/card` `/favor` `/mouse` `/sticker` `/effort` `/balance` `/quit`

快捷键：

| 键 | 作用 |
| --- | --- |
| `Enter` | 发送 |
| `Ctrl+C` | 有输入时清空输入；输入为空时退出；正在跑时取消当前回合 |
| `Esc` | 取消当前回合 |
| `PgUp` / `PgDn`、`↑` / `↓` | 翻看对话 |
| `←` `→` `Home` `End` `Del` `Ctrl+U` `Ctrl+K` `Ctrl+L` | 行编辑（`Ctrl+L` 强制重画） |
| **鼠标移到她身上**（需先 `/mouse`） | 眯眼享受 + 飘爱心 |
| **左键点她一下**（需先 `/mouse`） | 额外高兴 2.6 秒 |

**鼠标摸头默认是关的。** 原因很实际：终端一旦开启鼠标上报（`?1003h`），
**拖拽框选文字就会被交给程序**，你就复制不了终端里的任何东西了 —— 对一个「能替你干活」的
终端来说这是不可接受的代价。所以：

- 想摸她 → 敲 `/mouse`（或启动加 `--mouse`），她会眯眼享受；用完再敲一次关掉；
- 想复制 → 鼠标直接拖就行，不用按 Alt；
- **VS Code 面板版没这个矛盾** —— Webview 里是真鼠标事件，摸头和框选互不干扰。

她**没有**为了「像聊天机器人」而牺牲能力：这是终端，她跑出来的任何东西你都能复制出去。

---

## 形象卡：一个人，一份文件

上面那三个文件各管一件事，但你要改「她是谁」的时候得同时开两个。所以还有更好的一种：
**形象卡** —— 一份 Markdown，人设、记忆、好感度、会话日志全在里面。

```
# 形象卡 · 凛凛（Rin-rin）
## 一、状态（机器可读）     ← 一个 ```json 块：名字 / 称呼 / 好感度 / 第几次会话
## 二、立绘（形象）
## 三、人设                 ← 她的性格
## 四、记忆                 ← 你告诉过她的事
## 五、会话日志             ← 她自动记的流水，新的在最上面
```

有卡的时候，**卡就是她**：每轮把卡裁好拼进系统提示词，回合结束把流水写回卡的日志小节，
好感度存在状态块里。发行包自带一张（凛凛），第一次跑会复制到 `~/.dsh/whale-chan/形象卡.md`；
你也可以在**工作目录**里放一份 `形象卡.md`（或者 `形象卡/某个.md`），她会优先用你放的那份。

启动时她会告诉你读的是哪一份：

```
· 形象卡 · 凛凛 · 好感度 86% · 称呼「宝宝」 · 第 3 次会话
· C:\Users\admin\.dsh\whale-chan\形象卡.md
· 每轮带着 31184 字（人设 19032 + 记忆 3850 + 日志 8305）｜想改就直接编辑这个文件 · /card 详情 · /favor +8 调好感度
```

**好感度怎么涨**：面板顶栏点「摸摸头」，或者在终端/输入框里 `/favor +8`。
「摸摸头」这条路**一分钟最多涨一点** —— 不然连点二十下就满级了，满级的好感度也就不叫好感度了
（冷却期间她照样会弹表情包，只是不涨分）。

或者从命令行直接改，不用开她：

```powershell
node C:\harness\whale-chan\bin\card.mjs show
node C:\harness\whale-chan\bin\card.mjs log "今天把 console.log 都换掉了"
node C:\harness\whale-chan\bin\card.mjs favor +8
python C:\harness\whale-chan\bin\card.py show
```

两个入口是同一份格式、同一份文件，`show / log / session / favor / set / patch / path / init` 全都有。
**Python 那份就住在 `whale-chan/bin/card.py`，随发行包一起发**；还没卡的时候它会自动把
发行包自带那张复制到记忆目录，所以命令可以直接敲。
`patch` 吃一份 JSON 补丁，方便别的脚本调：

```json
{ "state": { "address_user_as": "主人" }, "favor": "+8", "log": ["一行", "另一行"], "session": true }
```

对话里则是 `/card`（看路径和分量，`/card reload` 重新读）和 `/favor +8`。

想从素材造一张新卡：

```powershell
node C:\harness\tools\build-card.mjs --src C:\vscode --slug rinrin
# → whale-chan\assets\cards\rinrin.md
```

不想用卡？`--no-card`，她就退回上面那套 `人设.md` + `记忆.md`。

---

## 记忆与人设：关掉再打开，她还认得你

（没挂形象卡时走这套。）她会在 `~/.dsh/whale-chan/` 下开三个文件：

| 文件 | 谁写 | 干什么 |
| --- | --- | --- |
| `state.json` | 她 | 记住上次那个会话号。下次启动直接**续上整段历史**——她上次读了哪些文件、跑了哪些命令，都还在 |
| `人设.md` | **你** | 她的人设。第一次运行时写入一份默认的「Q 萌 + 傲娇 + 粘人」，**之后你再改，她绝不覆盖** |
| `记忆.md` | 她 | 每回合结束自动记一条：你说了什么、她用了哪些工具、她回了什么 |

启动时你会看到两行：

```
· 人设 602 字 · 记忆 5 条（C:\Users\admin\.dsh\whale-chan）｜/memory 看路径 · /remember <内容> 让她记住
· 接着上次聊（会话 ecc38b20｜2026-08-15 14:03）
```

**这是真的续接，不是「假装记得」。** 人设和记忆是拼进**系统提示词**的，每一轮都在，
所以不会像开场白那样聊到第三轮就被淹掉。

想改她的人设？直接编辑 `人设.md`，下次启动生效。想让她立刻知道某件事？
敲 `/remember 我用的是 pnpm 不是 npm`，下一个回合她就知道了。

担心隐私或者想让她「这次当个陌生人」？`--no-memory`，或者敲 `/forget` 只丢掉上次的会话号
（人设和记忆都留着）。记忆文件最大 24000 字符，超了从最老的开始剪，不会无限长。

---

## 余额、峰谷与推理强度

状态栏右边一直挂着三样东西：**推理强度**、**余额 + 当前是峰时还是谷时**、表情包数量。

```
 ✓ 完成  思考 高  余额 ¥2.06 · 谷时 · 距高峰 32h14m  表情包 29
```

### 峰谷

DeepSeek 的计价分峰谷，规则来自官方：

| 时段（北京时间） | 计价 |
| --- | --- |
| 周一至周五 **09:00–12:00**、**14:00–18:00** | 高峰（贵） |
| 周一至周五其余时间 | 谷时 |
| 周末全天 | 谷时，**2026-08-23 00:00 起生效** |
| 法定节假日全天 | 谷时，**2026-09-19 00:00 起生效** |

状态栏的峰谷字样**带颜色**：谷时绿、峰时暖黄 —— 贵不贵这件事最好不用读字。
倒计时指的是「下一次切换还有多久」。

⚠️ 注意上面两个生效日期：**2026-08-23 之前的周六仍然算高峰**，所以别拿 5 月的周末去验规则，
会以为代码写错了（`tools/selfcheck.mjs` 里专门为此留了一条注释和一组边界断言）。

### 余额

余额是从 `https://api.deepseek.com/user/balance` 现查的，25 秒缓存、失败不清空上次的值。

**它不问你任何东西** —— 按这个顺序自己找 key：

1. 环境变量 `DEEPSEEK_API_KEY`
2. `~/.dsh/.credentials.yaml` 里的 `refs.DEEPSEEK_API_KEY` → `records.<id>.payload.secret`

第二条就是**你已经登录的那个 `dsh` 的凭据文件**，所以正常情况零配置就有余额。
读不到时状态栏显示 `余额 —`，不会报错、不会阻塞对话。不想要就加 `--no-balance`。

### 推理强度

四档，直接映射到 DSH 的 `agent-default-model` 配置项 `reasoningEffort`：

| 档位 | 含义 |
| --- | --- |
| `default` | 不动，跟随 profile 自己的设置 |
| `off` | 关掉思考 |
| `low` | 低 |
| `high` | 高 |
| `max` | 最高 |

改法：

- **终端**：敲 `/effort high`，或者**开了鼠标之后直接点状态栏上那个「思考 X ↻」** —— 点一下往后换一档（默认 → 关 → 低 → 高 → 最强 → 默认）。
- **VS Code 面板**：顶栏第二排那五个小按钮，点哪个是哪个，当前那档亮着。
- **启动时**：`--effort high`。

**下一个回合生效**，当前正在跑的那一回合不受影响。

> 终端里那个「按钮」是拿坐标画出来的：终端本来没有按钮，所以渲染状态栏时
> 把「思考 X」占的列范围记下来，鼠标点中那个范围就当按了一下。
> 所以它只在开了鼠标（`/mouse`）的时候存在，也会显示成一个带 `↻` 的样子。

实现上它是给 `dsh` 传了一个临时 patch 文件（`--patch`）。这里有**两个坑**，都踩过：

1. **`--patch` 不是深合并，是整个替换 `config:`。** 只写 `reasoningEffort` 会把
   `provider` / `model` 一起抹掉，所以 patch 里必须把两个都带上 —— `src/effort.mjs`
   会先跑一次 `dsh --dump-config` 把当前值读出来再写全。
2. **`--patch` 必须排在应用自己的选项前面。** 写成 `--json --patch x` 会被当成 headless
   应用的参数，直接报 `unknown option '--patch'` 然后**什么都不干**（stdout 全空，看起来像
   任务失败但没有任何错误信息）。正确顺序是 `--profile <p> --patch <f> --json`。

---

## 她长什么样

Q 版小鲸鱼娘本体的素材来自参考项目
[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)
的 `assets/DSniang1.png`（本机 `dsh-whale-widget` 里就带着这张图）。

只在终端里放一张会动的图是不够的——她得有表情。所以构建期用 `sharp` + SVG 叠层
**在原始立绘上合成出六张表情**，横排成 `assets/whale-q.png`：

```powershell
node C:\harness\tools\bake-q.mjs
node C:\harness\tools\states.mjs      # 生成九宫格联络表，肉眼确认每张表情
```

| 帧 | `idle` | `blink` | `joy0` | `joy1` | `cheer` | `oops` |
| --- | --- | --- | --- | --- | --- | --- |
| 用在 | 待命 / 执行 | 眨眼、思考中 | **被摸（眯眼享受）** | **被摸（爱心飘动）** | 完成 ✨ | 出错 |

合成方式：先用肤色椭圆盖掉原来半睁的眼睛，再画上向下鼓的「放松闭眼」弧
（`joy0/joy1` 换成向上鼓的开心弧 + 加强腮红 + 飘动的爱心），出错帧加一滴蓝色汗。
所有叠层都在原图坐标系里画，眼睛、腮红的位置是用 `tools/calib.mjs` 打网格量出来的。

渲染走的是**真彩色半格**（`▀` + 前景/背景 24 位色），一个字符格塞两个像素。
112×32 的终端里她能占到约 49×25 格，脸的细节看得清。

> 一开始她是很糊的。原因有两个：缩小时用的是**盒式平均**（把五官平均成一团），
> 以及源图本身是柔和上色的插画。现在换成了 **Lanczos3 分离式重采样 + 非锐化掩模锐化
> + 轻微提对比/加饱和**（都在 `src/sprite.mjs` 里），眼睛、腮红、发丝高光都能看出来了。
> 剩下的模糊是物理上限：终端里一列就是一个像素，20 列宽的角色就是 20 像素宽。
> 想更清楚就把终端面板拉大。

面板底色参与 alpha 合成，所以她不会在深色主题下变成一团黑边。

终端只要**宽 ≥ 40 列、正文高 ≥ 5 行**就一定会画她；再小才降级成纯对话框。
（VS Code 的集成终端面板默认常常只有十几行高，早期版本用了 `rows < 16` 就整块不画的
阈值，结果用户根本看不到角色——现在阈值按「正文区」算，不会再出现这种情况。）

> 早先的版本还用过 `@linxin666/dsh-pet` 的九行全身精灵图（`assets/whale.png`，
> 由 `tools/bake-sprite.mjs` 烘焙）。那套图在终端里太小、太糊，所以现在主形象换成了
> 上面这套脸部特写；旧图集仍留在包里当备份。

---

## 表情包：她会自己挑图发表感想

**开箱自带 29 张**（打包在插件里，不用你准备任何东西）。她的目录里放着这些图，
**文件名就当中文分类用**，她就知道什么时候该掏哪一张：

```
assets/stickers/            ← 自带的，随插件分发
├── 完成任务时使用.png
├── 完成任务后傲娇地使用.png
├── 和用户调情时使用.png
├── 思考时间大于10s时使用.png
├── 网络延迟高，思考时间长，用户意图模糊时使用.png
├── 超短时间给出回答时使用.png
├── 用户生气时使用.png
└── ……（共 29 张）
```

想换成自己攒的，就往一个叫 `表情包` 的目录里丢 PNG —— **你自己的一份优先级更高**：

```
<工作目录>/表情包/           ← 你的，覆盖自带的
└── ……
```

找目录的顺序：`--stickers <目录>` → 环境变量 `WHALE_STICKER_DIR` → `<工作目录>/表情包` →
`<上一级>/表情包` → `<上上级>/表情包` → `~/表情包` → `~/.dsh/whale-chan/表情包` →
**`<安装目录>/assets/stickers`（自带兜底）**。

**什么时候弹**（两次之间至少隔 12 秒）：

| 时机 | 挑哪一类 |
| --- | --- |
| 一个回合干完了 | `完成任务时使用` / `完成任务后傲娇地使用`（交替） |
| 出错了 | `出错` / `失败` 之类 |
| 干活超过 15 秒 | `工作` / `正在工作` 之类 |
| 思考超过 10 秒 | `思考时间长` / `网络延迟高` 之类 |
| 空闲超过 45 秒 | `休息` / `无聊` 之类 |
| 你说「喜欢你」「抱抱」「贴贴」 | `和用户调情时使用` / `和用户暧昧时使用` |
| 你生气 / 骂人 | `用户生气时使用` / `用户对结果表示不屑时使用` |
| 你催她、嫌她慢 | `超短时间给出回答时使用` / `用户很急` 之类 |
| token 快用完了 | `余额不足` / `余额为零` 之类 |

匹配用的是「文件名包含某个关键词」，加新表情只要把 PNG 丢进去就行，**不用改代码**。
`/sticker` 可以立刻手动弹一张。

弹出的气泡长这样：**它从她头顶冒出来**，上面是那张表情包（用和角色一样的半格像素管线渲染，
所以也享受锐化），下面是她的**感想**（`src/bubble.mjs` 的 `FEELINGS` 池，按上下文分组），
底部注明用的是哪个文件，最下面一个小尖角指着她。

它**只长在她自己那一栏里**，不会碰到对话/输出区。空间不够时她会先缩小让位；
面板矮到放不下就干脆不弹。任意键立刻收起，干完活那张只显示 4.2 秒，不挡着你看答案。

---

## 自检与开发

```powershell
node C:\harness\tools\selfcheck.mjs     # 29 项断言：渲染、键盘、事件流、表情包、窄屏降级
node C:\harness\tools\preview.mjs       # 把界面渲染成 PNG，用来「亲眼」检查排版
node C:\harness\whale-chan\bin\whalechan.mjs --demo --screenshot --card --cols 112 --rows 32
node C:\harness\tools\build-vsix.mjs    # 重新打包 VS Code 扩展
node C:\harness\whale-chan\ide\setup.mjs   # 检测本机编辑器并自动配置
```

要动代码的话先看 **[开发文档.md](开发文档.md)**：渲染管线、NDJSON 协议、权限模型、
表情包匹配表、编辑器检测原理、以及一堆踩过的坑都在里面。

代码都在 `src/` 和 `bin/`，**零运行时依赖**（PNG 解码器是自己写的，用 `node:zlib`）：

| 文件 | 职责 |
| --- | --- |
| `bin/whalechan.mjs` | 命令行入口、参数解析 |
| `bin/card.mjs` / `bin/card.py` | 形象卡命令行（Node 与 Python 两个入口，格式一样） |
| `src/app.mjs` | 整个界面：布局、动画状态机、键盘、鼠标热区、对话渲染、表情包气泡 |
| `src/agent.mjs` | 调 `dsh headless --json`，解析 NDJSON，维护 `sessionId` |
| `src/bridge.mjs` | `--bridge` 的 NDJSON 后端，VS Code 面板走这条 |
| `src/card.mjs` | 形象卡：解析 / 写回 / 拼提示词 |
| `src/memory.mjs` | 没有人设卡时的退路：`state.json` + `人设.md` + `记忆.md` |
| `src/effort.mjs` | 推理强度：读 profile 默认值、生成 `--patch` YAML |
| `src/account.mjs` | 余额、峰谷时段、计费估算 |
| `src/demo.mjs` | 离线剧本后端 |
| `src/sprite.mjs` | 图集解码、Lanczos 缩放、锐化、半格绘制 |
| `src/sticker.mjs` | 表情包目录探测、上下文识别、按规则匹配 |
| `src/bubble.mjs` | 台词库（Q 萌 + 傲娇 + 粘人）与卡片感想池，共 106 条 |
| `src/png.mjs` | 纯 `node:zlib` 的 PNG 解码器 |
| `src/screen.mjs` | 差分刷新的终端画布（真彩色 + 同步刷新） |
| `src/text.mjs` | 东亚宽度感知的换行 / 截断 |

需要 **Node.js ≥ 18**（用了 `node:` 前缀与顶层 `await`；实测 Node 24）。
