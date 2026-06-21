import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',  // Force IPv4 — avoids ::1 EACCES on Windows/WSL2
    port: 3000,
    strictPort: false,  // Auto-increment port if 3000 is still blocked
    proxy: {
      '/api': 'http://142.93.222.0:8000',
      '/maps': 'http://142.93.222.0:8000'
    }
  },
})

