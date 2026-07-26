const path = require('path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  root: path.resolve(__dirname, 'ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'ui', 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
