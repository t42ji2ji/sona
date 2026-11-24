import { useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from '../api.ts'
import { fmtBytes, fmtDuration, useT } from '../i18n.ts'
import { download, voiceStep } from '../onboard.ts'
import { featureComponents, report, useApp } from '../store.ts'
import type { Feature, Job, Voice } from '../types.ts'
import { Progress } from '../components/JobCard.tsx'
import { DownloadBar } from '../components/DownloadBar.tsx'
import { Icon } from '../components/Icon.tsx'
import { AudioScrub } from '../components/AudioScrub.tsx'
import { toWav } from './VoicePage.tsx'

const MUSIC: Feature[] = ['song', 'instrumental', 'cover', 'stems']
type Path = 'music' | 'voice'
const KEY = 'sona.onboard'

function finish(page: 'create' | 'voice') {
  try { localStorage.setItem('sona.wizardDone', '1'); localStorage.removeItem(KEY) } catch { /* 下次再顯示也無妨 */ }
  useApp.getState().go({ name: page })
}

export function Wizard() {
  const [path, setPath] = useState<Path | null>(() => { try { return localStorage.getItem(KEY) as Path | null } catch { return null } })
  const choose = (p: Path | null) => {
    try { if (p) localStorage.setItem(KEY, p); else localStorage.removeItem(KEY) } catch { /* 只影響重開時回到哪一步 */ }
    setPath(p)
  }
  return (
    <div className="onboard">
      {path === 'music' ? <Music back={() => choose(null)} />
        : path === 'voice' ? <VoiceClone back={() => choose(null)} />
        : <Choose onPick={choose} />}
    </div>
  )
}

function Choose({ onPick }: { onPick: (p: Path) => void }) {
  const t = useT()
  const system = useApp((s) => s.system)!
  const comps = Object.values(useApp((s) => s.components))
  const voiceOk = system.capabilities.voice_local.available
  const musicOk = MUSIC.some((f) => system.capabilities[f].available)
  const voiceDl = download(comps, 'voice_local')
  const musicLeft = new Map(MUSIC.slice(0, 2).flatMap((f) => featureComponents(comps, f)).filter((c) => c.state !== 'ready').map((c) => [c.id, c]))
  const musicSize = [...musicLeft.values()].reduce((a, c) => a + c.size_bytes - c.done_bytes, 0)

  const voicePick = () => {
    if (voiceDl.state === 'missing') api.installFeature('voice_local').catch(report)
    api.putSettings({ voice_backend: 'local' }).then((s) => useApp.setState({ settings: s }), report)
    onPick('voice')
  }
  const size = (n: number, ready: boolean) => ready ? <><Icon name="check" size={14} /> {t('wiz.ready')}</> : t('wiz.download', { s: fmtBytes(n) })

  return (
    <>
      <div className="onboard-body">
        <div className="logo big">sona</div>
        <h1 className="onboard-title">{t('wiz.ask')}</h1>
        <div className="choices">
          <button className="choice" disabled={!musicOk} onClick={() => onPick('music')}>
            <Icon name="music" size={28} />
            <span className="choice-title">{t('wiz.music')}</span>
            <span className="muted">{t('wiz.musicd')}</span>
            <span className="choice-foot muted small">{musicOk ? size(musicSize, musicLeft.size === 0) : system.capabilities.song.reason}</span>
          </button>
          <button className="choice" disabled={!voiceOk} onClick={voicePick}>
            <Icon name="mic" size={28} />
            <span className="choice-title">{t('wiz.voice')}</span>
            <span className="muted">{t('wiz.voiced')}</span>
            <span className="choice-foot muted small">{voiceOk ? size(voiceDl.total - voiceDl.done, voiceDl.state === 'ready') : system.capabilities.voice_local.reason}</span>
          </button>
        </div>
        <div className="muted small">{t('wiz.machine', { acc: system.accelerator.name || system.accelerator.kind.toUpperCase(), ram: Math.round(system.ram_gb) })}</div>
      </div>
      <footer className="onboard-foot">
        <button className="link" onClick={() => finish('create')}>{t('wiz.skip')}</button>
      </footer>
    </>
  )
}

function Back({ onClick }: { onClick: () => void }) {
  const t = useT()
  return <button className="link back" onClick={onClick}><Icon name="back" size={16} /> {t('wiz.back')}</button>
}

function Music({ back }: { back: () => void }) {
  const t = useT()
  const system = useApp((s) => s.system)!
  const comps = Object.values(useApp((s) => s.components))
  const usable = (f: Feature) => system.capabilities[f].available && featureComponents(comps, f).length > 0
  const [picked, setPicked] = useState<Set<Feature>>(() => new Set(MUSIC.filter((f) => f !== 'cover' && f !== 'stems' && usable(f))))
  const isReady = (f: Feature) => download(comps, f).state === 'ready'
  const chosen = [...picked].filter((f) => usable(f) && !isReady(f))
  const d = download(comps, chosen)
  const started = d.state === 'downloading' || d.state === 'error' || d.done > 0

  const install = async () => {
    try { for (const f of chosen) await api.installFeature(f) } catch (e) { report(e) }
  }

  return (
    <>
      <div className="onboard-body">
        <Back onClick={back} />
        <h1 className="onboard-title">{t('wiz.music')}</h1>
        <div className="feat-list">
          {MUSIC.map((f) => {
            const ok = usable(f)
            const ready = ok && isReady(f)
            const d = download(comps, f)
            return (
              <label key={f} className={`feat ${ok ? '' : 'disabled'} ${picked.has(f) && ok ? 'on' : ''}`}>
                <input type="checkbox" disabled={!ok || ready || started} checked={ready || (ok && picked.has(f))}
                  onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n })} />
                <div className="row-main">
                  <div className="row-title">{t(`feat.${f}`)}</div>
                  <div className="muted small">{ok ? [t(`featd.${f}`), system.capabilities[f].speed_hint].filter(Boolean).join(' · ') : system.capabilities[f].reason}</div>
                </div>
                <span className="muted small tabular">{ready ? t('wiz.ready') : ok ? fmtBytes(d.total - d.done) : ''}</span>
              </label>
            )
          })}
        </div>
        {started && <DownloadBar features={chosen} />}
        {started && <div className="muted">{t('wiz.nextMusic')}</div>}
      </div>
      <footer className="onboard-foot">
        <button className="link" onClick={() => finish('create')}>{t('wiz.skip')}</button>
        {!started && chosen.length > 0
          ? <button className="btn big" onClick={install}>{t('wiz.install')} · {fmtBytes(d.total)}</button>
          : <button className="btn big" onClick={() => finish('create')}>{t('wiz.done')}</button>}
      </footer>
    </>
  )
}

