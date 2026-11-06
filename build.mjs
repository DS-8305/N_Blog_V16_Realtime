import { build } from 'esbuild';
await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/cli.js',
  platform: 'node',
  format: 'esm',
  bundle: true,
  packages: 'external',
  sourcemap: true,
});
