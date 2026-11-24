import { create } from 'zustand'
import { api, ApiError, subscribe } from './api.ts'
import type { Component, EngineEvent, Feature, Job, Settings, System, Track } from './types.ts'
import { fx } from './fx.ts'

export type Page =
  | { name: 'create' }
  | { name: 'library' }
  | { name: 'track'; id: string }
  | { name: 'voice' }
  | { name: 'queue' }
  | { name: 'settings' }
  | { name: 'wizard' }

type State = {
  page: Page
  booted: boolean
  connected: boolean
  system: System | null
  settings: Settings | null
  components: Record<string, Component>
  jobs: Record<string, Job>
  tracks: Track[]
  engine: EngineEvent | null
  toast: { text: string; at: number } | null
  go: (p: Page) => void
  notify: (text: string) => void
  refresh: () => Promise<void>
}

export const useApp = create<State>()((set) => ({
  page: { name: 'create' },
  booted: false,
  connected: false,
  system: null,
  settings: null,
  components: {},
  jobs: {},
  tracks: [],
  engine: null,
  toast: null,
  go: (page) => set({ page }),
  notify: (text) => set({ toast: { text, at: Date.now() } }),
  refresh: async () => {
    const [system, settings, components, jobs, tracks] = await Promise.all([
      api.system(), api.settings(), api.components(), api.jobs(), api.tracks(),
    ])
    set({
      system, settings, tracks,
      components: Object.fromEntries(components.map((c) => [c.id, c])),
      jobs: Object.fromEntries(jobs.map((j) => [j.id, j])),
    })
  },
}))

/** 把例外轉成畫面上的提示；後端給的 message 已是可顯示的中文 */
export function report(e: unknown) {
  useApp.getState().notify(e instanceof ApiError ? e.message : String(e))
}

export async function boot() {
  const s = useApp.getState()
  for (;;) {
    try {
      await s.refresh()
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  const wizardDone = (() => { try { return localStorage.getItem('sona.wizardDone') === '1' } catch { return false } })()
  const comps = Object.values(useApp.getState().components)
  const anyReady = (['song', 'instrumental', 'cover', 'stems', 'voice_local', 'voice_hq'] as Feature[]).some((f) => featureReady(comps, f))
  useApp.setState({ booted: true, page: wizardDone || anyReady ? { name: 'create' } : { name: 'wizard' } })

  subscribe({
    open: () => {
      useApp.setState({ connected: true })
      useApp.getState().refresh().catch(() => {})
    },
    close: () => useApp.setState({ connected: false }),
    job: (j) => {
      const prev = useApp.getState().jobs[j.id]
      useApp.setState((s) => ({ jobs: { ...s.jobs, [j.id]: j } }))
      if (j.state === 'done' && prev && prev.state !== 'done') fx.bloom(useApp.getState().tracks.find((t) => t.id === j.track_id)?.hue)
    },
    component: (c) => useApp.setState((s) => ({ components: { ...s.components, [c.id]: c } })),
    track: ({ action, track }) =>
      useApp.setState((s) => {
        const rest = s.tracks.filter((t) => t.id !== track.id)
        if (action === 'deleted') return { tracks: rest }
        if (action === 'created' || rest.length === s.tracks.length) return { tracks: [track, ...rest] }
        return { tracks: s.tracks.map((t) => (t.id === track.id ? track : t)) }
      }),
    engine: (engine) => useApp.setState({ engine }),
  })
}

export function featureComponents(comps: Component[], f: Feature) {
  return comps.filter((c) => c.needed_for.includes(f))
}

export function featureReady(comps: Component[], f: Feature) {
  const list = featureComponents(comps, f)
  return list.length > 0 && list.every((c) => c.state === 'ready')
}

export function sortedJobs(jobs: Record<string, Job>) {
  return Object.values(jobs).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
