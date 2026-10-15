import { useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from '../api.ts'
import { fmtDuration, useT } from '../i18n.ts'
import { usePlayer } from '../player.ts'
import { featureReady, report, useApp } from '../store.ts'
import type { StemName, Track } from '../types.ts'
import { Cover } from '../components/Cover.tsx'
import { Icon } from '../components/Icon.tsx'
import { DeleteButton, LikeButton, RevealButton } from '../components/TrackActions.tsx'

export function TrackPage({ id }: { id: string }) {
  const t = useT()
  const track = useApp((s) => s.tracks.find((x) => x.id === id))
  const tracks = useApp((s) => s.tracks)
  const go = useApp((s) => s.go)
  const stemsReady = featureReady(Object.values(useApp((s) => s.components)), 'stems')
  const playing = usePlayer((s) => s.playing && s.list[s.index]?.id === id)

  if (!track) return null
  const index = tracks.indexOf(track)
  const date = new Date(track.created_at).toLocaleDateString()

  return (
    <div className="track-page scroll">
      <header className="hero" style={{ '--h': track.hue } as React.CSSProperties}>
        <Cover id={track.id} hue={track.hue} className="hero-cover" />
        <div className="hero-info">
          <span className="eyebrow">{t(`kind.${track.kind}`)}</span>
          <h1 className="hero-title">{track.title}</h1>
          <div className="muted">{date} · {fmtDuration(track.duration_s)}</div>
        </div>
      </header>

      <div className="track-actions">
        <button className="play-big" onClick={() => playing ? usePlayer.getState().pause() : usePlayer.getState().play(tracks, index)}>
          <Icon name={playing ? 'pause' : 'play'} size={24} />
        </button>
        <LikeButton track={track} />
        <RevealButton track={track} />
        <DeleteButton track={track} after={() => go({ name: 'library' })} />
        {!track.stems?.length && track.kind !== 'voice' && stemsReady && (
          <button className="btn ghost" onClick={() => api.createJob('stems', { track_id: track.id, title: track.title })
            .then((j) => useApp.setState((s) => ({ jobs: { ...s.jobs, [j.id]: j } })), report)}>
            <Icon name="stems" size={16} /> {t('track.makeStems')}
          </button>
        )}
      </div>

      {track.stems?.length ? <Mixer track={track} /> : null}

      <div className="track-body">
        {track.style && (
          <section>
            <h3 className="section-title">{t('track.style')}</h3>
            <div className="chips">{track.style.split(',').map((s) => s.trim()).filter(Boolean).map((s) => <span key={s} className="chip static">{s}</span>)}</div>
          </section>
        )}
        {track.lyrics && (
          <section>
            <h3 className="section-title">{t('track.lyrics')}</h3>
            <pre className="lyrics-view">{track.lyrics}</pre>
          </section>
        )}
        {track.text && (
          <section>
            <h3 className="section-title">{t('track.text')}</h3>
            <pre className="lyrics-view">{track.text}</pre>
          </section>
        )}
      </div>
    </div>
  )
}

function Mixer({ track }: { track: Track }) {
  const t = useT()
  const stems = track.stems!
  const els = useRef<Record<string, HTMLAudioElement>>({})
  const [muted, setMuted] = useState<Set<StemName>>(new Set())
  const [solo, setSolo] = useState<Set<StemName>>(new Set())
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(track.duration_s)

  const all = () => Object.values(els.current)
  useEffect(() => () => all().forEach((a) => a.pause()), [])
  useEffect(() => {
    for (const s of stems) {
      const a = els.current[s.name]
      if (a) a.muted = muted.has(s.name) || (solo.size > 0 && !solo.has(s.name))
    }
  }, [muted, solo, stems])

  const toggle = async () => {
    if (playing) {
      all().forEach((a) => a.pause())
      setPlaying(false)
      return
    }
    usePlayer.getState().pause()
    const t0 = all()[0]?.currentTime ?? 0
    all().forEach((a) => { a.currentTime = t0 })
    await Promise.all(all().map((a) => a.play())).catch(report)
    setPlaying(true)
  }
  const seek = (v: number) => { all().forEach((a) => { a.currentTime = v }); setTime(v) }
  const flip = (set: Set<StemName>, name: StemName) => { const n = new Set(set); if (n.has(name)) n.delete(name); else n.add(name); return n }

  return (
    <section className="mixer panel-inner">
      <div className="mixer-head">
        <button className="play-btn" onClick={toggle}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
        <h3 className="section-title">{t('track.stems')}</h3>
        <div className="scrub">
          <span>{fmtDuration(time)}</span>
          <input type="range" className="range" min={0} max={dur || 1} step={0.1} value={time} onChange={(e) => seek(Number(e.target.value))}
            style={{ '--pct': `${dur ? (time / dur) * 100 : 0}%` } as React.CSSProperties} />
          <span>{fmtDuration(dur)}</span>
        </div>
      </div>
      {stems.map((s, i) => {
        const silent = muted.has(s.name) || (solo.size > 0 && !solo.has(s.name))
        return (
          <div key={s.name} className={`stem ${silent ? 'silent' : ''}`} style={{ '--h': track.hue + i * 40 } as React.CSSProperties}>
            <audio ref={(a) => { if (a) els.current[s.name] = a; else delete els.current[s.name] }} src={mediaUrl(s.url)} preload="auto"
              onTimeUpdate={i === 0 ? (e) => setTime(e.currentTarget.currentTime) : undefined}
              onLoadedMetadata={i === 0 ? (e) => setDur(e.currentTarget.duration) : undefined}
              onEnded={i === 0 ? () => setPlaying(false) : undefined} />
            <span className="stem-name">{t(`stem.${s.name}`)}</span>
            <div className="stem-bar"><div style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} /></div>
            <button className={`tog ${muted.has(s.name) ? 'on' : ''}`} onClick={() => setMuted(flip(muted, s.name))}>M</button>
            <button className={`tog solo ${solo.has(s.name) ? 'on' : ''}`} onClick={() => setSolo(flip(solo, s.name))}>S</button>
          </div>
        )
      })}
    </section>
  )
}
