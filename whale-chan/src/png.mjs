// 极简 PNG 解码器：只用 node:zlib，零第三方依赖。
// 支持 8 位灰度 / 灰度+alpha / RGB / RGBA / 调色板，非交错。

import zlib from 'node:zlib'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * @param {Buffer} buf
 * @returns {{width:number,height:number,data:Buffer}} RGBA8 像素
 */
export function decodePng(buf) {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('不是合法的 PNG 文件')
  }

  let offset = 8
  let width = 0
  let height = 0
  let depth = 8
  let colorType = 6
  let interlace = 0
  let palette = null
  let transparency = null
  const idat = []

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    if (type === 'IHDR') {
      width = buf.readUInt32BE(start)
      height = buf.readUInt32BE(start + 4)
      depth = buf[start + 8]
      colorType = buf[start + 9]
      interlace = buf[start + 12]
    } else if (type === 'PLTE') {
      palette = buf.subarray(start, start + length)
    } else if (type === 'tRNS') {
      transparency = buf.subarray(start, start + length)
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    offset = start + length + 4
  }

  if (interlace !== 0) throw new Error('暂不支持交错式 PNG')
  if (depth !== 8) throw new Error(`暂不支持 ${depth} 位深的 PNG`)
  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`暂不支持的颜色类型 ${colorType}`)
  if (!idat.length) throw new Error('PNG 缺少 IDAT 数据块')

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  let cursor = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]
    const rowStart = y * stride
    const current = pixels.subarray(rowStart, rowStart + stride)
    const previous = y > 0 ? pixels.subarray(rowStart - stride, rowStart) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels] : 0
      const b = previous ? previous[x] : 0
      const c = previous && x >= channels ? previous[x - channels] : 0
      const value = raw[cursor + x]
      let out
      switch (filter) {
        case 0: out = value; break
        case 1: out = value + a; break
        case 2: out = value + b; break
        case 3: out = value + ((a + b) >> 1); break
        case 4: out = value + paeth(a, b, c); break
        default: throw new Error(`未知的 PNG 行过滤器 ${filter}`)
      }
      current[x] = out & 0xff
    }
    cursor += stride
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0, total = width * height; i < total; i++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 255
    if (colorType === 6) {
      r = pixels[i * 4]
      g = pixels[i * 4 + 1]
      b = pixels[i * 4 + 2]
      a = pixels[i * 4 + 3]
    } else if (colorType === 2) {
      r = pixels[i * 3]
      g = pixels[i * 3 + 1]
      b = pixels[i * 3 + 2]
    } else if (colorType === 0) {
      r = g = b = pixels[i]
    } else if (colorType === 4) {
      r = g = b = pixels[i * 2]
      a = pixels[i * 2 + 1]
    } else {
      const index = pixels[i]
      r = palette[index * 3]
      g = palette[index * 3 + 1]
      b = palette[index * 3 + 2]
      if (transparency && index < transparency.length) a = transparency[index]
    }
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = a
  }

  return { width, height, data: rgba }
}

// ---------------------------------------------------------------------------
// 编码：把一个 RGB 缓冲写成最小 PNG（真彩色 8 位、无滤波）。
// 只用来导出预览图，运行时的界面渲染不需要它。
// ---------------------------------------------------------------------------

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

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgb width*height*3 字节
 * @returns {Buffer} PNG 文件内容
 */
export function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
