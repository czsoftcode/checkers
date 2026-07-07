// Jednorázový měřicí skript (fáze 65, NENÍ produkční kód / engine).
// Cíl: dát rozhodovacímu dokumentu docs/endgame-db.md REÁLNÁ čísla o velikosti
// endgame databáze americké dámy (English draughts), ne odhad od stolu.
//
// Spuštění:  node scripts/endgame-count.mjs
//
// Co počítá: počet LEGÁLNÍCH ROZESTAVĚNÍ (placements) s právě k kameny na
// 32 tmavých polích, kde každý kámen ∈ {černý muž, černá dáma, bílý muž,
// bílá dáma}, obě strany mají ≥1 kámen, a MUŽ NIKDY nestojí na své proměňovací
// řadě (černý muž ne na polích 29–32, bílý muž ne na 1–4 – tam by se proměnil
// v dámu, takže tam nikdy neodpočívá). Strana na tahu zdvojuje prostor (×2).
//
// Definice legality = ROZESTAVĚNÍ, ne generování tahů: endgame DB indexuje
// pozice podle materiálu, ne podle toho, jestli má někdo tah. `legalMoves`
// z rules by tenhle počet neomezila (přijme i muže na proměňovací řadě), proto
// se správnost místo toho opírá o DVĚ NEZÁVISLÉ METODY, které se musí shodnout:
//   (1) přesná dynamická (DP) kombinatorika přes 32 polí,
//   (2) hrubá enumerace (brute force) pro malé k.
// Když se rozejdou, skript končí nenulovým kódem (žádný tichý falešný úspěch).
//
// Geometrie polí je převzatá z packages/rules/src/board.ts:
//   pole 1–4 = horní řada (řada 0, strana černého), pole 29–32 = dolní řada
//   (řada 7, strana bílého). Černý muž postupuje k vyšším číslům a proměňuje se
//   na 29–32; bílý muž k nižším a proměňuje se na 1–4.

const SQUARES = 32;
const CHINOOK_TOTAL_2_TO_8 = 443_748_401_247n; // Chinook: všechny pozice s ≤8 kameny

// Zakázaná pole pro MUŽE dané barvy (0-indexováno, pole = idx+1).
const isBlackManForbidden = (idx) => idx >= 28 && idx <= 31; // pole 29–32
const isWhiteManForbidden = (idx) => idx >= 0 && idx <= 3; //  pole 1–4

/**
 * PŘESNÝ počet rozestavění přes DP po polích.
 * Vrací mapu "b,w" -> BigInt počet rozestavění (BEZ ×2 za stranu na tahu),
 * pro všechny 0 ≤ b,w s b+w ≤ maxPieces.
 * Stav DP: počet způsobů, jak polím 0..idx přiřadit obsah tak, že je použito
 * b černých a w bílých kamenů. Na každém poli je volba: prázdno / BM / BK /
 * WM / WK (muž jen tam, kde není zakázaný).
 */
function countByMaterialDP(maxPieces) {
  // dp[b][w] = BigInt počet způsobů; iniciál: prázdná deska = 1 způsob (0,0).
  let dp = Array.from({ length: maxPieces + 1 }, () =>
    new Array(maxPieces + 1).fill(0n),
  );
  dp[0][0] = 1n;

  for (let idx = 0; idx < SQUARES; idx++) {
    const blackManOk = !isBlackManForbidden(idx);
    const whiteManOk = !isWhiteManForbidden(idx);
    // Počet druhů kamene, které smí černý/bílý na tomto poli mít:
    //   černý: king vždy (+1), man jen když povolen → 1 nebo 2
    //   bílý:  king vždy (+1), man jen když povolen → 1 nebo 2
    const blackKinds = blackManOk ? 2n : 1n;
    const whiteKinds = whiteManOk ? 2n : 1n;

    const next = Array.from({ length: maxPieces + 1 }, () =>
      new Array(maxPieces + 1).fill(0n),
    );
    for (let b = 0; b <= maxPieces; b++) {
      for (let w = 0; b + w <= maxPieces; w++) {
        const cur = dp[b][w];
        if (cur === 0n) continue;
        // pole zůstane prázdné
        next[b][w] += cur;
        // pole dostane černý kámen (man/king dle blackKinds)
        if (b + 1 + w <= maxPieces) next[b + 1][w] += cur * blackKinds;
        // pole dostane bílý kámen (man/king dle whiteKinds)
        if (b + w + 1 <= maxPieces) next[b][w + 1] += cur * whiteKinds;
      }
    }
    dp = next;
  }

  const out = new Map();
  for (let b = 0; b <= maxPieces; b++) {
    for (let w = 0; b + w <= maxPieces; w++) {
      if (dp[b][w] !== 0n) out.set(`${b},${w}`, dp[b][w]);
    }
  }
  return out;
}

