import { defineConfig } from 'vite';

/**
 * TokTok clone - Vite 8 build configuration.
 *
 * Constraints from the project objective ("without real URL, without server"):
 *  - `base: './'`  -> every emitted asset URL is relative, so dist/ works from
 *    any directory, any static host, or straight off the filesystem.
 *  - single IIFE bundle -> no ES-module loading at runtime, so the built page
 *    can run from file:// (Chrome blocks external module scripts on file://).
 *  - `transformIndexHtml` (build only) rewrites Vite's `<script type="module"
 *    crossorigin>` into `<script defer>` and drops crossorigin/modulepreload
 *    markup that would trigger CORS failures on file:// origins.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // Emitted output is a classic script; the modulepreload polyfill is dead weight.
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'TokTokBundle'
      }
    }
  },
  plugins: [
    (() => {
      let isBuild = false;
      return {
        name: 'toktok-file-protocol-output',
        configResolved(config) {
          isBuild = config.command === 'build';
        },
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            if (!isBuild) return html;
            const out = html
              // classic deferred script instead of type="module"
              .replace(/<script\s+type="module"/g, '<script defer')
              // crossorigin triggers CORS mode, which fails on file:// origins
              .replace(/\s+crossorigin(?:="[^"]*")?/g, '')
              // modulepreload links are meaningless for a classic script
              .replace(/[ \t]*<link rel="modulepreload"[^>]*>\s*\n?/g, '');
            return out;
          }
        }
      };
    })()
  ]
});
