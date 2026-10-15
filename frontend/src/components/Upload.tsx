import { useRef, useState } from 'react'
import { api } from '../api.ts'
import { fmtDuration, useT } from '../i18n.ts'
import { report } from '../store.ts'
import type { Upload } from '../types.ts'
import { Icon } from './Icon.tsx'

const ACCEPT = '.mp3,.wav,.flac,.m4a,audio/*'

/** 拖檔或選檔上傳，完成後回傳 upload */
export function DropUpload({ value, onChange }: { value: Upload | null; onChange: (u: Upload | null) => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const send = (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    api.upload(file, file.name).then(onChange, report).finally(() => setBusy(false))
  }

  return (
    <div className={`drop ${over ? 'over' : ''} ${value ? 'filled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]) }}
      onClick={() => !value && input.current?.click()}>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { send(e.target.files?.[0]); e.target.value = '' }} />
      {busy ? (
        <span className="muted">{t('create.uploading')}</span>
      ) : value ? (
        <>
          <Icon name="voice" />
          <span className="ellipsis">{value.filename}</span>
          <span className="muted tabular">{fmtDuration(value.duration_s)}</span>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onChange(null) }}><Icon name="x" size={16} /></button>
        </>
      ) : (
        <>
          <Icon name="upload" />
          <span>{t('create.drop')}</span>
        </>
      )}
    </div>
  )
}
