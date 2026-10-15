// 後端子行程管理。不依賴 electron，可在 node 單獨跑（見 electron/test）。
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// uv 的 stderr 最後一行 → 啟動畫面上的中文
function describeUvLine(line) {
  if (/cpython|python/i.test(line) && /download|install/i.test(line)) return '正在下載 Python'
  if (/^(Resolved|Prepared|Downloading|Installed|Building|Built|Audited|Uninstalled)\b/.test(line.trim())) return '正在安裝依賴'
  if (/Creating virtual environment|Using CPython/i.test(line)) return '正在準備執行環境'
  return null
}

// 啟動後端，回傳 Promise<{ port, token, stop }>。onStatus(文字) 回報進度。
function startBackend({ command, args, cwd, env, logFile, onStatus = () => {}, onExit = () => {} }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  log.write(`\n=== ${new Date().toISOString()} ${command} ${args.join(' ')}\n`)

  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let ready = false
  let stderrTail = ''

  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('exit', () => resolve())
    child.stdin.end() // 後端監看 stdin EOF
    const term = setTimeout(() => child.kill('SIGTERM'), 2000)
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(term); clearTimeout(kill) })
  })

  return new Promise((resolve, reject) => {
    let outBuf = ''
    child.stdout.on('data', (chunk) => {
      log.write(chunk)
      if (ready) return
      outBuf += chunk
      let i
      while ((i = outBuf.indexOf('\n')) >= 0) {
        const line = outBuf.slice(0, i).trim()
        outBuf = outBuf.slice(i + 1)
        const m = line.match(/^SONA_READY (\{.*\})$/)
        if (m) {
          ready = true
          const { port, token } = JSON.parse(m[1])
          resolve({ port, token, stop })
          return
        }
      }
    })

    let errBuf = ''
    child.stderr.on('data', (chunk) => {
      log.write(chunk)
      errBuf += chunk
      const lines = errBuf.split(/\r?\n|\r/)
      errBuf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        stderrTail = line.trim()
        if (!ready) {
          const text = describeUvLine(line)
          if (text) onStatus(text)
        }
      }
    })

    child.on('error', (err) => {
      log.write(`spawn error: ${err.message}\n`)
      reject(new Error(`無法啟動後端：${err.message}`))
    })
    child.on('close', (code, signal) => {
      log.end(`=== exit code=${code} signal=${signal}\n`)
      if (!ready) reject(new Error(stderrTail || `後端在啟動前結束（code ${code}）`))
      else onExit(code, signal)
    })
  })
}

// 組出啟動後端的指令。packaged 時後端原始碼在 app bundle 內，不能寫入：
// venv、pycache 都導到資料目錄，並用 --frozen 避免改寫 uv.lock。
function backendCommand({ uv, backendDir, dataDir, packaged, env = process.env }) {
  return {
    command: uv,
    args: ['run', '--project', backendDir, ...(packaged ? ['--frozen', '--no-dev'] : []), 'python', '-m', 'sona_backend'],
    cwd: backendDir,
    env: {
      ...env,
      SONA_UV: uv,
      UV_CACHE_DIR: path.join(dataDir, 'uv', 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(dataDir, 'uv', 'python'),
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_PROJECT_ENVIRONMENT: path.join(dataDir, 'envs', 'core'),
      PYTHONPYCACHEPREFIX: path.join(dataDir, 'pycache'),
    },
    logFile: path.join(dataDir, 'logs', 'backend.log'),
  }
}

module.exports = { startBackend, backendCommand, describeUvLine }
