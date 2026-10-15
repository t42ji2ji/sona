// electron-builder 只公證 .app；dmg 另外送 notarytool 並 staple，讓 dmg 本身也通過 stapler validate。
const { execFileSync } = require('node:child_process')

exports.default = async function ({ artifactPaths }) {
  for (const file of artifactPaths.filter((p) => p.endsWith('.dmg'))) {
    const out = execFileSync('xcrun', ['notarytool', 'submit', file, '--keychain-profile', 'away-blur', '--wait', '--output-format', 'json']).toString()
    const result = JSON.parse(out)
    if (result.status !== 'Accepted') {
      throw new Error(`dmg 公證失敗：${result.status}，用 xcrun notarytool log ${result.id} --keychain-profile away-blur 看原因`)
    }
    execFileSync('xcrun', ['stapler', 'staple', file], { stdio: 'inherit' })
  }
  return []
}
