// Balicí skript itch buildu (fáze 89). NENÍ produkční kód appky – jen release nástroj.
//
// Spuštění:  node scripts/build-itch.mjs   (nebo `pnpm build:itch` z rootu)
//
// Co dělá:
//   1) postaví web v itch módu (`vite build --mode itch`): base './', bez Plausible,
//      relativní favicon (viz packages/web/vite.config.ts),
//   2) zabalí OBSAH dist/ do zipu tak, že `index.html` je v KOŘENI zipu (ne v podsložce)
//      – to je vstupní bod, který itch.io u HTML5 hry hledá v kořeni archivu,
//   3) doloží velikost (obsah dist/ + výsledný zip) proti limitu itch.
//
// Selhání KTERÉKOLI fáze končí nenulovým exit kódem (žádný tichý falešný úspěch):
// spadlý build, chybějící dist/index.html, nedostupný `zip`, nebo index.html jinde
// než v kořeni zipu. Kdo skript pustí v CI, pozná rozbití podle exit kódu.

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = resolve(ROOT, 'packages/web');
const DIST_DIR = resolve(WEB_DIR, 'dist');
const ZIP_PATH = resolve(WEB_DIR, 'checkers-itch.zip');

// Orientační strop itch.io pro nahrávaný soubor (HTML5). Bundle je ~2 MB, hluboko pod –
// slouží jen k doložení v logu, ne k tvrdé kontrole (limit se u itch může měnit).
const ITCH_LIMIT_MB = 1024;

/** Chyba s čistou hláškou → nenulový exit; nezaloguje stack (to je pro nečekané pády). */
function fail(message) {
  console.error(`\n[build:itch] CHYBA: ${message}`);
  process.exit(1);
}

/** Spustí příkaz, zdědí stdio; při nenulovém kódu shodí celý skript s hláškou. */
function run(cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', ...opts });
  } catch (err) {
    // ENOENT = binárka není v PATH (typicky chybí `zip`); jinak nenulový exit příkazu.
    if (err && err.code === 'ENOENT') {
      fail(`příkaz "${cmd}" nenalezen – nainstaluj ho (zip: \`apt install zip\`).`);
    }
    fail(`příkaz "${cmd} ${args.join(' ')}" selhal (exit ${err?.status ?? '?'}).`);
  }
}

/** Součet velikostí souborů ve stromě (rekurzivně) v bajtech. */
function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else if (entry.isFile()) {
      total += statSync(full).size;
    }
  }
  return total;
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

// 1) Build v itch módu. `exec vite` (ne `pnpm run build --mode itch`) je jednoznačné –
//    nezáleží na tom, jak pnpm forwarduje argumenty do npm skriptu.
console.log('[build:itch] Stavím web v itch módu…');
run('pnpm', ['--filter', '@checkers/web', 'exec', 'vite', 'build', '--mode', 'itch'], { cwd: ROOT });

// 2) Kontrola výstupu: bez index.html v kořeni dist/ by byl zip k ničemu.
const distIndex = resolve(DIST_DIR, 'index.html');
if (!existsSync(distIndex)) {
  fail(`po buildu chybí ${distIndex} – build neproběhl, jak měl.`);
}

// 2b) TVRDĚ ověř DVA invarianty, kvůli kterým itch mód vůbec existuje – jinak by
//    tichá regrese v transformIndexHtml (přejmenovaná analytika, změněný markup)
//    prošla jako úspěch a na itch by se nahrál živý externí tracker / rozbil favicon.
//    Kontrola kořene zipu níž je až sekundární; TOHLE je to podstatné.
const indexHtml = readFileSync(distIndex, 'utf8');
if (/plausible/i.test(indexHtml)) {
  fail(
    `dist/index.html po itch buildu STÁLE obsahuje „plausible" – strip v vite.config.ts ` +
      `přestal fungovat (přejmenovaná analytika / změněný markup?). Externí tracker by šel na itch.`,
  );
}
if (/href=["']\/favicon\.ico["']/i.test(indexHtml)) {
  fail(
    `dist/index.html má favicon jako ABSOLUTNÍ „/favicon.ico" – z podcesty itch.zone by se nenačetl. ` +
      `Přepis na relativní v vite.config.ts přestal fungovat.`,
  );
}

// 3) Zip: starý smazat (zip jinak PŘIDÁVÁ do existujícího archivu), pak balit Z dist/
//    přes `.`, ať je index.html v kořeni. `-r` rekurzivně, `-X` bez extra metadat.
if (existsSync(ZIP_PATH)) {
  rmSync(ZIP_PATH);
}
console.log('[build:itch] Balím dist/ do zipu (index.html v kořeni)…');
run('zip', ['-r', '-X', ZIP_PATH, '.'], { cwd: DIST_DIR });

if (!existsSync(ZIP_PATH)) {
  fail('zip nevznikl, ačkoli příkaz `zip` nehlásil chybu.');
}

// 4) Ověření, že index.html je opravdu v KOŘENI zipu (ne ve složce). `unzip -l` vypíše
//    cesty; hledáme přesně `index.html` bez lomítka. Když je jinde, itch by hru nenašel.
let listing = '';
try {
  listing = execFileSync('unzip', ['-l', ZIP_PATH], { encoding: 'utf8' });
} catch (err) {
  if (err && err.code === 'ENOENT') {
    // `unzip` není povinné pro balení, jen pro tuhle kontrolu. Bez něj kontrolu vynech,
    // ale řekni to nahlas – ať nikdo nečte ticho jako „ověřeno".
    console.warn('[build:itch] `unzip` není k dispozici → přeskakuji kontrolu kořene zipu.');
  } else {
    fail('nepodařilo se vypsat obsah zipu pro kontrolu kořene.');
  }
}
if (listing !== '') {
  // `unzip -l` má cestu jako POSLEDNÍ token řádku. Kořenový index.html = přesně
  // „index.html" (ne „assets/index.html" ani jiná složka). Hlavička/oddělovač těmto
  // podmínkám nevyhoví, takže je není třeba zvlášť filtrovat.
  const hasRootIndex = listing
    .split('\n')
    .some((line) => line.trim().split(/\s+/).pop() === 'index.html');
  if (!hasRootIndex) {
    fail('index.html není v kořeni zipu – itch by vstupní bod nenašel.');
  }
}

// 5) Doložení velikosti – porovnané s limitem, ne natvrdo „OK" (jinak by log lhal,
//    kdyby bundle limit překročil). Přes limit = tvrdá chyba (itch by upload odmítl).
const distBytes = dirSizeBytes(DIST_DIR);
const zipBytes = statSync(ZIP_PATH).size;
const zipMb = zipBytes / (1024 * 1024);
const sizeVerdict = zipMb <= ITCH_LIMIT_MB ? `pod limitem ~${ITCH_LIMIT_MB} MB → OK` : 'PŘES LIMIT!';
console.log('\n[build:itch] Hotovo.');
console.log(`  zip:         ${ZIP_PATH}`);
console.log(`  obsah dist/: ${mb(distBytes)} MB`);
console.log(`  velikost zip: ${mb(zipBytes)} MB  (${sizeVerdict})`);
if (zipMb > ITCH_LIMIT_MB) {
  fail(`zip ${mb(zipBytes)} MB překračuje limit itch ~${ITCH_LIMIT_MB} MB.`);
}
