import type { Component, Feature, Job, Voice } from './types.ts'

export type Download = { state: 'ready' | 'missing' | 'downloading' | 'error'; done: number; total: number; errors: string[] }

/** 一個功能還缺的元件合起來的下載狀態；total/done 只算還沒裝好的部分 */
export function download(comps: Component[], f: Feature): Download {
  const list = comps.filter((c) => c.needed_for.includes(f))
  const left = list.filter((c) => c.state !== 'ready')
  const errors = left.filter((c) => c.state === 'error').map((c) => `${c.name}：${c.error ?? ''}`)
  const total = left.reduce((a, c) => a + c.size_bytes, 0)
  const done = left.reduce((a, c) => a + c.done_bytes, 0)
  const state = list.length && !left.length ? 'ready'
    : errors.length ? 'error'
    : left.some((c) => c.state === 'installing' || c.state === 'queued') ? 'downloading'
    : 'missing'
  return { state, done, total, errors }
}

export type VoiceStep = 'record' | 'try' | 'listen'

/** 聲音 onboarding 走到哪一步，從後端狀態推：還沒有聲音就錄；有聲音就試說；試說的任務完成就聽 */
export function voiceStep(voices: Voice[], job: Job | undefined, rerecord: boolean): VoiceStep {
  if (rerecord || !voices.length) return 'record'
  return job?.state === 'done' && job.track_id ? 'listen' : 'try'
}
