import { useState } from 'react'
import { api } from '../api.ts'
import { fmtBytes, useT } from '../i18n.ts'
import { report, useApp } from '../store.ts'
import type { Component, SettingsPatch } from '../types.ts'
import { Progress } from '../components/JobCard.tsx'
import { useEnter } from '../ime.ts'

export function SettingsPage() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const comps = Object.values(useApp((s) => s.components)).filter((c) => c.state !== 'unsupported')
  const [dir, setDir] = useState(settings?.music_dir ?? '')
  const [key, setKey] = useState('')

  const save = (patch: SettingsPatch) =>
    api.putSettings(patch).then((s) => { useApp.setState({ settings: s }); useApp.getState().notify(t('set.saved')) }, report)
  const saveDir = () => dir.trim() && dir !== settings?.music_dir && save({ music_dir: dir.trim() })
  const pickDir = () => window.sona?.pickFolder?.(dir || settings?.music_dir).then((p) => {
    if (p && p !== settings?.music_dir) { setDir(p); save({ music_dir: p }) }
  })
  const saveKey = () => key.trim() && save({ fish_api_key: key.trim() }).then(() => setKey(''))
  const dirEnter = useEnter(saveDir)
  const keyEnter = useEnter(saveKey)

  if (!settings) return null
  return (
    <div className="settings-page scroll">
      <h1 className="page-title">{t('nav.settings')}</h1>

      <div className="setting">
        <label htmlFor="s-dir">{t('set.musicDir')}</label>
        <div className="setting-row">
          <input id="s-dir" className="input" value={dir} onChange={(e) => setDir(e.target.value)} {...dirEnter} />
          {window.sona?.pickFolder && <button className="btn" onClick={pickDir}>{t('set.pickDir')}</button>}
          <button className="btn" disabled={!dir.trim() || dir === settings.music_dir} onClick={saveDir}>{t('set.save')}</button>
        </div>
      </div>

      <div className="setting">
        <label htmlFor="s-key">{t('set.fishKey')}</label>
        <div className="setting-row">
          <input id="s-key" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={settings.fish_api_key_set ? t('set.fishKeySet') : ''} {...keyEnter} />
          <button className="btn" disabled={!key.trim()} onClick={saveKey}>{t('set.save')}</button>
        </div>
      </div>

      <div className="setting">
        <label>{t('set.language')}</label>
        <div className="segmented small">
          <button className={settings.language === 'zh-TW' ? 'on' : ''} onClick={() => save({ language: 'zh-TW' })}>繁體中文</button>
          <button className={settings.language === 'en' ? 'on' : ''} onClick={() => save({ language: 'en' })}>English</button>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <label>{t('set.components')}</label>
          <button className="link" onClick={() => useApp.getState().go({ name: 'wizard' })}>{t('set.wizard')}</button>
        </div>
        <div className="comp-list">
          {comps.map((c) => <ComponentRow key={c.id} c={c} />)}
        </div>
      </div>
    </div>
  )
}

export function ComponentRow({ c }: { c: Component }) {
  const t = useT()
  const busy = c.state === 'installing' || c.state === 'queued'
  return (
    <div className={`comp comp-${c.state}`}>
      <div className="row-main">
        <div className="row-title">{c.name}</div>
        <div className="muted small">{c.state === 'error' ? c.error : c.description}</div>
        {busy && <Progress value={c.size_bytes ? c.done_bytes / c.size_bytes : -1} />}
      </div>
      <span className="muted small tabular">
        {busy ? `${fmtBytes(c.done_bytes)} / ${fmtBytes(c.size_bytes)}` : fmtBytes(c.size_bytes)}
      </span>
      <span className={`pill state-${c.state}`}>{t(`cstate.${c.state}`)}</span>
      {c.state === 'ready' ? (
        <button className="btn ghost small" onClick={() => confirm(t('comp.confirmDelete', { t: c.name })) && api.deleteComponent(c.id).catch(report)}>{t('comp.delete')}</button>
      ) : busy ? (
        <button className="btn ghost small" onClick={() => api.cancelComponent(c.id).catch(report)} title={t('dl.pauseTip')}>{t('dl.pause')}</button>
      ) : c.state !== 'unsupported' ? (
        <button className="btn small" onClick={() => api.installComponent(c.id).catch(report)}>{c.state === 'error' ? t('comp.retry') : c.done_bytes > 0 ? t('dl.resume') : t('comp.install')}</button>
      ) : <span />}
    </div>
  )
}
