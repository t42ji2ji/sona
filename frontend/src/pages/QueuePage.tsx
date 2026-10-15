import { useT } from '../i18n.ts'
import { sortedJobs, useApp } from '../store.ts'
import { JobCard } from '../components/JobCard.tsx'

export function QueuePage() {
  const t = useT()
  const jobs = sortedJobs(useApp((s) => s.jobs))
  const active = jobs.filter((j) => j.state === 'running' || j.state === 'queued')
    .sort((a, b) => (a.state === 'running' ? -1 : b.state === 'running' ? 1 : (a.queue_position ?? 0) - (b.queue_position ?? 0)))
  const past = jobs.filter((j) => j.state !== 'running' && j.state !== 'queued')

  return (
    <div className="queue-page scroll">
      <h1 className="page-title">{t('nav.queue')}</h1>
      <h2 className="section-title">{t('queue.active')}</h2>
      {active.length ? <div className="job-list">{active.map((j) => <JobCard key={j.id} job={j} />)}</div>
        : <div className="muted">{t('queue.empty')}</div>}
      {past.length > 0 && (
        <>
          <h2 className="section-title">{t('queue.history')}</h2>
          <div className="job-list">{past.map((j) => <JobCard key={j.id} job={j} />)}</div>
        </>
      )}
    </div>
  )
}
