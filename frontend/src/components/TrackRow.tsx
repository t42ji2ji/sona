import { fmtDuration, useT } from '../i18n.ts'
import { usePlayer } from '../player.ts'
import { useApp } from '../store.ts'
import type { Track } from '../types.ts'
import { Cover } from './Cover.tsx'
import { Icon } from './Icon.tsx'
import { DeleteButton, LikeButton, RevealButton } from './TrackActions.tsx'

export function PlayOverlay({ list, index }: { list: Track[]; index: number }) {
  const playing = usePlayer((s) => s.playing && s.list[s.index]?.id === list[index].id)
  return (
    <button className={`play-overlay ${playing ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (playing) usePlayer.getState().pause()
        else usePlayer.getState().play(list, index)
      }}>
      <Icon name={playing ? 'pause' : 'play'} size={18} />
    </button>
  )
}

export function TrackRow({ list, index, actions = true }: { list: Track[]; index: number; actions?: boolean }) {
  const t = useT()
  const go = useApp((s) => s.go)
  const track = list[index]
  const current = usePlayer((s) => s.list[s.index]?.id === track.id)
  return (
    <div className={`track-row ${current ? 'current' : ''}`} onClick={() => go({ name: 'track', id: track.id })}>
      <div className="row-cover">
        <Cover id={track.id} hue={track.hue} />
        <PlayOverlay list={list} index={index} />
      </div>
      <div className="row-main">
        <div className="row-title">{track.title}</div>
        <div className="muted small ellipsis">{[t(`kind.${track.kind}`), track.style ?? track.text].filter(Boolean).join(' · ')}</div>
      </div>
      <LikeButton track={track} />
      {actions && <RevealButton track={track} />}
      {actions && <DeleteButton track={track} />}
      <span className="muted small tabular">{fmtDuration(track.duration_s)}</span>
    </div>
  )
}
