// 假後端：模仿 uv 的 stderr、印 SONA_READY、回 /api/health、stdin EOF 就結束。
const http = require('node:http')

const delay = Number(process.env.FAKE_DELAY_MS || 0)
if (process.env.FAKE_CRASH) {
  process.stderr.write('Traceback (most recent call last):\nModuleNotFoundError: No module named sona_backend\n')
  process.exit(1)
}
process.stderr.write('Downloading cpython-3.11.13-macos-aarch64-none (17.0MiB)\n')
process.stderr.write('Resolved 20 packages in 120ms\n')

setTimeout(() => {
  const token = 'fake-token'
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, version: 'fake' }))
    res.statusCode = 404
    res.end(JSON.stringify({ error: { code: 'not_found', message: '找不到' } }))
  })
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`SONA_READY ${JSON.stringify({ port: server.address().port, token })}\n`)
  })
  process.stdin.on('end', () => process.exit(0))
  process.stdin.resume()
}, delay)
