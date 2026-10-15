import { fmtDuration, useT } from '../i18n.ts'
import { usePlayer } from '../player.ts'
import { useApp } from '../store.ts'
import { Cover } from './Cover.tsx'
import { Icon } from './Icon.tsx'
import { LikeButton } from './TrackActions.tsx'

export function PlayerBar() {
  const t = useT()
  const p = usePlayer()
  const go = useApp((s) => s.go)
  // 作品資訊以 store 為準（喜歡、改名會即時反映）
  const cur = useApp((s) => s.tracks.find((x) => x.id === p.list[p.index]?.id)) ?? p.list[p.index]
  const dur = p.duration || cur?.duration_s || 0

  return (
    <footer className="player">
      <div className="player-left">
        {cur && (
          <>
            <Cover id={cur.id} hue={cur.hue} className="player-cover" />
            <div className="player-info">
              <button className="player-title" onClick={() => go({ name: 'track', id: cur.id })}>{cur.title}</button>
              <div className="muted small">{t(`kind.${cur.kind}`)}</div>
            </div>
            <LikeButton track={cur} />
          </>
        )}
      </div>
      <div className="player-center">
        <div className="controls">
          <button className="icon-btn" disabled={!cur} onClick={p.prev}><Icon name="prev" size={18} /></button>
          <button className="play-btn" disabled={!cur} onClick={p.toggle} title={t('track.play')}>
            <Icon name={p.playing ? 'pause' : 'play'} size={18} />
          </button>
          <button className="icon-btn" disabled={p.index + 1 >= p.list.length} onClick={p.next}><Icon name="next" size={18} /></button>
        </div>
        <div className="scrub">
          <span>{fmtDuration(p.time)}</span>
          <input type="range" className="range" min={0} max={dur || 1} step={0.1} value={Math.min(p.time, dur)}
            disabled={!cur} onChange={(e) => p.seek(Number(e.target.value))}
            style={{ '--pct': `${dur ? (p.time / dur) * 100 : 0}%` } as React.CSSProperties} />
          <span>{fmtDuration(dur)}</span>
        </div>
      </div>
      <div className="player-right">
        <button className="icon-btn" onClick={() => p.setVolume(p.volume > 0 ? 0 : 0.8)}>
          <Icon name={p.volume > 0 ? 'volume' : 'mute'} size={18} />
        </button>
        <input type="range" className="range volume" min={0} max={1} step={0.01} value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          style={{ '--pct': `${p.volume * 100}%` } as React.CSSProperties} />
      </div>
    </footer>
  )
}
