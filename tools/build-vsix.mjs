// 把 ide/vscode 打包成一个可以 `code --install-extension` 的 .vsix。
// .vsix 就是一个 zip：extension/ 放扩展本体，外加 extension.vsixmanifest 与 [Content_Types].xml。
// 顺便把 whale-chan 运行时（bin/src/assets）复制进 vendor/，这样装完扩展即可开箱使用。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// 仓库根 = 这个文件所在目录的上一级。**不要写死 C:/harness** ——
// 写死了在 GitHub Actions 的 runner 上就会 ENOENT，而且报错信息只说你缺一个
// package.json，完全看不出是路径写死的问题。
const ROOT = path.resolve(import.meta.dirname, '..')
const PKG = path.join(ROOT, 'whale-chan')
const EXT_DIR = path.join(PKG, 'ide', 'vscode')
const DIST = path.join(ROOT, 'whale-chan-dist')

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function createZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  const dosTime = 0
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    // 文件名里有非 ASCII（表情包的中文名、开发文档.md）时必须置通用标志位 bit 11，
    // 否则解压方按 CP437 解码，装出来的扩展目录里全是乱码文件名。
    const flags = /[^\x00-\x7F]/.test(entry.name) ? 0x0800 : 0
    const raw = entry.data
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuf, end])
}

// ------------------------------------------------------- 收集扩展文件

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.endsWith('.vsix')) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, base, out)
    else out.push(full)
  }
  return out
}

const pkgJson = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'))

// 1) 把运行时复制进 vendor/whale-chan
const vendorRoot = path.join(EXT_DIR, 'vendor', 'whale-chan')
fs.rmSync(path.join(EXT_DIR, 'vendor'), { recursive: true, force: true })
for (const relative of ['bin', 'src', 'assets', 'ide/bin', 'ide/jetbrains', 'ide/setup.mjs']) {
  const from = path.join(PKG, relative)
  if (!fs.existsSync(from)) continue
  fs.cpSync(from, path.join(vendorRoot, relative.replace(/\//g, path.sep)), { recursive: true })
}
fs.copyFileSync(path.join(PKG, 'package.json'), path.join(vendorRoot, 'package.json'))
for (const extra of ['README.md', 'LICENSE', 'ASSETS-NOTICE.md', '开发文档.md']) {
  const from = path.join(PKG, extra)
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(vendorRoot, extra))
}
process.stdout.write(`vendored runtime → ${vendorRoot}\n`)

// 2) 组装 zip 条目
const files = walk(EXT_DIR)
const entries = files.map((file) => ({
  name: `extension/${path.relative(EXT_DIR, file).split(path.sep).join('/')}`,
  data: fs.readFileSync(file),
}))

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkgJson.name}" Version="${pkgJson.version}" Publisher="${pkgJson.publisher}" />
    <DisplayName>${pkgJson.displayName}</DisplayName>
    <Description xml:space="preserve">${pkgJson.description}</Description>
    <Tags>terminal,agent,chat,whale</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkgJson.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace,ui" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".mjs" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".webp" ContentType="image/webp" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".yml" ContentType="text/yaml" />
</Types>
`

entries.unshift(
  { name: 'extension.vsixmanifest', data: Buffer.from(manifest, 'utf8') },
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
)

const zip = createZip(entries)
fs.mkdirSync(DIST, { recursive: true })
const target = path.join(DIST, `${pkgJson.name}-${pkgJson.version}.vsix`)
fs.writeFileSync(target, zip)
process.stdout.write(
  `${target}\n  ${entries.length} entries, ${(zip.length / 1024).toFixed(1)} KB\n`,
)
