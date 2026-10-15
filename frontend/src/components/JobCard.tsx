import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { fmtDuration, fmtEta, useT } from '../i18n.ts'
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
  const running = job.state === 'running'
  const [nowMs, setNowMs] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])
  // 後端只在有新進度時才更新 ETA；兩次更新之間自己每秒倒數。
  const etaAt = useRef({ eta: job.eta_seconds, at: Date.now() })
  if (etaAt.current.eta !== job.eta_seconds) etaAt.current = { eta: job.eta_seconds, at: Date.now() }
  const etaLeft = job.eta_seconds != null ? job.eta_seconds - (nowMs - etaAt.current.at) / 1000 : null
  const elapsed = job.started_at ? (nowMs - Date.parse(job.started_at)) / 1000 : null
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
            <span>{[pct, etaLeft != null && etaLeft > 0 ? t('eta', { t: fmtEta(etaLeft) }) : '',
              elapsed != null ? t('elapsed', { t: fmtDuration(elapsed) }) : ''].filter(Boolean).join(' · ')}</span>
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
