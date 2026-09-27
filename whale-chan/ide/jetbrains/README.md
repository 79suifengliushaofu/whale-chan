# 鲸鱼娘 × JetBrains 系 IDE（PyCharm / IDEA / WebStorm …）

## 先说为什么和 VS Code 不一样

VS Code 提供了 **`contributes.terminal.profiles`** 这个扩展点，所以鲸鱼娘能直接出现在
终端的**下拉菜单**里，点一下就开。**JetBrains 没有等价的 API** —— 它的插件是 Kotlin 写的
另一套体系，不存在「往内置终端里注册一个 profile」这种能力。

而且 External Tools 的**控制台不是 PTY**（没有真终端），半格像素画在里面根本画不出来，
所以那边只能跑 `--once` 的一次性任务。

**结论：JetBrains 这边要在真正的 Terminal 工具窗里跑 `whalechan`。**
那个 Terminal 底层是 JediTerm，是货真价实的 PTY，鲸鱼娘在里面和 VS Code 里一模一样
（鼠标摸头、表情包气泡、彩色像素画全都有）。

先把命令装上：

```powershell
node <鲸鱼娘目录>\ide\setup.mjs
```

它会装到 `%LOCALAPPDATA%\Programs\whale-chan\` 并把该目录挂进用户 PATH
（直接写注册表，不用 `setx`，不会截断你原有的 PATH）。**之后要重启 IDE**，它启动时才读 PATH。

## 三种接法

### 1. 最省事：直接敲

`Alt+F12` 打开 Terminal，输入：

```powershell
whalechan
```

### 2. 变成「新终端就是这个」

`Settings ▸ Tools ▸ Terminal ▸ Shell path` 填：

```
C:\Users\<你>\AppData\Local\Programs\whale-chan\whalechan.cmd
```

之后每开一个新 Terminal 标签页，里面就是鲸鱼娘。
想临时回到普通 PowerShell，在设置里把 Shell path 清空即可。

> 小提示：这样设置后内置终端就不再是 PowerShell 了，
> 如果只是想偶尔召唤她，用第 1 种。

### 3. External Tools：一键把文件或任务丢给她

`node ide\setup.mjs` 已经帮你写好了。也可以手工来：关掉 IDE，把 `whale-chan-tools.xml`
里的两个 `<tool>` 节点合并进：

```
%APPDATA%\JetBrains\<产品名><版本>\tools\External Tools.xml
```

重启后右键 ▸ **External Tools** 里就会多出：

- **鲸鱼娘：问这个文件** —— 对当前文件跑 `--once`，答案直接打在控制台；
- **鲸鱼娘：跑一个任务…** —— 弹窗里输入任务，她去做。

这两项用的是 `--once`（一次性任务），不适合长时间对话 —— 想聊天请用第 1、2 种。

## 4. 环境变量

想让 External Tools 也带上正确的工作目录 / 权限，可以在 **Run ▸ Edit Configurations ▸
Templates** 里给 External Tools 模板加环境变量：

| 变量 | 作用 |
| --- | --- |
| `DSH_PERMISSION_MODE` | `danger-full-access` 时她才真的能写文件、跑命令 |
| `WHALE_PROFILE` | 换个 DSH profile |
| `DSH_BIN` | 指定 `dsh` 入口路径 |
