#!/usr/bin/env node
// 把 GitHub 仓库地址一次填进所有该写它的地方。
//
//   node tools/set-repo.mjs cuiyuestar/whale-chan
//   node tools/set-repo.mjs https://github.com/cuiyuestar/whale-chan
//   node tools/set-repo.mjs --show
//
// 会改：whale-chan/package.json、whale-chan/ide/vscode/package.json。
// 只碰 repository / homepage / bugs / qna 四个字段，别的一个字都不动。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  path.join(ROOT, 'whale-chan', 'package.json'),
  path.join(ROOT, 'whale-chan', 'ide', 'vscode', 'package.json'),
]

/** 'owner/repo' 或一个 URL → { owner, repo, url }；认不出来就抛。 */
export function parseRepo(input) {
  const raw = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!raw) throw new Error('用法：node tools/set-repo.mjs <OWNER/REPO 或仓库 URL>')
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+)$/.exec(raw)
  if (!m) throw new Error(`认不出这个仓库地址：${input}`)
  const [, owner, repo] = m
  return { owner, repo, url: `https://github.com/${owner}/${repo}` }
}

/** 生成要写进去的字段。单独导出，方便自检直接断言。 */
export function repoFields(url) {
  return {
    repository: { type: 'git', url: `git+${url}.git` },
    homepage: `${url}#readme`,
    bugs: { url: `${url}/issues` },
    qna: `${url}/issues`,
  }
}

/** 就地改、保持原有字段顺序；缺的键插在 license 后面。 */
function applyTo(file, fields) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  const wanted = new Map(Object.entries(fields))
  const ordered = {}
  for (const [key, value] of Object.entries(pkg)) {
    ordered[key] = wanted.has(key) ? wanted.get(key) : value
    if (key === 'license') {
      for (const [k, v] of wanted) if (!(k in pkg)) ordered[k] = v
    }
  }
  for (const [k, v] of wanted) if (!(k in ordered)) ordered[k] = v
  fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8')
  return ordered
}

function main() {
  const arg = process.argv[2]
  if (!arg || arg === '--help' || arg === '-h') {
    console.log('用法：node tools/set-repo.mjs <OWNER/REPO 或仓库 URL>')
    console.log('      node tools/set-repo.mjs --show   只看看现在写的是什么')
    return
  }
  if (arg === '--show') {
    for (const file of TARGETS) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
      console.log(path.relative(ROOT, file))
      console.log('  repository =', pkg.repository ? pkg.repository.url : '（没写）')
      console.log('  homepage   =', pkg.homepage || '（没写）')
    }
    return
  }
  const { url } = parseRepo(arg)
  const fields = repoFields(url)
  TARGETS.forEach((file, index) => {
    // 扩展那份多带 qna（Marketplace 右边那个「问答」链接），CLI 那份不需要。
    const subset = index === 0
      ? { repository: fields.repository, homepage: fields.homepage, bugs: fields.bugs }
      : fields
    applyTo(file, subset)
    console.log(`${path.relative(ROOT, file)} → ${url}`)
  })
  console.log('')
  // 版本号现读，别像上一版那样硬编码 —— 不然发 1.8.0 时提示里还写着 1.7.1。
  let version = '1.0.0'
  try {
    version = JSON.parse(fs.readFileSync(TARGETS[0], 'utf8')).version || version
  } catch {
    /* 读不到就用占位 */
  }
  console.log('下一步（在能连上 GitHub 的机器上跑）：')
  console.log(`  git init && git add -A && git commit -m "whale-chan ${version}"`)
  console.log(`  git remote add origin ${url}.git`)
  console.log('  git branch -M main && git push -u origin main')
  console.log(`  git tag v${version} && git push origin v${version}   # 触发 release.yml`)
}

const isEntry = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false
if (isEntry) main()
