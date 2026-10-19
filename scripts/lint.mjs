// Hafif statik kontroller (tsc --noEmit tip ve kullanılmayan değişken kontrolüne ek olarak).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['server', 'client', 'shared', 'scripts'];
const problems = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const file of roots.flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const at = `${file}:${i + 1}`;
    if (file.startsWith('client') && /console\.log\(/.test(l)) problems.push(`${at} istemci kodunda console.log`);
    if (/debugger;/.test(l)) problems.push(`${at} debugger ifadesi`);
    if (/dangerouslySetInnerHTML/.test(l)) problems.push(`${at} dangerouslySetInnerHTML (XSS riski)`);
    if (/sql\.unsafe\(/.test(l) && !file.includes('migrate')) problems.push(`${at} sql.unsafe yalnızca migration'da kullanılabilir`);
    if (/(sk_live_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(l)) problems.push(`${at} koda gömülü gizli anahtar`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Lint: sorun bulunamadı.');
