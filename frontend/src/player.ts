import { create } from 'zustand'
import { mediaUrl } from './api.ts'
import type { Track } from './types.ts'

const audio = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement)


type PlayerState = {
  list: Track[]
  index: number
  playing: boolean
  time: number
  duration: number
  volume: number
  current: () => Track | null
  play: (list: Track[], index: number) => void
  toggle: () => void
  pause: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
}

const savedVolume = (() => { try { return Number(localStorage.getItem('sona.volume') ?? 0.8) } catch { return 0.8 } })()
if (audio) audio.volume = savedVolume

export const usePlayer = create<PlayerState>()((set, get) => ({
  list: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  volume: savedVolume,
  current: () => get().list[get().index] ?? null,
  play: (list, index) => {
    const t = list[index]
    if (!t) return
    const cur = get().current()
    if (cur?.id !== t.id) {
      audio.src = mediaUrl(t.audio_url)
      set({ time: 0, duration: t.duration_s })
    }
    set({ list, index })
    void audio.play()
  },
  toggle: () => {
    if (!audio.src) return
    if (audio.paused) void audio.play()
    else audio.pause()
  },
  pause: () => audio.pause(),
  next: () => {
    const { list, index } = get()
    if (index + 1 < list.length) get().play(list, index + 1)
  },
  prev: () => {
    const { list, index } = get()
    if (audio.currentTime > 3 || index === 0) audio.currentTime = 0
    else get().play(list, index - 1)
  },
  seek: (t) => { audio.currentTime = t },
  setVolume: (v) => {
    audio.volume = v
    set({ volume: v })
    try { localStorage.setItem('sona.volume', String(v)) } catch { /* 無痕或封鎖時不記 */ }
  },
}))

if (audio) {
  audio.addEventListener('play', () => { usePlayer.setState({ playing: true }) })
  audio.addEventListener('pause', () => { usePlayer.setState({ playing: false }) })
  audio.addEventListener('timeupdate', () => usePlayer.setState({ time: audio.currentTime }))
  audio.addEventListener('loadedmetadata', () => usePlayer.setState({ duration: audio.duration }))
  audio.addEventListener('ended', () => usePlayer.getState().next())
}
