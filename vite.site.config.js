const path = require('path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

/**
 * Marketing site (site/) — deployed to GitHub Pages, completely separate from
 * the desktop app UI in ui/. On a project Pages site the app is served from
 * /<repo>/, so the base path is injected at build time via SITE_BASE.
 */
module.exports = defineConfig({
  root: path.resolve(__dirname, 'site'),
  base: process.env.SITE_BASE || '/tally-backup/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'site', 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
