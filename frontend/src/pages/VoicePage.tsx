import { useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from '../api.ts'
import { fmtDuration, useT } from '../i18n.ts'
import { report, useApp } from '../store.ts'
import type { Quality, Voice } from '../types.ts'
import { FeatureGate } from '../components/FeatureGate.tsx'
import { Icon } from '../components/Icon.tsx'
import { useEnter } from '../ime.ts'

export function VoicePage() {
  const t = useT()
  const system = useApp((s) => s.system)
  const settings = useApp((s) => s.settings)
  const go = useApp((s) => s.go)
  const [voices, setVoices] = useState<Voice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [quality, setQuality] = useState<Quality>('fast')
  const [polishing, setPolishing] = useState(false)
  const [proposal, setProposal] = useState<{ from: string; to: string } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { api.voices().then((v) => { setVoices(v); setSelected((s) => s ?? v[0]?.id ?? null) }, report) }, [])

  const localOk = !!system?.capabilities.voice_local.available
  const hqOk = !!system?.capabilities.voice_hq?.available
  const aiTool = system?.ai_tools.claude ? 'Claude Code' : system?.ai_tools.codex ? 'Codex' : null
  const backend = localOk ? settings?.voice_backend ?? 'api' : 'api'
  const setBackend = (b: 'local' | 'api') =>
    api.putSettings({ voice_backend: b }).then((s) => useApp.setState({ settings: s }), report)

  const generate = async () => {
    if (!selected || !text.trim() || sending) return
    setSending(true)
    try {
      const job = await api.createJob('voice', { voice_id: selected, text, backend, quality: backend === 'local' ? quality : undefined })
      useApp.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
    } catch (e) { report(e) } finally { setSending(false) }
  }

  const polish = async () => {
    if (!text.trim() || polishing) return
    setPolishing(true)
    try {
      const from = text
      setProposal({ from, to: (await api.polish(from)).text })
    } catch (e) { report(e) } finally { setPolishing(false) }
  }

  /** 走 insertText 讓 ⌘Z 能還原 */
  const apply = () => {
    const el = textarea.current
    if (!proposal || !el) return
    el.focus()
    el.select()
    if (!document.execCommand('insertText', false, proposal.to)) setText(proposal.to)
    setProposal(null)
  }

  const form = (
    <>
      <label className="field">
        <span>{t('voice.say')}</span>
        <textarea ref={textarea} className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('voice.sayPh')} />
      </label>
      <div className="polish-row">
        <button className="btn ghost small" disabled={!text.trim() || polishing || !aiTool} onClick={polish}
          title={aiTool ? t('voice.polishTip', { t: aiTool }) : t('voice.noAi')}>
          <Icon name="create" size={14} /> {polishing ? t('voice.polishing') : t('voice.polish')}
        </button>
      </div>
      {proposal && (
        <div className="proposal">
          <del>{proposal.from}</del>
          <p>{proposal.to}</p>
          <div className="proposal-actions">
            <button className="btn small" onClick={apply}>{t('voice.apply')}</button>
            <button className="btn ghost small" onClick={() => setProposal(null)}>{t('voice.ignore')}</button>
          </div>
        </div>
      )}
      <button className="cta" disabled={!selected || !text.trim() || sending} onClick={generate}>
        {voices.length ? t('voice.go') : t('voice.none')}
      </button>
    </>
  )

  return (
    <div className="voice-page scroll">
      <h1 className="page-title">{t('nav.voice')}</h1>
      <div className="voice-grid">
        <section className="voice-say">
          {localOk && (
            <div className="field">
              <span>{t('voice.backend')}</span>
              <div className="segmented small">
                <button className={backend === 'local' ? 'on' : ''} onClick={() => setBackend('local')}>{t('voice.local')}</button>
                <button className={backend === 'api' ? 'on' : ''} onClick={() => setBackend('api')}>{t('voice.api')}</button>
              </div>
            </div>
          )}
          <div className="voice-list">
            {voices.map((v) => (
              <VoiceItem key={v.id} voice={v} on={selected === v.id} onSelect={() => setSelected(v.id)}
                onDelete={() => {
                  if (!confirm(t('voice.confirmDelete', { t: v.name }))) return
                  api.deleteVoice(v.id).then(() => {
                    setVoices((list) => list.filter((x) => x.id !== v.id))
                    if (selected === v.id) setSelected(null)
                  }, report)
                }} />
            ))}
          </div>
          {backend === 'local' && hqOk && (
            <div className="field">
              <span>{t('voice.quality')}</span>
              <div className="segmented small">
                <button className={quality === 'fast' ? 'on' : ''} onClick={() => setQuality('fast')}>{t('voice.fast')}</button>
                <button className={quality === 'high' ? 'on' : ''} onClick={() => setQuality('high')} title={t('voice.highTip')}>{t('voice.high')}</button>
              </div>
            </div>
          )}
          {backend === 'local' ? (
            <FeatureGate feature={quality === 'high' && hqOk ? 'voice_hq' : 'voice_local'}>{form}</FeatureGate>
          ) : settings?.fish_api_key_set ? form : (
            <div className="gate">
              <span>{t('voice.needKey')}</span>
              <button className="btn" onClick={() => go({ name: 'settings' })}>{t('nav.settings')}</button>
            </div>
          )}
        </section>
        <NewVoice onCreated={(v) => { setVoices((list) => [v, ...list]); setSelected(v.id) }} />
      </div>
    </div>
  )
}

