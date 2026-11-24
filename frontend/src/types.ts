// 完全照 CONTRACT.md

export type Cap = { available: boolean; reason?: string; speed_hint?: string }
export type Feature = 'song' | 'instrumental' | 'cover' | 'stems' | 'voice_local' | 'voice_hq'

export type System = {
  platform: 'mac' | 'windows' | 'linux'
  arch: string
  ram_gb: number
  accelerator: { kind: 'mps' | 'cuda' | 'cpu'; name: string; vram_gb: number | null }
  capabilities: Record<Feature | 'voice_api', Cap>
  music_dir: string
  ai_tools: { claude: boolean; codex: boolean }
}

export type Component = {
  id: string
  kind: 'env' | 'model'
  name: string
  description: string
  size_bytes: number
  done_bytes: number
  state: 'missing' | 'queued' | 'installing' | 'ready' | 'error' | 'unsupported'
  error?: string
  needed_for: Feature[]
}

export type JobType = 'song' | 'instrumental' | 'cover' | 'stems' | 'voice'

export type Quality = 'fast' | 'high'

export type JobParams = {
  song: { title?: string; style: string; lyrics: string; mode?: 'full' | 'melody' | 'off'; seed?: number; quality?: Quality }
  instrumental: { title?: string; style: string; seed?: number; quality?: Quality }
  cover: { title?: string; upload_id: string; style: string; lyrics?: string; instrumental?: boolean; seed?: number; quality?: Quality }
  stems: { title?: string; upload_id?: string; track_id?: string; model?: 'htdemucs' | 'htdemucs_ft' }
  voice: { voice_id: string; text: string; backend?: 'local' | 'api'; quality?: Quality }
}

export type Job = {
  id: string
  type: JobType
  params: object
  title: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  stage: string
  progress: number
  eta_seconds: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  error?: string
  track_id?: string
  queue_position?: number
}

export type StemName = 'vocals' | 'drums' | 'bass' | 'other'

export type Track = {
  id: string
  title: string
  kind: JobType
  created_at: string
  duration_s: number
  style?: string
  lyrics?: string
  text?: string
  params: object
  liked: boolean
  hue: number
  audio_url: string
  stems?: { name: StemName; url: string }[]
  score_abc?: string
  folder: string
}

export type Upload = { upload_id: string; filename: string; duration_s: number }

export type Voice = { id: string; name: string; transcript: string; duration_s: number; created_at: string; sample_url: string }

export type Settings = {
  music_dir: string
  voice_backend: 'local' | 'api'
  fish_api_key_set: boolean
  language: 'zh-TW' | 'en'
}
export type SettingsPatch = Partial<Omit<Settings, 'fish_api_key_set'>> & { fish_api_key?: string }

export type EngineEvent = { engine: 'yue2' | 'demucs' | 'voice-mlx' | null; state: 'loading' | 'ready' | 'unloading' | 'idle' }
export type TrackEvent = { action: 'created' | 'updated' | 'deleted'; track: Track }

export type Events = {
  job: Job
  component: Component
  track: TrackEvent
  engine: EngineEvent
}
