# 🐋 鲸鱼娘 · VS Code 扩展

> **不需要 API Key。** 扩展只是用你本机的 `node` 把 `whalechan` 这个 CLI 拉起来、
> 塞进集成终端；真正的模型调用由你**已经登录过**的 `dsh`（DeepSeek Harness）负责，
> 凭据在 `~/.dsh/.credentials.yaml` 里。扩展里没有一个跟密钥有关的设置项。

把 [whale-chan](../..) 塞进 VS Code。装好之后有**两种形态**，共用同一个后端进程：

| 形态 | 怎么开 | 长什么样 |
| --- | --- | --- |
| **真彩面板**（推荐） | `Ctrl+Alt+Shift+W`，或点状态栏「♡ 鲸鱼娘」 | 侧边栏/底部面板里的 Webview：真彩立绘 + CSS 动画 + 真鼠标事件 |
| **集成终端版** | `Ctrl+Alt+W`，或终端下拉里的「鲸鱼娘」 | 终端里的半格像素画，任何 IDE 都能跑 |

- 编辑器里选中一段代码 → 右键 → **「把选中的内容交给她」**；
- 命令面板里还有「检测这台电脑上的编辑器」「把鲸鱼娘配到其他编辑器里」。

## 安装

**① 从 Open VSX 装**（VSCodium / Cursor / Windsurf / Trae / Gitpod / code-server —— 都从这个源拉扩展）

扩展面板里（`Ctrl+Shift+X`）搜 **`鲸鱼娘`** 或 **`Whale Chan`**；或直接打开扩展页：

<https://open-vsx.org/extension/whale-chan/whale-chan-terminal>

> 刚发布时页面会挂一个 `verified: false` 的黄标 —— 那是 Open VSX 在**异步做签名校验**，
> 几分钟后自己消失，**不影响安装和使用**。

**② 手动装 vsix**（官方版 VS Code 走这条，原因见下）

```powershell
code --install-extension C:\harness\whale-chan-dist\whale-chan-terminal-1.8.0.vsix
```

> 微软的 VS Code Marketplace 目前**建发布者要绑 Azure 订阅**
> （[官方答复](https://learn.microsoft.com/en-sg/answers/questions/5964239/existing-vs-code-marketplace-publisher-cannot-gene)），
> 所以官方 VS Code 的扩展面板里暂时搜不到鲸鱼娘，只能拿 vsix 手动装。
>
> 装完**必须重载窗口**（`Ctrl+Shift+P` → Developer: Reload Window）。
> 而且 `code --install-extension` 在**版本号相同**时不会重新解包 —— 升级时版本号一定要变。

装完会自带一份 whale-chan 运行时（`vendor/whale-chan`），不需要另外安装。
它需要本机有 **Node.js**（会自动在常见路径里找，也可以在设置里指定）。

## 设置

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| `whaleChan.cliPath` | 自动 | `bin/whalechan.mjs` 的绝对路径 |
| `whaleChan.nodePath` | 自动 | node 可执行文件路径 |
| `whaleChan.profile` | `headless` | DeepSeek Harness profile |
| `whaleChan.permission` | `danger-full-access` | 沙箱权限 |
| `whaleChan.stickers` | 自动 | 表情包目录（默认按下面的顺序找） |
| `whaleChan.autoDetectIdes` | `true` | 首次启动 5 秒后扫一遍本机其他编辑器 |
| `whaleChan.followFiles` | `true` | 她写/改文件时自动在编辑器里把该文件露出来（不抢输入焦点）。关掉后仍会刷新资源管理器 |

## 她干的活，在你的 VS Code 里看得见

- 面板里每一次文件操作都会显示完整路径，旁边有个 **`打开`** 胶囊，点一下就在编辑器里打开它；
- 一轮结束时她会在对话里列一份 **「改了 N 个文件：a b c」**，每个都能点；
- 她一写文件，扩展就会 `workbench.files.action.refreshFilesExplorer` 刷新资源管理器
  （外部进程建的文件 VS Code 不一定自动看得到）；
- 开了 `whaleChan.followFiles`（默认）时，改动的文件会用 `preserveFocus` 在旁边露出来 ——
  你能看着她一层层写，但输入焦点还在面板上，不会打断你打字。
- 表情包气泡是**右下角一张小浮签**，不铺满、不带遮罩、点一下就收，不会挡住对话。

> 关于权限：`dsh headless` 没有交互审批通道，只有 `danger-full-access`
> 才会把审批设为 `never`。默认的 `workspace-write` 下，鲸鱼娘的任何写文件 /
> 跑命令的动作都会 fail closed。所以这里默认给足权限 —— 她是你的终端分身。

## 表情包目录怎么找

按顺序找，第一个存在的算数：

1. 设置 `whaleChan.stickers`
2. 环境变量 `WHALE_STICKER_DIR`
3. `<工作区>\表情包`、`<工作区上级>\表情包`
4. `~\表情包`
5. 扩展自带的 `vendor/whale-chan/assets/stickers`（**兜底，一定找得到**）

面板顶栏会显示「表情包 29」，找不到就是「表情包 ✗」。
调试命令：面板里敲 `/sticker` 会强制弹一张并报出用的哪个目录。

## 从源码打包

```powershell
node C:\harness\tools\bump-version.mjs 1.3.9   # 改了扩展代码就必须 bump
node C:\harness\tools\build-vsix.mjs
```
