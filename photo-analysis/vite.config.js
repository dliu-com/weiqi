import {defineConfig} from 'vite';
export default defineConfig({base:'/photo-assets/',build:{outDir:'../src/photo-assets',emptyOutDir:true,rollupOptions:{input:{photo:'src/main.js',benchmark:'src/benchmark.js'},output:{entryFileNames:chunk=>chunk.name==='photo'?'photo-app.js':'analysis-benchmark.js',assetFileNames:'[name]-[hash][extname]'}},target:'es2022'},worker:{format:'es'}});
