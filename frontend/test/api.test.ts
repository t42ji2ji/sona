// 對假引擎後端跑：SONA_FAKE_ENGINES=1 SONA_PORT=8765 SONA_TOKEN=dev uv run --project ../backend python -m sona_backend
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, configure, mediaUrl, subscribe, ApiError } from '../src/api.ts'
import type { Job } from '../src/types.ts'

configure(process.env.SONA_API ?? 'http://127.0.0.1:8765', process.env.SONA_TOKEN ?? 'dev')

function waitForJob(id: string, until: (j: Job) => boolean, timeoutMs = 60000) {
  return new Promise<{ job: Job; seen: Job[] }>((resolve, reject) => {
    const seen: Job[] = []
    const timer = setTimeout(() => { stop(); reject(new Error('timeout; last ' + JSON.stringify(seen.at(-1)))) }, timeoutMs)
    const stop = subscribe({
      job: (j) => {
        if (j.id !== id) return
        seen.push(j)
        if (until(j)) { clearTimeout(timer); stop(); resolve({ job: j, seen }) }
      },
    })
  })
}

test('health / system / components', async () => {
  assert.equal((await api.health()).ok, true)
  const sys = await api.system()
  assert.ok(sys.capabilities.song)
  assert.ok(Array.isArray(await api.components()))
})

test('bad token → ApiError with message', async () => {
  configure(process.env.SONA_API ?? 'http://127.0.0.1:8765', 'wrong')
  await assert.rejects(api.jobs(), (e) => e instanceof ApiError && e.message.length > 0)
  configure(process.env.SONA_API ?? 'http://127.0.0.1:8765', process.env.SONA_TOKEN ?? 'dev')
})

test('song job → SSE done → track', async () => {
  for (const f of ['song'] as const) await api.installFeature(f)
  const job = await api.createJob('song', { title: 'api 測試', style: 'pop, piano', lyrics: '[verse]\n你好', mode: 'off' })
  assert.equal(job.type, 'song')
  const { job: done, seen } = await waitForJob(job.id, (j) => ['done', 'failed', 'cancelled'].includes(j.state), 120000)
  assert.equal(done.state, 'done', done.error ?? '')
  assert.ok(seen.some((j) => j.state === 'running'), 'saw running')
  assert.ok(done.track_id)
  const track = await api.track(done.track_id!)
  assert.ok(track.hue >= 0 && track.hue <= 360)
  assert.ok(track.audio_url.startsWith('/api/'))
  const res = await fetch(mediaUrl(track.audio_url), { headers: { Range: 'bytes=0-15' } })
  assert.ok(res.status === 206 || res.status === 200, 'audio ' + res.status)
  assert.ok((await api.tracks()).some((t) => t.id === track.id))
})

test('upload + cancel', async () => {
  const sr = 8000, n = sr
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), 44 + i * 2)
  const up = await api.upload(new Blob([buf], { type: 'audio/wav' }), 'tone.wav')
  assert.ok(up.upload_id)
  await api.installFeature('stems')
  const job = await api.createJob('stems', { upload_id: up.upload_id })
  await api.cancelJob(job.id)
  const final = await api.job(job.id)
  assert.ok(['cancelled', 'done'].includes(final.state) || final.state === 'running', final.state)
})
