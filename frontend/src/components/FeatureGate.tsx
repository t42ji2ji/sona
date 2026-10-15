import type { ReactNode } from 'react'
import { api } from '../api.ts'
import { fmtBytes, useT } from '../i18n.ts'
import { featureComponents, report, useApp } from '../store.ts'
import type { Feature } from '../types.ts'
import { Progress } from './JobCard.tsx'

/** 功能不能用時顯示原因或安裝按鈕；能用時顯示 children */
export function FeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const t = useT()
  const cap = useApp((s) => s.system?.capabilities[feature])
  const comps = featureComponents(Object.values(useApp((s) => s.components)), feature)
  if (cap && !cap.available) return <div className="gate"><span>{cap.reason}</span></div>
  const missing = comps.filter((c) => c.state !== 'ready')
  if (missing.length === 0) return <>{children}</>

  const total = missing.reduce((a, c) => a + c.size_bytes, 0)
  const done = missing.reduce((a, c) => a + c.done_bytes, 0)
  const busy = missing.some((c) => c.state === 'installing' || c.state === 'queued')
  const err = missing.find((c) => c.state === 'error')
  return (
    <div className="gate">
      {busy ? (
        <>
          <span>{t('create.installing', { p: `${fmtBytes(done)} / ${fmtBytes(total)}` })}</span>
          <Progress value={total ? done / total : -1} />
        </>
      ) : (
        <>
          <span>{err?.error ?? `${t('create.needInstall')} · ${fmtBytes(total - done)}`}</span>
          <button className="btn" onClick={() => api.installFeature(feature).catch(report)}>
            {err ? t('comp.retry') : t('create.install')}
          </button>
        </>
      )}
    </div>
  )
}
