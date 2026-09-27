# 美术素材说明 / ASSETS NOTICE

本仓库的 **MIT 许可证只覆盖代码**。`assets/` 目录里的角色美术素材**不在 MIT 覆盖范围内**，
本仓库**不随代码再次授权**这些素材。

## 素材来源

| 文件 | 来源 | 状态 |
| --- | --- | --- |
| `assets/whale-q.png` | 由本机已安装的 `dsh-whale-widget` 包中的 `assets/DSniang1.png` 烘焙而来 | ⚠️ 非 MIT |
| `assets/whale-q.json` | 上表的元数据 | ⚠️ 非 MIT |
| `assets/whale.png` | 由 `@linxin666/dsh-pet` 的 `assets/whale/spritesheet.webp` 烘焙而来（上一版主形象，现作备份） | ⚠️ 非 MIT |
| `assets/whale.json` | 上表的元数据 | ⚠️ 非 MIT |

`DSniang1.png` 的一手出处是 **MeteorNOX/DeepSeek-Balance-Whale-Widget**：

- 仓库：https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget
- 该项目的 README / PROVENANCE 明确说明：**代码是 MIT，但 `assets/` 目录不在 MIT 覆盖内**，
  按原样分发、不授予再许可；两张角色图均为**来源不可追溯的 AI 生成图**。
- 本仓库只是把该立绘**降采样并终端化为像素画**，供个人在终端里显示，并保留了出处链接。

## 如果你要发布 / 分发

1. **最省事**：只分发代码（`bin/`、`src/`、`ide/`、`tools/`），
   让使用者在自己的机器上跑烘焙脚本，用他们本地已有的素材重建：
   ```powershell
   node tools/bake-q.mjs      # 默认读本机 dsh-whale-widget 里的 DSniang1.png
   ```
2. **换成你自己的立绘**：改 `tools/bake-q.mjs` 顶部的 `SOURCE` 与 `CROP` 常量即可。
   脚本只依赖 `sharp`（可以从任意已装 DSH profile 的 `node_modules` 里借用）。
3. 若确实要连带分发本仓库里的 `assets/whale-q.png`，请**自行确认**上游的使用条件，
   并在你的分发物里保留本文件与出处链接。

## 代码

`bin/`、`src/`、`ide/`、`tools/` 下的全部源文件以 **MIT** 授权，见 [LICENSE](LICENSE)。
运行时**零第三方依赖**（PNG 解码器是自己写的，只用 `node:zlib`）。
