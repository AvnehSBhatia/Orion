import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const copyStatic = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => cp('static', 'dist', { recursive: true }));
  },
};

const options = {
  entryPoints: ['src/background.ts', 'src/popup.ts', 'src/options.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
  plugins: [copyStatic],
};

await rm('dist', { recursive: true, force: true });

if (watch) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
