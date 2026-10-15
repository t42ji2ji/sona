import type {
  Component, Events, Feature, Job, JobParams, JobType, Settings, SettingsPatch, System, Track, Upload, Voice,
} from './types.ts'

declare global {
  interface Window {
    sona?: {
      apiBase: string | null
      token: string | null
      platform: string
      openExternal(url: string): Promise<void>
      pickFile?(filters?: unknown): Promise<string | null>
    }
  }
}

let base = ''
let token = ''

export function configure(apiBase: string, apiToken: string) {
  base = apiBase.replace(/\/$/, '')
  token = apiToken
}

if (typeof window !== 'undefined') {
  const s = window.sona
  configure(
    s?.apiBase || import.meta.env.VITE_SONA_API || 'http://127.0.0.1:8765',
    s?.token || import.meta.env.VITE_SONA_TOKEN || 'dev',
  )
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`${base}/api${path}`, { method, headers, body: payload })
  } catch {
    throw new ApiError('network', '連不上後端')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(data?.error?.code ?? String(res.status), data?.error?.message ?? res.statusText)
  return data as T
}

/** audio_url、stems[].url、sample_url 這類相對路徑 → 可直接給 <audio> 的網址 */
export function mediaUrl(rel: string) {
  return `${base}${rel}${rel.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

function form(fields: Record<string, string | Blob>, filename?: string) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') f.append(k, v)
    else f.append(k, v, filename ?? (v as File).name ?? 'audio')
  }
  return f
}

export const api = {
  health: () => req<{ ok: true; version: string }>('GET', '/health'),
  system: () => req<System>('GET', '/system'),

  components: () => req<Component[]>('GET', '/components'),
  installComponent: (id: string) => req<unknown>('POST', `/components/${encodeURIComponent(id)}/install`),
  cancelComponent: (id: string) => req<unknown>('POST', `/components/${encodeURIComponent(id)}/cancel`),
  deleteComponent: (id: string) => req<unknown>('DELETE', `/components/${encodeURIComponent(id)}`),
  installFeature: (f: Feature) => req<unknown>('POST', `/features/${f}/install`),

  createJob: <T extends JobType>(type: T, params: JobParams[T]) => req<Job>('POST', '/jobs', { type, params }),
  jobs: () => req<Job[]>('GET', '/jobs'),
  job: (id: string) => req<Job>('GET', `/jobs/${id}`),
  cancelJob: (id: string) => req<unknown>('POST', `/jobs/${id}/cancel`),
  deleteJob: (id: string) => req<unknown>('DELETE', `/jobs/${id}`),

  tracks: () => req<Track[]>('GET', '/tracks'),
  track: (id: string) => req<Track>('GET', `/tracks/${id}`),
  patchTrack: (id: string, patch: { title?: string; liked?: boolean }) => req<Track>('PATCH', `/tracks/${id}`, patch),
  deleteTrack: (id: string) => req<unknown>('DELETE', `/tracks/${id}`),
  revealTrack: (id: string) => req<unknown>('POST', `/tracks/${id}/reveal`),

  upload: (file: Blob, filename?: string) => req<Upload>('POST', '/uploads', form({ file }, filename)),

  voices: () => req<Voice[]>('GET', '/voices'),
  createVoice: (name: string, transcript: string, file: Blob, filename?: string) =>
    req<Voice>('POST', '/voices', form({ name, transcript, file }, filename)),
  deleteVoice: (id: string) => req<unknown>('DELETE', `/voices/${id}`),

  settings: () => req<Settings>('GET', '/settings'),
  putSettings: (patch: SettingsPatch) => req<Settings>('PUT', '/settings', patch),
}

type Handlers = { [K in keyof Events]?: (data: Events[K]) => void } & {
  /** 每次（重新）連上時呼叫；斷線期間結束的任務不會重送，呼叫端要自己重抓 */
  open?: () => void
  close?: () => void
}

/** SSE（用 fetch 讀串流，瀏覽器與 node 同一套），斷線自動重連。回傳取消函式。 */
export function subscribe(h: Handlers): () => void {
  const ctrl = new AbortController()
  let delay = 1000

  const dispatch = (block: string) => {
    let type = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) return
    const fn = (h as Record<string, ((d: unknown) => void) | undefined>)[type]
    if (fn && type !== 'open' && type !== 'close') fn(JSON.parse(data.join('\n')))
  }

  ;(async () => {
    while (!ctrl.signal.aborted) {
      try {
        const res = await fetch(mediaUrl('/api/events'), { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } })
        if (!res.ok || !res.body) throw new Error(String(res.status))
        delay = 1000
        h.open?.()
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value.replace(/\r\n?/g, '\n')
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            dispatch(buf.slice(0, i))
            buf = buf.slice(i + 2)
          }
        }
      } catch {
        if (ctrl.signal.aborted) return
      }
      h.close?.()
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 10000)
    }
  })()

  return () => ctrl.abort()
}