function VoiceItem({ voice, on, onSelect, onDelete }: { voice: Voice; on: boolean; onSelect: () => void; onDelete: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const dur = voice.duration_s
  return (
    <div className={`voice-item ${on ? 'on' : ''}`} onClick={onSelect}>
      <audio ref={audio} src={mediaUrl(voice.sample_url)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); if (playing) audio.current?.pause(); else void audio.current?.play() }}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="row-main">
        <div className="row-title">{voice.name}</div>
        <div className="muted small ellipsis">{voice.transcript}</div>
        {(on || playing) && (
          <input type="range" className="range voice-scrub" min={0} max={dur || 1} step={0.1} value={Math.min(time, dur)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { const v = Number(e.target.value); setTime(v); if (audio.current) audio.current.currentTime = v }}
            style={{ '--pct': `${dur ? (time / dur) * 100 : 0}%` } as React.CSSProperties} />
        )}
      </div>
      <span className="muted small tabular">{time > 0 ? `${fmtDuration(time)} / ` : ''}{fmtDuration(dur)}</span>
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete() }}><Icon name="trash" size={16} /></button>
    </div>
  )
}

function NewVoice({ onCreated }: { onCreated: (v: Voice) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [file, setFile] = useState<{ blob: Blob; name: string; url: string } | null>(null)
  const [rec, setRec] = useState<{ stop: () => void; start: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!rec) return
    const id = setInterval(() => setElapsed((performance.now() - rec.start) / 1000), 200)
    return () => clearInterval(id)
  }, [rec])

  const choose = (blob: Blob, n: string) => setFile((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, name: n, url: URL.createObjectURL(blob) } })

  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop())
        choose(await toWav(new Blob(chunks, { type: mr.mimeType })), 'recording.wav')
      }
      mr.start()
      setElapsed(0)
      setRec({ stop: () => mr.stop(), start: performance.now() })
    } catch (e) { report(e) }
  }

  const save = async () => {
    if (!file || !name.trim() || saving) return
    setSaving(true)
    try {
      onCreated(await api.createVoice(name.trim(), file.blob, file.name))
      setName(''); setFile(null)
    } catch (e) { report(e) } finally { setSaving(false) }
  }
  const nameEnter = useEnter(save)

  return (
    <section className="new-voice panel-inner">
      <h2 className="section-title">{t('voice.new')}</h2>
      <div className="rec-row">
        {rec ? (
          <button className="rec on" onClick={() => { rec.stop(); setRec(null) }}>
            <span className="rec-dot" /> {t('voice.stop')} <span className="tabular">{fmtDuration(elapsed)}</span>
          </button>
        ) : (
          <button className="rec" onClick={record}><span className="rec-dot" /> {t('voice.record')}</button>
        )}
        <button className="rec" onClick={() => input.current?.click()}><Icon name="upload" size={16} /> {t('voice.upload')}</button>
        <input ref={input} type="file" accept=".mp3,.wav,.flac,.m4a,audio/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f, f.name); e.target.value = '' }} />
      </div>
      <div className="muted small">{t('voice.hint')}</div>
      {file && <audio className="sample" controls src={file.url} />}
      <label className="field">
        <span>{t('voice.name')}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} {...nameEnter} />
      </label>
      <button className="btn" disabled={!file || !name.trim() || saving} onClick={save}>{t('voice.save')}</button>
    </section>
  )
}

/** MediaRecorder 給的是 webm/opus，後端只收 mp3/wav/flac/m4a，轉成 16-bit 單聲道 WAV */
export async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
  void ctx.close()
  const data = buf.getChannelData(0)
  const out = new DataView(new ArrayBuffer(44 + data.length * 2))
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); out.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVEfmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true)
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true)
  return new Blob([out], { type: 'audio/wav' })
}
