// İstemci paketini esbuild ile derler: public/assets/app.js + app.css
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: { app: 'client/main.tsx' },
  bundle: true,
  outdir: 'public/assets',
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('İstemci izleniyor…');
} else {
  const r = await esbuild.build({ ...options, metafile: true });
  const out = Object.entries(r.metafile.outputs).map(([f, o]) => `${f} ${(o.bytes / 1024).toFixed(1)} KB`);
  console.log(out.join('\n'));
}
