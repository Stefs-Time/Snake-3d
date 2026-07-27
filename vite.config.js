import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Emits the service worker with a real precache manifest.
 *
 * It runs after the bundle is written so it can walk the actual output
 * directory — that picks up hashed JS/CSS chunks *and* everything copied from
 * public/, which is what makes a fully offline arcade possible.
 */
function serviceWorkerPlugin() {
  return {
    name: 'neon-cabinet-sw',
    apply: 'build',
    closeBundle() {
      const dist = resolve('dist');
      const files = [];

      const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(`/${relative(dist, full).split(/[\\/]/).join('/')}`);
        }
      };
      walk(dist);

      const precache = files
        .filter((file) => file !== '/sw.js')
        // Source maps are dead weight in a cache the user pays for.
        .filter((file) => !file.endsWith('.map'))
        .sort();

      // The shell has to be reachable at the root path too.
      if (!precache.includes('/index.html')) precache.push('/index.html');
      precache.push('/');

      const version = createHash('sha256')
        .update(precache.join('|'))
        .digest('hex')
        .slice(0, 12);

      const template = readFileSync(resolve('scripts/sw-template.js'), 'utf8');
      const output = template
        .replaceAll('__VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2));

      // A leftover token means the worker would throw a ReferenceError on
      // evaluation and silently fail to register — fail the build instead.
      if (output.includes('__VERSION__') || output.includes('__PRECACHE__')) {
        throw new Error('service worker template still contains placeholders');
      }

      writeFileSync(join(dist, 'sw.js'), output);
      console.log(`\n  service worker: ${precache.length} files precached (build ${version})`);
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [serviceWorkerPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Three.js is only needed by Snake 3D — keep it out of the entry
          // bundle so the hub and the 2D games boot instantly.
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
