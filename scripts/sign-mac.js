// 憑證名稱含中文，codesign 用名稱找不到身分（編碼問題），一律用 SHA-1 hash 簽。
// electron-builder 傳進來的 identity 有時是名稱、有時已是 hash。
const { execFileSync } = require('node:child_process')
const { signAsync } = require('@electron/osx-sign')

exports.default = async function (opts) {
  let identity = opts.identity
  if (!/^[0-9A-F]{40}$/i.test(identity)) {
    const line = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning']).toString()
      .split('\n').find((l) => l.includes(`"${identity}"`))
    if (!line) throw new Error(`找不到簽名身分：${identity}`)
    identity = line.trim().split(/\s+/)[1]
  }
  await signAsync({ ...opts, identity })
}
