import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useT } from '../i18n.ts'
import type { Key } from '../i18n.ts'
import { report, useApp } from '../store.ts'
import type { Feature, Job, JobParams, JobType, Quality, Upload } from '../types.ts'
import { FeatureGate } from '../components/FeatureGate.tsx'
import { DropUpload } from '../components/Upload.tsx'
import { TrackRow } from '../components/TrackRow.tsx'

type Tab = 'song' | 'instrumental' | 'cover' | 'stems'
const tabs: Tab[] = ['song', 'instrumental', 'cover', 'stems']
const TAGS = ['pop', 'indie', 'lo-fi', 'r&b', 'rock', 'jazz', 'city pop', 'folk', 'ballad', 'synthwave', 'edm',
  'female vocal', 'male vocal', 'piano', 'acoustic guitar', 'strings', 'dreamy', 'upbeat', 'melancholic', 'chill']

export function Create() {
  const t = useT()
  const tracks = useApp((s) => s.tracks)
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('sona.tab') as Tab) || 'song')
  const [title, setTitle] = useDraft('title')
  const [style, setStyle] = useDraft('style')
  const [lyrics, setLyrics] = useDraft('lyrics')
  const [mode, setMode] = useState<'full' | 'melody' | 'off'>('full')
  const [seed, setSeed] = useState('')
  const [quality, setQuality] = useState<Quality>('fast')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [instrumental, setInstrumental] = useState(false)
  const [stemModel, setStemModel] = useState<'htdemucs' | 'htdemucs_ft'>('htdemucs')
  const [sending, setSending] = useState(false)

  const pick = (x: Tab) => { setTab(x); sessionStorage.setItem('sona.tab', x) }
  const addTag = (tag: string) => setStyle((s) => (s.trim() ? `${s.trim().replace(/,$/, '')}, ${tag}` : tag))
  const seedNum = seed.trim() ? Number(seed) : undefined
  const ttl = title.trim() || undefined

  const ready = {
    song: style.trim() && lyrics.trim(),
    instrumental: style.trim(),
    cover: upload && style.trim() && (instrumental || lyrics.trim()),
    stems: upload,
  }[tab]

  const submit = async () => {
    if (!ready || sending) return
    setSending(true)
    try {
      let job: Job
      const make = <T extends JobType>(type: T, p: JobParams[T]) => api.createJob(type, p)
      if (tab === 'song') job = await make('song', { title: ttl, style, lyrics, mode, seed: seedNum, quality })
      else if (tab === 'instrumental') job = await make('instrumental', { title: ttl, style, seed: seedNum, quality })
      else if (tab === 'cover')
        job = await make('cover', { title: ttl, upload_id: upload!.upload_id, style, instrumental, lyrics: instrumental ? undefined : lyrics, seed: seedNum, quality })
      else job = await make('stems', { title: ttl, upload_id: upload!.upload_id, model: stemModel })
      useApp.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
      if (tab === 'cover' || tab === 'stems') setUpload(null)
    } catch (e) {
      report(e)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="create">
      <section className="create-form scroll">
        <h1 className="page-title">{t('nav.create')}</h1>
        <div className="segmented">
          {tabs.map((x) => (
            <button key={x} className={tab === x ? 'on' : ''} onClick={() => pick(x)}>{t(`kind.${x}`)}</button>
          ))}
        </div>

        <FeatureGate feature={tab as Feature}>
          {(tab === 'cover' || tab === 'stems') && <DropUpload value={upload} onChange={setUpload} />}

          {tab !== 'stems' && (
            <label className="field">
              <span>{t('create.style')}</span>
              <textarea className="input" rows={2} value={style} onChange={(e) => setStyle(e.target.value)}
                placeholder={t(tab === 'instrumental' ? 'create.instStylePh' : 'create.stylePh')} />
              <div className="chips">
                {TAGS.map((tag) => <button key={tag} className="chip" onClick={() => addTag(tag)}>{tag}</button>)}
              </div>
            </label>
          )}

          {tab === 'cover' && (
            <label className="switch-row">
              <span>{t('create.instrumental')}</span>
              <Switch on={instrumental} onChange={setInstrumental} />
            </label>
          )}

          {(tab === 'song' || (tab === 'cover' && !instrumental)) && (
            <label className="field">
              <span>{t(tab === 'song' ? 'create.lyrics' : 'create.newLyrics')}</span>
              <textarea className="input lyrics" rows={tab === 'song' ? 10 : 5} value={lyrics} onChange={(e) => setLyrics(e.target.value)}
                placeholder={t('create.lyricsPh')} />
            </label>
          )}

          {tab === 'song' && (
            <div className="field">
              <span>{t('create.mode')}</span>
              <div className="segmented small">
                {(['full', 'melody', 'off'] as const).map((m) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t(`mode.${m}` as Key)}</button>
                ))}
              </div>
            </div>
          )}

          {tab === 'stems' && (
            <div className="field">
              <span>{t('create.stemModel')}</span>
              <div className="segmented small">
                {(['htdemucs', 'htdemucs_ft'] as const).map((m) => (
                  <button key={m} className={stemModel === m ? 'on' : ''} onClick={() => setStemModel(m)}>{t(`stemModel.${m}`)}</button>
                ))}
              </div>
            </div>
          )}

          <details className="advanced">
            <summary>{t('create.advanced')}</summary>
            <label className="field">
              <span>{t('create.title')}</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('create.titlePh')} />
            </label>
            {tab !== 'stems' && (
              <div className="field">
                <span>{t('create.quality')}</span>
                <div className="segmented small">
                  {(['fast', 'high'] as const).map((q) => (
                    <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>{t(`quality.${q}`)}</button>
                  ))}
                </div>
              </div>
            )}
            {tab !== 'stems' && (
              <label className="field">
                <span>{t('create.seed')}</span>
                <input className="input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
              </label>
            )}
          </details>

          <button className="cta" disabled={!ready || sending} onClick={submit}>{t('create.go')}</button>
        </FeatureGate>
      </section>

      <section className="create-recent scroll">
        <h2 className="section-title">{t('create.recent')}</h2>
        {tracks.slice(0, 30).map((tr, i, list) => <TrackRow key={tr.id} list={list} index={i} actions={false} />)}
      </section>
    </div>
  )
}

/** 草稿存 sessionStorage：切到佇列看進度再回來，打好的歌詞還在 */
function useDraft(key: string) {
  const [v, setV] = useState(() => sessionStorage.getItem(`sona.draft.${key}`) ?? '')
  useEffect(() => { sessionStorage.setItem(`sona.draft.${key}`, v) }, [key, v])
  return [v, setV] as const
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>
}
