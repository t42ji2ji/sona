const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startBackend, describeUvLine } = require('../backend')

const fake = path.join(__dirname, '..', 'dev', 'fake-backend.js')
const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sona-test-')), 'logs', 'backend.log')

test('describeUvLine', () => {
  assert.equal(describeUvLine('Downloading cpython-3.11.13-macos-aarch64-none (17.0MiB)'), '正在下載 Python')
  assert.equal(describeUvLine('Resolved 20 packages in 120ms'), '正在安裝依賴')
  assert.equal(describeUvLine('Using CPython 3.11.13'), '正在準備執行環境')
  assert.equal(describeUvLine('INFO: something else'), null)
})

test('啟動、health、stdin EOF 結束', async () => {
  const statuses = []
  const b = await startBackend({ command: process.execPath, args: [fake], env: { ...process.env, FAKE_DELAY_MS: '200' }, logFile, onStatus: (s) => statuses.push(s) })
  assert.ok(b.port > 0)
  assert.equal(b.token, 'fake-token')
  assert.deepEqual(statuses, ['正在下載 Python', '正在安裝依賴'])
  const res = await fetch(`http://127.0.0.1:${b.port}/api/health`)
  assert.deepEqual(await res.json(), { ok: true, version: 'fake' })
  const t0 = Date.now()
  await b.stop()
  assert.ok(Date.now() - t0 < 1500, 'stdin EOF 應該讓後端立即結束')
  await assert.rejects(fetch(`http://127.0.0.1:${b.port}/api/health`))
})

test('啟動前掛掉 → 錯誤帶 stderr 最後一行，log 有內容', async () => {
  await assert.rejects(
    startBackend({ command: process.execPath, args: [fake], env: { ...process.env, FAKE_CRASH: '1' }, logFile }),
    /No module named sona_backend/,
  )
  assert.match(fs.readFileSync(logFile, 'utf8'), /Traceback/)
})

test('執行檔不存在 → 錯誤', async () => {
  await assert.rejects(startBackend({ command: '/nonexistent/uv', args: [], env: process.env, logFile }), /無法啟動後端/)
})
