// 探针：看看 dsh-whale-widget 的 DSniang 立绘能不能拿来当终端角色。
//   node tools/probe-q.mjs
import { createRequire } from 'node:module'

const requireFromProfile = createRequire('C:/Users/admin/.dsh/profiles/web/package.json')
const sharp = requireFromProfile('sharp')

const ASSETS = 'C:/Users/admin/.dsh/profiles/web/node_modules/dsh-whale-widget/assets'

for (const name of ['DSniang1.png', 'DSniang02.png', 'DSH2.png']) {
  const file = `${ASSETS}/${name}`
  const image = sharp(file)
  const meta = await image.metadata()
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let opaque = 0
  let transparent = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + 3]
      if (a > 24) {
        opaque++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      } else transparent++
    }
  }
  const corner = (() => {
    const i = 0
    return [data[i], data[i + 1], data[i + 2], data[i + 3]].join(',')
  })()
  console.log(
    `${name}: ${meta.width}x${meta.height} fmt=${meta.format} alpha=${meta.hasAlpha} channels=${channels}\n` +
      `  corner RGBA=(${corner})  opaque=${opaque} (${((opaque / (width * height)) * 100).toFixed(1)}%) transparent=${transparent}\n` +
      `  content bbox = x ${minX}..${maxX} (${maxX - minX + 1}w), y ${minY}..${maxY} (${maxY - minY + 1}h)`,
  )
}
