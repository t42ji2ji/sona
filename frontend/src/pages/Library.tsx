import { useState } from 'react'
import { fmtDuration, useT } from '../i18n.ts'
import { useApp } from '../store.ts'
import { Cover } from '../components/Cover.tsx'
import { Icon } from '../components/Icon.tsx'
import { DeleteButton, LikeButton, RevealButton } from '../components/TrackActions.tsx'
import { PlayOverlay, TrackRow } from '../components/TrackRow.tsx'

export function Library() {
  const t = useT()
  const tracks = useApp((s) => s.tracks)
  const go = useApp((s) => s.go)
  const [q, setQ] = useState('')
  const [liked, setLiked] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('sona.view') as 'grid' | 'list') || 'grid')

  const needle = q.trim().toLowerCase()
  const list = tracks.filter((tr) =>
    (!liked || tr.liked) &&
    (!needle || [tr.title, tr.style, tr.lyrics, tr.text].some((s) => s?.toLowerCase().includes(needle))))
  const setV = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('sona.view', v) } catch { /* 不記也行 */ } }

  return (
    <div className="library scroll">
      <header className="lib-head">
        <h1 className="page-title">{t('nav.library')}</h1>
        <div className="lib-tools">
          <div className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lib.search')} />
          </div>
          <div className="segmented small">
            <button className={!liked ? 'on' : ''} onClick={() => setLiked(false)}>{t('lib.all')}</button>
            <button className={liked ? 'on' : ''} onClick={() => setLiked(true)}>{t('lib.liked')}</button>
          </div>
          <div className="segmented small icons">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setV('grid')}><Icon name="grid" size={16} /></button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setV('list')}><Icon name="list" size={16} /></button>
          </div>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="empty muted">{tracks.length ? t('lib.none') : t('lib.empty')}</div>
      ) : view === 'grid' ? (
        <div className="grid">
          {list.map((tr, i) => (
            <div key={tr.id} className="card" onClick={() => go({ name: 'track', id: tr.id })}>
              <div className="card-cover">
                <Cover id={tr.id} hue={tr.hue} />
                <PlayOverlay list={list} index={i} />
                <span className="card-dur">{fmtDuration(tr.duration_s)}</span>
              </div>
              <div className="card-title ellipsis">{tr.title}</div>
              <div className="card-foot">
                <span className="muted small ellipsis">{[t(`kind.${tr.kind}`), tr.style].filter(Boolean).join(' · ')}</span>
                <div className="card-actions">
                  <LikeButton track={tr} />
                  <RevealButton track={tr} />
                  <DeleteButton track={tr} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rows">
          {list.map((tr, i) => <TrackRow key={tr.id} list={list} index={i} />)}
        </div>
      )}
    </div>
  )
}
