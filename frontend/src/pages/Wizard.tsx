import { useState } from 'react'
import { api } from '../api.ts'
import { fmtBytes, useT } from '../i18n.ts'
import { featureComponents, report, useApp } from '../store.ts'
import type { Component, Feature } from '../types.ts'
import { Progress } from '../components/JobCard.tsx'

const FEATURES: Feature[] = ['song', 'instrumental', 'cover', 'stems', 'voice_local']

function missingOf(comps: Component[], fs: Feature[]) {
  const map = new Map<string, Component>()
  for (const f of fs) for (const c of featureComponents(comps, f)) if (c.state !== 'ready') map.set(c.id, c)
  return [...map.values()]
}

export function Wizard() {
  const t = useT()
  const system = useApp((s) => s.system)
  const comps = Object.values(useApp((s) => s.components))
  const [picked, setPicked] = useState<Set<Feature>>(() => new Set(FEATURES.filter((f) => system?.capabilities[f].available)))
  const [started, setStarted] = useState(false)
  if (!system) return null

  const usable = (f: Feature) => system.capabilities[f].available && featureComponents(comps, f).length > 0
  const isReady = (f: Feature) => featureComponents(comps, f).every((c) => c.state === 'ready')
  const chosen = [...picked].filter((f) => usable(f) && !isReady(f))
  const missing = missingOf(comps, chosen)
  const total = missing.reduce((a, c) => a + c.size_bytes, 0)
  const done = missing.reduce((a, c) => a + c.done_bytes, 0)

  const install = async () => {
    try {
      for (const f of chosen) await api.installFeature(f)
      setStarted(true)
    } catch (e) { report(e) }
  }
  const finish = () => {
    try { localStorage.setItem('sona.wizardDone', '1') } catch { /* 下次再顯示也無妨 */ }
    useApp.getState().go({ name: 'create' })
  }
  const acc = system.accelerator

  return (
    <div className="wizard">
      <div className="wizard-card panel">
        <div className="logo big">sona</div>
        <h1 className="page-title">{t('wiz.title')}</h1>
        <div className="muted">{t('wiz.machine', { acc: acc.name || acc.kind.toUpperCase(), ram: Math.round(system.ram_gb) })}</div>

        <div className="feat-list">
          {FEATURES.map((f) => {
            const cap = system.capabilities[f]
            const ok = usable(f)
            const ready = ok && isReady(f)
            const size = missingOf(comps, [f]).reduce((a, c) => a + c.size_bytes - c.done_bytes, 0)
            return (
              <label key={f} className={`feat ${ok ? '' : 'disabled'} ${picked.has(f) && ok ? 'on' : ''}`}>
                <input type="checkbox" disabled={!ok || ready || started} checked={ready || (ok && picked.has(f))}
                  onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n })} />
                <div className="row-main">
                  <div className="row-title">{t(`feat.${f}`)}</div>
                  <div className="muted small">{ok ? [t(`featd.${f}`), cap.speed_hint].filter(Boolean).join(' · ') : cap.reason}</div>
                </div>
                <span className="muted small tabular">{ready ? t('wiz.ready') : ok ? fmtBytes(size) : ''}</span>
              </label>
            )
          })}
        </div>
        {system.capabilities.voice_api.available && <div className="muted small">{t('wiz.api')}</div>}

        {started && missing.length > 0 && (
          <div className="wiz-progress">
            <Progress value={total ? done / total : -1} />
            <div className="job-meta"><span>{missing.find((c) => c.state === 'installing')?.name ?? ''}</span><span className="tabular">{fmtBytes(done)} / {fmtBytes(total)}</span></div>
            {missing.filter((c) => c.state === 'error').map((c) => <div key={c.id} className="job-error">{c.name}：{c.error}</div>)}
          </div>
        )}

        <div className="wizard-actions">
          {!started && chosen.length > 0 ? (
            <>
              <button className="btn ghost" onClick={finish}>{t('wiz.skip')}</button>
              <button className="cta" onClick={install}>{t('wiz.install')} · {fmtBytes(total - done)}</button>
            </>
          ) : (
            <button className="cta" onClick={finish}>{t('wiz.done')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