/**
 * NEZÁVISLÁ hrubá enumerace pro malé k: projde VŠECHNA rozestavění právě
 * `pieces` kamenů (rekurzivně po polích) a spočítá je podle (b,w).
 * Vrací mapu "b,w" -> BigInt. Pomalé, jen pro k ≤ ~4 (kontrola DP).
 */
function countByMaterialBrute(pieces) {
  const out = new Map();
  // Obsahy pole: 0=prázdno, 1=BM, 2=BK, 3=WM, 4=WK
  const board = new Array(SQUARES).fill(0);
  let placed = 0;
  let blacks = 0;
  let whites = 0;

  function record() {
    const key = `${blacks},${whites}`;
    out.set(key, (out.get(key) ?? 0n) + 1n);
  }

  // Enumerace: na každém poli zvolíme obsah, ale abychom nepočítali permutace
  // pořadí vícekrát, jdeme striktně vzestupně po polích a na každém poli buď
  // necháme prázdno, nebo umístíme jeden kámen. To dá každé rozestavění právě
  // jednou (množina obsazených polí + jejich obsah).
  function rec(idx) {
    if (placed === pieces) {
      record();
      return;
    }
    if (idx >= SQUARES) return;
    const remainingSquares = SQUARES - idx;
    if (pieces - placed > remainingSquares) return; // nejde doplnit

    // 1) pole prázdné
    rec(idx + 1);

    // 2) pole obsazené jedním ze 4 druhů (muž jen kde smí)
    const blackManOk = !isBlackManForbidden(idx);
    const whiteManOk = !isWhiteManForbidden(idx);
    const options = [];
    if (blackManOk) options.push(1);
    options.push(2);
    if (whiteManOk) options.push(3);
    options.push(4);
    for (const o of options) {
      board[idx] = o;
      placed++;
      if (o === 1 || o === 2) blacks++;
      else whites++;
      rec(idx + 1);
      if (o === 1 || o === 2) blacks--;
      else whites--;
      placed--;
      board[idx] = 0;
    }
  }
  rec(0);
  return out;
}

// --- Sečti počty na "právě k kamenů, obě strany ≥1, ×2 za stranu na tahu" ---
function positionsForExactlyK(dpMap, k) {
  let sum = 0n;
  for (let b = 1; b <= k - 1; b++) {
    const w = k - b;
    if (w < 1) continue;
    sum += dpMap.get(`${b},${w}`) ?? 0n;
  }
  return sum * 2n; // ×2 strana na tahu
}

// Největší JEDNA materiálová třída (b,w) s b+w=k, jeden směr tahu (×1) –
// to určuje špičkovou RAM generování (~1 bajt/pozice na tu třídu).
function largestClassForK(dpMap, k) {
  let best = 0n;
  let bestKey = '';
  for (let b = 1; b <= k - 1; b++) {
    const w = k - b;
    if (w < 1) continue;
    const v = dpMap.get(`${b},${w}`) ?? 0n;
    if (v > best) {
      best = v;
      bestKey = `${b}č vs ${w}b`;
    }
  }
  return { count: best, key: bestKey };
}

