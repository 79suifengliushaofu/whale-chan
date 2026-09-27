// 推理强度：把 off / low / high / max 传给下面那次 `dsh headless`。
//
// 为什么不能只用环境变量：dsh 的推理强度是 `agent-default-model` 这个插件的 Config 字段，
// 而 headless 应用没有开对应的命令行开关。它认的是 `--patch <file>`，
// 所以我们现写一个 profile patch 文件挂上去。
//
// ⚠️ 踩过的坑：`--patch` 里的 `config:` 是**整体替换**，不是深合并。
// 只写 `reasoningEffort` 会把同一条的 `provider` / `model` 一起抹掉，
// 于是 dsh 会用不知道哪个默认模型跑。所以必须先把现有的 provider / model 读出来，三个字段一起写。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EFFORTS, isEffort } from './account.mjs'

export { EFFORTS, isEffort }

/**
 * 从 `dsh --dump-config` 的输出里抠出 `agent-default-model` 那一条的 provider / model。
 * 只认这一段，别的地方出现同名键不要受影响。
 */
export function parseModelDefaults(dumpText) {
  const lines = String(dumpText).split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s*-\s*id:\s*agent-default-model\s*$/.test(line))
  if (start < 0) return null
  const found = {}
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*-\s*id:/.test(line)) break // 下一条插件了
    const m = /^\s+(provider|model):\s*(\S+)\s*$/.exec(line)
    if (m) found[m[1]] = m[2]
  }
  return found.provider && found.model ? { provider: found.provider, model: found.model } : null
}

/**
 * 从 `--dump-config` 里抠出任意一条插件的 `config:` 顶层标量字段。
 * 返回 `{ 字段名: 字符串 }`，找不到那一条返回 null。
 *
 * 只取**正好比 config: 深一级**的键，免得把嵌套 map 里的同名键也捞进来。
 */
export function parseEntryConfig(dumpText, id) {
  const lines = String(dumpText).split(/\r?\n/)
  const pattern = new RegExp(`^\\s*-\\s*id:\\s*${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  const start = lines.findIndex((line) => pattern.test(line))
  if (start < 0) return null
  const found = {}
  let configIndent = -1
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*-\s*id:/.test(line)) break // 到下一条插件了
    if (configIndent < 0) {
      const m = /^(\s*)config:\s*$/.exec(line)
      if (m) configIndent = m[1].length
      continue
    }
    if (!line.trim()) continue
    const indent = line.search(/\S/)
    if (indent <= configIndent) break // config 段结束
    if (indent !== configIndent + 2) continue
    const m = /^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    let value = m[2]
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      value = value.slice(1, -1)
    }
    found[m[1]] = value
  }
  return found
}

/**
 * 读 profile 里系统提示词那一条现有的 personaPrefix / personaSuffix。
 *
 * 为什么要读：`--patch` 的 `config:` 是**整体替换**。想往系统提示词里加人设，
 * 就必须把原有的 personaPrefix / personaSuffix 一起写回去，
 * 否则 profile 自带的「You are a coding agent powered by the {{model}} model.」
 * 和「Your working directory is {{cwd}}.」会被我们悄悄抹掉。
 */
export function parseSystemPromptDefaults(dumpText) {
  return parseEntryConfig(dumpText, 'system-prompt') || {}
}

/** 跑一次 `dsh --profile <p> --dump-config`，返回原始输出；失败返回 null。 */
export function dumpProfileConfig({ dsh, profile, timeoutMs = 20000, env } = {}) {
  if (!dsh || !dsh.command) return null
  const args = [...(dsh.args || []), '--profile', profile, '--dump-config']
  let result
  try {
    result = spawnSync(dsh.command, args, {
      encoding: 'utf8',
      shell: dsh.shell || false,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: env || process.env,
    })
  } catch {
    return null
  }
  if (!result || result.status !== 0 || !result.stdout) return null
  return result.stdout
}

/** 跑一次 `dsh --profile <p> --dump-config` 拿到默认 provider / model。失败返回 null。 */
export function resolveModelDefaults(options = {}) {
  const text = dumpProfileConfig(options)
  return text ? parseModelDefaults(text) : null
}

/**
 * 一次 dump 同时拿到模型默认值和系统提示词的原有内容。
 * 启动时只跑一次 `--dump-config`（它要一两秒），别为了两个字段跑两遍。
 */
export function resolveProfileDefaults(options = {}) {
  const text = dumpProfileConfig(options)
  if (!text) return null
  const model = parseModelDefaults(text)
  const systemPrompt = parseSystemPromptDefaults(text)
  if (!model && !Object.keys(systemPrompt).length) return null
  return { model, systemPrompt, text }
}

/** 把一段可能带换行 / 引号的文字写成安全的 YAML 双引号标量。 */
export function yamlQuote(text) {
  const escaped = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/**
 * 生成 profile patch 的内容。
 *
 * provider / model 必须给全（整体替换的坑见文件头注释）。
 * effort 传 null / '' / 'default' 表示「不指定，用模型自带的默认」。
 * systemPrompt 传 `{ personaPrefix, personaSuffix }` 时会**一起**写上系统提示词那一条，
 * 里面的人设和记忆就是这么进模型的。
 */
export function profilePatchYaml({ provider, model, effort, systemPrompt } = {}) {
  if (!provider || !model) throw new Error('写 patch 必须同时给 provider 和 model，否则会把默认模型抹掉')
  const modelLines = ['- id: agent-default-model', '  config:', `    provider: ${provider}`, `    model: ${model}`]
  const value = String(effort || '').trim().toLowerCase()
  if (value && value !== 'default') {
    if (!isEffort(value)) throw new Error(`不认识的推理强度：${effort}（可选 ${EFFORTS.join(' / ')} / default）`)
    modelLines.push(`    reasoningEffort: ${value}`)
  }
  const blocks = [modelLines.join('\n')]
  if (systemPrompt && (systemPrompt.personaPrefix || systemPrompt.personaSuffix)) {
    const promptLines = ['- id: system-prompt', '  config:']
    if (systemPrompt.personaPrefix) promptLines.push(`    personaPrefix: ${yamlQuote(systemPrompt.personaPrefix)}`)
    if (systemPrompt.personaSuffix) promptLines.push(`    personaSuffix: ${yamlQuote(systemPrompt.personaSuffix)}`)
    blocks.push(promptLines.join('\n'))
  }
  return `${blocks.join('\n')}\n`
}

/** 只写推理强度的 patch（自检和 `--once` 用；完整版见 profilePatchYaml）。 */
export function effortPatchYaml({ provider, model, effort } = {}) {
  return profilePatchYaml({ provider, model, effort })
}

/** 把 patch 落到临时目录，返回文件路径。 */
export function writeProfilePatch(options = {}) {
  const dir = options.dir || os.tmpdir()
  const file = path.join(dir, `whale-chan-profile-${process.pid}.yml`)
  fs.writeFileSync(file, profilePatchYaml(options), 'utf8')
  return file
}

/** 旧名字，保留给已有调用点。 */
export function writeEffortPatch(options = {}) {
  return writeProfilePatch(options)
}

/** 人话：off → 关、low → 低、high → 高、max → 最高、default → 跟随模型 */
export const EFFORT_LABEL = {
  default: '跟随默认',
  off: '关闭思考',
  low: '低',
  high: '高',
  max: '最高',
}

export function effortLabel(value) {
  const v = String(value || 'default').toLowerCase()
  return EFFORT_LABEL[v] || v
}
