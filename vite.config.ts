import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Custom domain deploy uses root path
  base: '/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) || process.env.npm_package_version || '',
    ),
  },
})
