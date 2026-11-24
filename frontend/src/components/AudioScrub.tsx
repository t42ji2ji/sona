import { useRef, useState } from 'react'
import { fmtDuration, useT } from '../i18n.ts'
import { Icon } from './Icon.tsx'

/** 取代原生 <audio controls>：窄的時候原生的會把進度條藏起來 */
export function AudioScrub({ src, autoPlay }: { src: string; autoPlay?: boolean }) {
  const t = useT()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const len = (e: React.SyntheticEvent<HTMLAudioElement>) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d) }
  return (
    <div className="audio-scrub">
      <audio ref={audio} src={src} autoPlay={autoPlay} onLoadedMetadata={len} onDurationChange={len}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
      <button className="icon-btn" title={t('track.play')}
        onClick={() => { if (playing) audio.current?.pause(); else void audio.current?.play() }}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="scrub">
        <span>{fmtDuration(time)}</span>
        <input type="range" className="range" min={0} max={dur || 1} step={0.05} value={Math.min(time, dur)}
          onChange={(e) => { const v = Number(e.target.value); setTime(v); if (audio.current) audio.current.currentTime = v }}
          style={{ '--pct': `${dur ? (time / dur) * 100 : 0}%` } as React.CSSProperties} />
        <span>{fmtDuration(dur)}</span>
      </div>
    </div>
  )
}
