// 同時起 vite 與 electron；任一個結束就全部結束。後端由 electron 啟動。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron') // 回傳 electron 執行檔路徑
const root = new URL('..', import.meta.url).pathname
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const procs = [
  spawn(npm, ['--prefix', 'frontend', 'run', 'dev'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(electron, ['.'], { cwd: root, stdio: 'inherit' }),
]
for (const p of procs) {
  p.on('exit', (code) => {
    for (const q of procs) if (q !== p && q.exitCode === null) q.kill()
    process.exitCode = code ?? 0
  })
}
