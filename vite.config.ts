import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base path for GitHub Pages project site. Adjust to your repo name.
  base: process.env.VITE_BASE || '/yaya/',
})
