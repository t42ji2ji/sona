import { api } from '../api.ts'
import { fmtEta, useT } from '../i18n.ts'
import { report, useApp } from '../store.ts'
import type { Job } from '../types.ts'
import { Icon } from './Icon.tsx'

export function Progress({ value }: { value: number }) {
  return (
    <div className={`progress ${value < 0 ? 'indeterminate' : ''}`}>
      <div style={{ width: value < 0 ? undefined : `${Math.max(2, value * 100)}%` }} />
    </div>
  )
}

export function JobCard({ job, compact }: { job: Job; compact?: boolean }) {
  const t = useT()
  const go = useApp((s) => s.go)
  const live = job.state === 'running' || job.state === 'queued'
  const pct = job.progress >= 0 ? `${Math.round(job.progress * 100)}%` : ''
  return (
    <div className={`job job-${job.state} ${compact ? 'compact' : ''}`}>
      <div className="job-head">
        <span className="job-kind">{t(`kind.${job.type}`)}</span>
        <span className="job-title">{job.title}</span>
        {live ? (
          <button className="icon-btn" title={t('queue.cancel')} onClick={() => api.cancelJob(job.id).catch(report)}>
            <Icon name="x" size={16} />
          </button>
        ) : !compact ? (
          <button className="icon-btn" title={t('queue.remove')} onClick={() => api.deleteJob(job.id)
            .then(() => useApp.setState((s) => { const { [job.id]: _, ...rest } = s.jobs; return { jobs: rest } }))
            .catch(report)}>
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </div>
      {job.state === 'running' && (
        <>
          <Progress value={job.progress} />
          <div className="job-meta">
            <span>{job.stage}</span>
            <span>{[pct, job.eta_seconds != null ? t('eta', { t: fmtEta(job.eta_seconds) }) : ''].filter(Boolean).join(' · ')}</span>
          </div>
        </>
      )}
      {job.state === 'queued' && <div className="job-meta"><span>{t('state.queued')}{job.queue_position ? ` #${job.queue_position}` : ''}</span></div>}
      {job.state === 'failed' && <div className="job-error">{job.error}</div>}
      {!compact && (job.state === 'done' || job.state === 'cancelled') && (
        <div className="job-meta">
          <span>{t(`state.${job.state}`)}</span>
          {job.track_id && <button className="link" onClick={() => go({ name: 'track', id: job.track_id! })}>{t('queue.open')}</button>}
        </div>
      )}
    </div>
  )
}
