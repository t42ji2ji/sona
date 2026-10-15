// 占位 icon：紫→粉漸層圓角方形，1024×1024 PNG。electron-builder 會從它轉出 icns / ico。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const S = 1024, PAD = 100, R = 185 // macOS icon 留邊與圓角
const from = [167, 139, 250], to = [244, 114, 182]
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  for (let x = 0; x < S; x++) {
    const t = (x + y) / (2 * S)
    // 圓角方形的有號距離，邊緣 1px 反鋸齒
    const qx = Math.abs(x + 0.5 - S / 2) - (S / 2 - PAD - R)
    const qy = Math.abs(y + 0.5 - S / 2) - (S / 2 - PAD - R)
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R
    const a = Math.min(Math.max(0.5 - d, 0), 1)
    const o = y * (S * 4 + 1) + 1 + x * 4
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(from[c] + (to[c] - from[c]) * t)
    raw[o + 3] = Math.round(a * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
writeFileSync(new URL('../electron/resources/icon.png', import.meta.url), png)
