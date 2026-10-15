import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 打包後用 file:// 載入，資源要用相對路徑；開發時 electron 固定連 5173
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
