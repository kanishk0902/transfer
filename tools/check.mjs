// Lightweight pre-flight: parse every JS file as a module, validate the
// manifest, and confirm every file the manifest references exists.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const path = p => new URL(p, root).pathname;
let failures = 0;
const fail = m => { console.error('FAIL ' + m); failures++; };

function jsFiles(dir) {
  return readdirSync(path(dir), { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => dir + e.name);
}

const files = [...jsFiles(''), ...jsFiles('src/'), ...jsFiles('test/')];
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(path(f), 'utf8'), stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    fail(`${f} does not parse as an ES module:\n${e.stderr}`);
  }
}
console.log(`parsed ${files.length} js files`);

// Named imports must resolve to real exports — a typo here only shows up at
// runtime in the browser, which is exactly where it is hardest to notice.
const exportsOf = {};
for (const f of files.filter(f => f.startsWith('src/'))) {
  const src = readFileSync(path(f), 'utf8');
  exportsOf[f.replace('src/', '')] = [
    ...[...src.matchAll(/export (?:async )?(?:function|const|let|class)\s+(\w+)/g)].map(m => m[1]),
    ...[...src.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(x => x.trim()))
  ];
}
for (const f of files) {
  const src = readFileSync(path(f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const mod = m[2].replace(/^\.\//, '').replace(/^src\//, '');
    if (!exportsOf[mod]) continue;
    for (const name of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
      if (!exportsOf[mod].includes(name)) fail(`${f} imports {${name}} which ${mod} does not export`);
    }
  }
}
console.log('named imports resolve');

const manifest = JSON.parse(readFileSync(path('manifest.json'), 'utf8'));
const referenced = [
  manifest.action.default_popup,
  manifest.options_page,
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(c => c.js),
  ...Object.values(manifest.icons)
];
for (const ref of referenced) {
  if (!existsSync(path(ref))) fail(`manifest references missing file: ${ref}`);
}
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.oauth2.client_id.includes('apps.googleusercontent.com')) {
  fail('oauth2.client_id looks malformed');
}
if (manifest.oauth2.client_id.startsWith('REPLACE_')) {
  console.log('note: oauth2.client_id is still the placeholder (Drive sync will not work yet)');
}
console.log(`manifest references ${referenced.length} files`);

process.exit(failures ? 1 : 0);
