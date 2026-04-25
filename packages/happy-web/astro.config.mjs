import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://happy.weifashi.cn',
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: [
        '.coder.hitosea.com',
      ],
    },
  },
});