function fmt(n) {
  // Zformátuje BigInt s mezerami po tisících.
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function bytesToHuman(bytesBig) {
  const b = Number(bytesBig);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

// ------------------------------ BĚH ------------------------------
let failed = false;

const MAX_PIECES = 8;
const dp = countByMaterialDP(MAX_PIECES);

// KŘÍŽOVÁ KONTROLA: DP vs brute force pro k = 2, 3, 4.
console.log('== Křížová kontrola DP vs brute-force (k=2..4) ==');
for (const k of [2, 3, 4]) {
  const brute = countByMaterialBrute(k);
  // porovnej všechny (b,w) s b+w=k
  let ok = true;
  for (let b = 0; b <= k; b++) {
    const w = k - b;
    const key = `${b},${w}`;
    const dpv = dp.get(key) ?? 0n;
    const bv = brute.get(key) ?? 0n;
    if (dpv !== bv) {
      ok = false;
      console.log(`  ROZPOR k=${k} ${key}: DP=${fmt(dpv)} brute=${fmt(bv)}`);
    }
  }
  console.log(`  k=${k}: ${ok ? 'OK (shoda)' : 'SELHÁNÍ'}`);
  if (!ok) failed = true;
}
console.log('');

// TABULKA: počet pozic, disk (2 bity/pozice), špičková RAM generování.
console.log('== Endgame DB: počet pozic a velikost podle počtu kamenů ==');
console.log('(pozice = rozestavění × 2 strany na tahu; disk WLD = 2 bity/pozice;');
console.log(' RAM = největší 1 materiálová třída × 1 bajt, jeden směr tahu)');
console.log('');
console.log('  k | pozic (×2 turn)          | disk @2bit  | největší třída        | RAM @1B/tř.');
console.log('  --+--------------------------+-------------+-----------------------+------------');
let cumulative = 0n;
for (let k = 2; k <= MAX_PIECES; k++) {
  const pos = positionsForExactlyK(dp, k);
  cumulative += pos;
  const diskBytes = pos / 4n; // 2 bity = 1/4 bajtu
  const largest = largestClassForK(dp, k);
  const ramBytes = largest.count; // 1 bajt/pozice
  console.log(
    `  ${k} | ${fmt(pos).padStart(24)} | ${bytesToHuman(diskBytes).padStart(11)} | ${largest.key.padStart(21)} | ${bytesToHuman(ramBytes).padStart(10)} (${fmt(largest.count)} poz.)`,
  );
}
console.log('');
console.log(`  Součet pozic k=2..8 (×2 turn): ${fmt(cumulative)}`);
console.log(`  Disk celkem @2 bity (raw):     ${bytesToHuman(cumulative / 4n)}`);
console.log(`  Disk celkem @2 bity (~½ díky symetrii): ${bytesToHuman(cumulative / 8n)}`);
console.log('');

// EXTERNÍ SANITY: porovnání s Chinook číslem 443 748 401 247.
console.log('== Porovnání s Chinook (443 748 401 247 pozic, ≤8 kamenů) ==');
const rawNoTurn = cumulative / 2n; // bez ×2 za stranu na tahu
console.log(`  Náš součet BEZ ×2 (jen rozestavění): ${fmt(rawNoTurn)}`);
console.log(`  Náš součet S ×2 (strana na tahu):   ${fmt(cumulative)}`);
console.log(`  Chinook uvádí:                       ${fmt(CHINOOK_TOTAL_2_TO_8)}`);
const ratioTurn = Number(cumulative) / Number(CHINOOK_TOTAL_2_TO_8);
const ratioNoTurn = Number(rawNoTurn) / Number(CHINOOK_TOTAL_2_TO_8);
console.log(`  Poměr (S ×2)/Chinook:   ${ratioTurn.toFixed(4)}`);
console.log(`  Poměr (BEZ ×2)/Chinook: ${ratioNoTurn.toFixed(4)}`);
console.log('');

if (failed) {
  console.error('SELHÁNÍ: DP a brute-force se neshodly – čísla NEJSOU důvěryhodná.');
  process.exit(1);
}
console.log('OK: obě nezávislé metody se shodly.');