function VoiceClone({ back }: { back: () => void }) {
  const t = useT()
  const comps = Object.values(useApp((s) => s.components))
  const dl = download(comps, 'voice_local')
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [rerecord, setRerecord] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useApp((s) => (jobId ? s.jobs[jobId] : undefined))
  const track = useApp((s) => s.tracks.find((x) => x.id === job?.track_id))

  useEffect(() => { api.voices().then(setVoices, report) }, [])
  if (!voices) return null
  const step = voiceStep(voices, job, rerecord)
  const voice = voices[0]


  return (
    <>
      <div className="onboard-body">
        <Back onClick={back} />
        <h1 className="onboard-title">{t('wiz.voice')}</h1>
        <DownloadBar features={['voice_local']} label={t('wiz.downloading')} />
        {step === 'record' && (
          <Recorder onSaved={(v) => { setVoices([v, ...voices]); setRerecord(false); setJobId(null) }} />
        )}
        {step === 'try' && voice && (
          <TryVoice voice={voice} ready={dl.state === 'ready'} job={job} onJob={setJobId} onRerecord={() => setRerecord(true)} />
        )}
        {step === 'listen' && track && (
          <div className="onboard-step">
            <h2 className="step-title">{t('wiz.listen')}</h2>
            <AudioScrub autoPlay src={mediaUrl(track.audio_url)} />
            <div className="row-gap">
              <button className="btn ghost" onClick={() => setJobId(null)}>{t('wiz.tryAgain')}</button>
            </div>
            <div className="muted">{t('wiz.nextVoice')}</div>
          </div>
        )}
      </div>
      <footer className="onboard-foot">
        <button className="link" onClick={() => finish('create')}>{t('wiz.skip')}</button>
        {step !== 'record' && <button className="btn big" onClick={() => finish('voice')}>{t('wiz.done')}</button>}
      </footer>
    </>
  )
}

const MAX_SECONDS = 30

