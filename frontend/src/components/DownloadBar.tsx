import { api } from '../api.ts'
import { fmtBytes, useT } from '../i18n.ts'
import { download } from '../onboard.ts'
import { report, useApp } from '../store.ts'
import type { Feature } from '../types.ts'
import { Icon } from './Icon.tsx'
import { Progress } from './JobCard.tsx'

/** 功能缺的模型：下載進度＋暫停／繼續／重試。暫停會留著下載到一半的檔案，繼續時接著下載 */
export function DownloadBar({ features, label }: { features: Feature[]; label?: string }) {
  const t = useT()
  const d = download(Object.values(useApp((s) => s.components)), features)
  if (d.state === 'ready') return null
  const paused = d.state === 'missing' && d.done > 0
  const start = () => { for (const f of features) api.installFeature(f).catch(report) }
  const pause = () => { for (const c of d.left) if (c.state === 'installing' || c.state === 'queued') api.cancelComponent(c.id).catch(report) }
  const discard = () => {
    if (!confirm(t('dl.confirmDiscard', { s: fmtBytes(d.done) }))) return
    for (const c of d.left) if (c.done_bytes > 0) api.deleteComponent(c.id).catch(report)
  }
  const text = d.state === 'downloading' ? label ?? t('dl.downloading')
    : d.state === 'error' ? t('wiz.dlFailed')
    : paused ? t('dl.paused') : t('create.needInstall')

  return (
    <div className="dl">
      <Progress value={d.state === 'downloading' && !d.total ? -1 : d.total ? d.done / d.total : 0} />
      <div className="dl-row">
        <span>{text}</span>
        <span className="muted small tabular">{fmtBytes(d.done)} / {fmtBytes(d.total)}</span>
        {d.state === 'downloading' ? (
          <button className="btn ghost small" onClick={pause} title={t('dl.pauseTip')}><Icon name="pause" size={14} /> {t('dl.pause')}</button>
        ) : d.state === 'error' ? (
          <button className="btn small" onClick={start}>{t('comp.retry')}</button>
        ) : (
          <button className="btn small" onClick={start}>
            {paused ? <><Icon name="play" size={14} /> {t('dl.resume')}</> : t('wiz.download', { s: fmtBytes(d.total - d.done) })}
          </button>
        )}
      </div>
      {d.errors.map((e) => <div key={e} className="job-error">{e}</div>)}
      {(paused || d.state === 'error') && d.done > 0 && (
        <button className="link small" onClick={discard}>{t('dl.discard')}</button>
      )}
    </div>
  )
}
