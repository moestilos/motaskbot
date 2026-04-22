import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind({ applyBaseStyles: false })],
  server: { port: 4321, host: true },
  vite: {
    envPrefix: ['PUBLIC_'],
    envDir: '../../',
    server: { fs: { allow: ['..', '../..'] } },
  },
});