function Recorder({ onSaved }: { onSaved: (v: Voice) => void }) {
  const t = useT()
  const [rec, setRec] = useState<{ stop: () => void; start: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [clip, setClip] = useState<{ blob: Blob; name: string; url: string } | null>(null)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!rec) return
    const id = setInterval(() => {
      const s = (performance.now() - rec.start) / 1000
      setElapsed(s)
      if (s >= MAX_SECONDS) { rec.stop(); setRec(null) }
    }, 200)
    return () => clearInterval(id)
  }, [rec])

  const take = (blob: Blob, name: string) => setClip((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, name, url: URL.createObjectURL(blob) } })

  const start = async () => {
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { setDenied(true); return }
    setDenied(false)
    const mr = new MediaRecorder(stream)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => chunks.push(e.data)
    mr.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop())
      try { take(await toWav(new Blob(chunks, { type: mr.mimeType })), 'recording.wav') } catch (e) { report(e) }
    }
    mr.start()
    setElapsed(0)
    setRec({ stop: () => mr.stop(), start: performance.now() })
  }

  const save = async () => {
    if (!clip || saving) return
    setSaving(true)
    try { onSaved(await api.createVoice(t('wiz.myVoice'), clip.blob, clip.name)) } catch (e) { report(e) } finally { setSaving(false) }
  }

  return (
    <div className="onboard-step">
      <h2 className="step-title">{t('wiz.recTitle')}</h2>
      <p className="script">{t('wiz.script')}</p>
      {rec ? (
        <button className="rec-big on" onClick={() => { rec.stop(); setRec(null) }} title={t('wiz.recStop')}>
          <span className="rec-dot" /> {t('wiz.recStop')} <span className="tabular">{fmtDuration(elapsed)} / {fmtDuration(MAX_SECONDS)}</span>
        </button>
      ) : clip ? (
        <>
          <AudioScrub src={clip.url} />
          <div className="row-gap">
            <button className="btn ghost" onClick={start}>{t('wiz.recAgain')}</button>
            <button className="btn" disabled={saving} onClick={save}>{t('wiz.useIt')}</button>
          </div>
        </>
      ) : (
        <>
          <button className="rec-big" onClick={start}><span className="rec-dot" /> {t('wiz.rec')}</button>
          <div className="muted small">{t('wiz.micNote')}</div>
        </>
      )}
      {denied && <div className="job-error">{t('wiz.micDenied')}</div>}
      {!rec && (
        <button className="link small" onClick={() => input.current?.click()}><Icon name="upload" size={14} /> {t('wiz.orUpload')}</button>
      )}
      <input ref={input} type="file" accept=".mp3,.wav,.flac,.m4a,audio/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) take(f, f.name); e.target.value = '' }} />
    </div>
  )
}

function TryVoice({ voice, ready, job, onJob, onRerecord }: {
  voice: Voice; ready: boolean; job: Job | undefined
  onJob: (id: string) => void; onRerecord: () => void
}) {
  const t = useT()
  const [text, setText] = useState(() => t('wiz.trySample'))
  const live = job?.state === 'queued' || job?.state === 'running'

  const say = async () => {
    try {
      const j = await api.createJob('voice', { voice_id: voice.id, text, backend: 'local', quality: 'fast' })
      useApp.setState((s) => ({ jobs: { ...s.jobs, [j.id]: j } }))
      onJob(j.id)
    } catch (e) { report(e) }
  }

  return (
    <div className="onboard-step">
      <h2 className="step-title">{t(voice.sample ? 'wiz.trySampleTitle' : 'wiz.tryTitle')}</h2>
      <textarea className="input script-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={live} />
      {live ? (
        <div className="wiz-progress">
          <Progress value={job.progress} />
          <div className="job-meta"><span>{job.stage}</span><span className="tabular">{job.progress >= 0 ? `${Math.round(job.progress * 100)}%` : ''}</span></div>
        </div>
      ) : (
        <button className="btn big self-start" disabled={!ready || !text.trim()} onClick={say}>
          <Icon name="play" size={16} /> {ready ? t('wiz.say') : t('wiz.waitModels')}
        </button>
      )}
      {job?.state === 'failed' && <div className="job-error">{job.error}</div>}
      <button className="link small" onClick={onRerecord}>{t(voice.sample ? 'wiz.recOwn' : 'wiz.newRec')}</button>
    </div>
  )
}
