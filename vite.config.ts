import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  base: process.env.CLOUDFLARE_ENV === 'production' ? '/places/' : '/',
  plugins: [react(), cloudflare()],
});
