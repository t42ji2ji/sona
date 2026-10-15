import { useT } from '../i18n.ts'
import type { Key } from '../i18n.ts'
import { sortedJobs, useApp } from '../store.ts'
import type { Page } from '../store.ts'
import { Icon } from './Icon.tsx'
import type { IconName } from './Icon.tsx'
import { JobCard } from './JobCard.tsx'

const nav: [Page['name'], IconName, Key][] = [
  ['create', 'create', 'nav.create'],
  ['library', 'library', 'nav.library'],
  ['voice', 'voice', 'nav.voice'],
  ['queue', 'queue', 'nav.queue'],
  ['settings', 'gear', 'nav.settings'],
]

export function Sidebar() {
  const t = useT()
  const page = useApp((s) => s.page)
  const go = useApp((s) => s.go)
  const jobs = sortedJobs(useApp((s) => s.jobs))
  const running = jobs.filter((j) => j.state === 'running')
  const queued = jobs.filter((j) => j.state === 'queued')
  const current = page.name === 'track' ? 'library' : page.name

  return (
    <aside className="sidebar">
      <div className="panel nav">
        <div className="logo">sona</div>
        {nav.map(([name, icon, label]) => (
          <button key={name} className={`nav-item ${current === name ? 'active' : ''}`}
            onClick={() => go({ name } as Page)}>
            <Icon name={icon} />
            <span>{t(label)}</span>
            {name === 'queue' && running.length + queued.length > 0 && <span className="badge">{running.length + queued.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel side-queue">
        {running.length === 0 && queued.length === 0 ? (
          <div className="muted small">{t('queue.empty')}</div>
        ) : (
          <>
            {running.map((j) => <JobCard key={j.id} job={j} compact />)}
            {queued.slice(0, running.length ? 2 : 3).map((j) => <JobCard key={j.id} job={j} compact />)}
            {queued.length > (running.length ? 2 : 3) && (
              <button className="link small" onClick={() => go({ name: 'queue' })}>
                {t('queue.more', { n: queued.length - (running.length ? 2 : 3) })}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
