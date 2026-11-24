import { test } from 'node:test'
import assert from 'node:assert/strict'
import { download, voiceStep } from '../src/onboard.ts'
import type { Component, Job, Voice } from '../src/types.ts'

const comp = (id: string, state: Component['state'], size = 100, done = 0, needed_for: Component['needed_for'] = ['voice_local']): Component =>
  ({ id, kind: 'model', name: id, description: '', size_bytes: size, done_bytes: done, state, needed_for })
const voice = { id: 'v1', name: 'me', transcript: '', duration_s: 12, created_at: '', sample_url: '' } as Voice
const job = (state: Job['state'], track_id?: string) => ({ id: 'j', state, track_id }) as Job

test('download: missing / downloading / error / ready, counts only what is left', () => {
  assert.equal(download([comp('a', 'missing'), comp('b', 'missing')], 'voice_local').state, 'missing')
  const d = download([comp('a', 'ready', 500, 500), comp('b', 'installing', 100, 40)], 'voice_local')
  assert.deepEqual([d.state, d.done, d.total], ['downloading', 40, 100])
  assert.equal(download([comp('a', 'error'), comp('b', 'installing')], 'voice_local').state, 'error')
  assert.equal(download([comp('a', 'ready'), comp('x', 'missing', 1, 0, ['song'])], 'voice_local').state, 'ready')
  assert.equal(download([], 'voice_local').state, 'missing')
  // 別的平台版本（unsupported）不算進大小，也不擋 ready
  const mac = download([comp('mlx', 'ready', 300, 300, ['song']), comp('torch', 'unsupported', 5000, 0, ['song'])], 'song')
  assert.deepEqual([mac.state, mac.total], ['ready', 0])
  const both = download([comp('a', 'missing', 100, 0, ['song']), comp('a2', 'missing', 50, 0, ['song', 'cover']), comp('b', 'missing', 10, 0, ['cover'])], ['song', 'cover'])
  assert.equal(both.total, 160)
})

test('voiceStep: derived from voices and the try-out job, survives reopening', () => {
  assert.equal(voiceStep([], undefined, false), 'record')
  assert.equal(voiceStep([voice], undefined, false), 'try')
  assert.equal(voiceStep([voice], job('running'), false), 'try')
  assert.equal(voiceStep([voice], job('failed'), false), 'try')
  assert.equal(voiceStep([voice], job('done', 't1'), false), 'listen')
  assert.equal(voiceStep([voice], job('done', 't1'), true), 'record')
})
