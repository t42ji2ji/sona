import { api, mediaUrl } from '../api.ts'
import { useT } from '../i18n.ts'
import { usePlayer } from '../player.ts'
import { report, useApp } from '../store.ts'
import type { Track } from '../types.ts'
import { Icon } from './Icon.tsx'

export function LikeButton({ track }: { track: Track }) {
  const t = useT()
  return (
    <button className={`icon-btn like ${track.liked ? 'on' : ''}`} title={t('track.like')}
      onClick={(e) => {
        e.stopPropagation()
        api.patchTrack(track.id, { liked: !track.liked })
          .then((nt) => useApp.setState((s) => ({ tracks: s.tracks.map((x) => (x.id === nt.id ? nt : x)) })))
          .catch(report)
      }}>
      <Icon name="heart" size={18} fill={track.liked} />
    </button>
  )
}

export function RevealButton({ track }: { track: Track }) {
  const t = useT()
  const win = useApp((s) => s.system?.platform === 'windows')
  return (
    <button className="icon-btn" title={t(win ? 'track.revealWin' : 'track.reveal')}
      onClick={(e) => { e.stopPropagation(); api.revealTrack(track.id).catch(report) }}>
      <Icon name="folder" size={18} />
    </button>
  )
}

/** 另存 mp3：同源 blob 才會套用檔名，Electron 會跳出存檔視窗 */
export function DownloadButton({ track }: { track: Track }) {
  const t = useT()
  return (
    <button className="icon-btn" title={t('track.download')}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          const res = await fetch(mediaUrl(track.audio_url))
          if (!res.ok) throw new Error(t('track.downloadFailed'))
          const url = URL.createObjectURL(await res.blob())
          const a = document.createElement('a')
          a.href = url
          a.download = `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch (err) { report(err) }
      }}>
      <Icon name="download" size={18} />
    </button>
  )
}

export function DeleteButton({ track, after }: { track: Track; after?: () => void }) {
  const t = useT()
  return (
    <button className="icon-btn" title={t('track.delete')}
      onClick={(e) => {
        e.stopPropagation()
        if (!confirm(t('track.confirmDelete', { t: track.title }))) return
        if (usePlayer.getState().current()?.id === track.id) usePlayer.getState().pause()
        api.deleteTrack(track.id)
          .then(() => { useApp.setState((s) => ({ tracks: s.tracks.filter((x) => x.id !== track.id) })); after?.() })
          .catch(report)
      }}>
      <Icon name="trash" size={18} />
    </button>
  )
}
