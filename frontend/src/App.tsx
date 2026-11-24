import { useEffect } from 'react'
import { useApp } from './store.ts'
import { useT } from './i18n.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { PlayerBar } from './components/PlayerBar.tsx'
import { Create } from './pages/Create.tsx'
import { Library } from './pages/Library.tsx'
import { TrackPage } from './pages/TrackPage.tsx'
import { VoicePage } from './pages/VoicePage.tsx'
import { QueuePage } from './pages/QueuePage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { Wizard } from './pages/Wizard.tsx'

export function App() {
  const page = useApp((s) => s.page)
  const booted = useApp((s) => s.booted)
  const connected = useApp((s) => s.connected)
  const lang = useApp((s) => s.settings?.language)
  const t = useT()

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'
  }, [lang])

  return (
    <>
      <div className="titlebar" />
      {!booted ? null : page.name === 'wizard' ? (
        <Wizard />
      ) : (
        <div className="shell">
          <Sidebar />
          <main className="main panel" key={page.name === 'track' ? page.id : page.name}>
            {page.name === 'create' && <Create />}
            {page.name === 'library' && <Library />}
            {page.name === 'track' && <TrackPage id={page.id} />}
            {page.name === 'voice' && <VoicePage />}
            {page.name === 'queue' && <QueuePage />}
            {page.name === 'settings' && <SettingsPage />}
          </main>
          <PlayerBar />
        </div>
      )}
      {booted && !connected && <div className="offline">{t('err.offline')}</div>}
      <Toast />
    </>
  )
}

function Toast() {
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => useApp.setState({ toast: null }), 5000)
    return () => clearTimeout(id)
  }, [toast])
  if (!toast) return null
  return (
    <div className="toast" key={toast.at} onClick={() => useApp.setState({ toast: null })}>
      {toast.text}
    </div>
  )
}
