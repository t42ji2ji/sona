import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource/noto-sans-tc/400.css'
import '@fontsource/noto-sans-tc/500.css'
import '@fontsource/noto-sans-tc/700.css'
import './styles.css'
import { App } from './App.tsx'
import { boot } from './store.ts'

createRoot(document.getElementById('root')!).render(<App />)
void boot()
