// 下載固定版本的 uv 到 build/uv/<平台>，打包時放進 resources/uv。已存在就跳過。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VERSION = '0.12.19'
const TARGETS = {
  'darwin-arm64': { asset: 'uv-aarch64-apple-darwin.tar.gz', bin: 'uv' },
  'darwin-x64': { asset: 'uv-x86_64-apple-darwin.tar.gz', bin: 'uv' },
  'win-x64': { asset: 'uv-x86_64-pc-windows-msvc.zip', bin: 'uv.exe' },
}

const root = new URL('..', import.meta.url).pathname

for (const [dir, { asset, bin }] of Object.entries(TARGETS)) {
  const outDir = join(root, 'build', 'uv', dir)
  if (existsSync(join(outDir, bin))) continue

  const base = `https://github.com/astral-sh/uv/releases/download/${VERSION}/${asset}`
  const [data, sumText] = await Promise.all([fetchBuf(base), fetchBuf(`${base}.sha256`).then(String)])
  const expected = sumText.trim().split(/\s+/)[0]
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) throw new Error(`${asset} sha256 不符：${actual} != ${expected}`)

  const tmp = mkdtempSync(join(tmpdir(), 'sona-uv-'))
  const archive = join(tmp, asset)
  writeFileSync(archive, data)
  const extractDir = join(tmp, 'x')
  mkdirSync(extractDir)
  execFileSync('tar', ['-xf', archive, '-C', extractDir]) // bsdtar 也能解 zip
  const found = execFileSync('find', [extractDir, '-type', 'f', '-name', bin]).toString().trim().split('\n')[0]
  mkdirSync(outDir, { recursive: true })
  renameSync(found, join(outDir, bin))
  chmodSync(join(outDir, bin), 0o755)
  rmSync(tmp, { recursive: true, force: true })
  console.log(`uv ${VERSION} → build/uv/${dir}/${bin}`)
}

async function fetchBuf(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
