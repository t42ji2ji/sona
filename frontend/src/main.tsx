import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './styles.css'
import { App } from './App.tsx'
import { boot } from './store.ts'

createRoot(document.getElementById('root')!).render(<App />)
void boot()
