import type { ReactNode } from 'react'
import { featureComponents, useApp } from '../store.ts'
import type { Feature } from '../types.ts'
import { DownloadBar } from './DownloadBar.tsx'

/** 功能不能用時顯示原因或下載列；能用時顯示 children */
export function FeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const cap = useApp((s) => s.system?.capabilities[feature])
  const comps = featureComponents(Object.values(useApp((s) => s.components)), feature)
  if (cap && !cap.available) return <div className="gate"><span>{cap.reason}</span></div>
  if (comps.every((c) => c.state === 'ready')) return <>{children}</>
  return <div className="gate"><DownloadBar features={[feature]} /></div>
}
