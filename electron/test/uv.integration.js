// 用內附 uv 跑 dev/fake-project，模擬打包後的唯讀 backend 目錄。第一次要下載 Python，較慢。
// node --test electron/test/uv.integration.js
const test = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startBackend, backendCommand } = require('../backend')

const uv = path.join(__dirname, '..', '..', 'build', 'uv', `darwin-${process.arch}`, 'uv')
const dataDir = process.env.SONA_TEST_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'sona-data-'))

const snapshot = (dir) => execFileSync('find', [dir, '-print']).toString().split('\n').sort().join('\n')

test('uv run 從唯讀 backend 啟動，不寫入 backend 目錄', { timeout: 15 * 60 * 1000 }, async () => {
  const backendDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sona-res-')), 'backend')
  fs.cpSync(path.join(__dirname, '..', 'dev', 'fake-project'), backendDir, { recursive: true })
  execFileSync(uv, ['lock', '--project', backendDir], { env: backendCommand({ uv, backendDir, dataDir, packaged: true }).env, stdio: 'inherit' })
  execFileSync('chmod', ['-R', 'a-w', backendDir])
  const before = snapshot(backendDir)

  const cmd = backendCommand({ uv, backendDir, dataDir, packaged: true })
  const statuses = []
  const b = await startBackend({ ...cmd, onStatus: (s) => statuses.push(s) })
  try {
    const body = await (await fetch(`http://127.0.0.1:${b.port}/api/health`)).json()
    assert.equal(body.ok, true)
    assert.equal(body.env, path.join(dataDir, 'envs', 'core'))
    console.log('statuses:', [...new Set(statuses)])
  } finally {
    await b.stop()
  }
  assert.equal(snapshot(backendDir), before)
  assert.ok(!fs.existsSync(path.join(dataDir, 'envs', 'core', 'lib', 'python3.11', 'site-packages', 'pytest')), '--no-dev 不該裝 dev group')
  execFileSync('chmod', ['-R', 'u+w', backendDir])
})
