/**
 * Archiv dokončených PvP partií na disk (fáze 23, napojeno fází 92). Jednosměrné
 * a best-effort: po skončení partie se z ní vyrobí PDN celé partie a atomicky
 * zapíše jako `<id>.pdn`. Zpět do hry se NIKDY nenačítá – server zůstává jediným
 * zdrojem pravdy, tohle je jen výstup pro zpětné přehrání ve vnějším nástroji
 * (standardní PDN je přehratelný v libovolném nástroji na dámu).
 *
 * Záznam je ANONYMNÍ (GDPR): nese jen tahy + výsledek + čas v UTC. Přezdívky
 * hráčů ani session id se NEzapisují – tagy `[White]`/`[Black]` jsou `"?"`.
 *
 * Dvě oddělené odpovědnosti (schválně):
 * - `formatGamePdn` je ČISTÁ funkce (žádné I/O). Nesmyslný vstup (serializace
 *   ještě běžící partie) je programová chyba serveru → padá RangeError, NEmaskuje
 *   se jako I/O problém.
 * - `writeGamePdn` dělá VÝHRADNĚ I/O a nikdy nevyhazuje: selhání zápisu (plný
 *   disk, práva, neexistující adresář) partii neshodí, jen se zaloguje.
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatMove, rulesetForVariant } from '@checkers/rules';
import type { GameResult, Move, VariantId } from '@checkers/rules';

/**
 * Lidský název varianty pro tag `[Event]` (fáze 103). `[Variant]` nese strojové
 * id (viz {@link formatGamePdn}); Event je čitelný titulek pro vnější PDN nástroje.
 * Úplná mapa přes `Record<VariantId, string>` – přidání varianty bez názvu tu je
 * chyba překladu, ne tichá díra.
 */
const EVENT_NAME: Record<VariantId, string> = {
  american: 'American Checkers',
  pool: 'Pool Checkers',
  russian: 'Russian Draughts',
  czech: 'Czech Draughts',
};

/**
 * Výsledkový token PDN. Černý začíná a je v movetextu první; standardní PDN
 * skóre `1-0` = vyhrál White, `0-1` = vyhrál Black.
 */
const RESULT_TOKEN: Record<Exclude<GameResult, 'ongoing'>, string> = {
  'black-wins': '0-1',
  'white-wins': '1-0',
  draw: '1/2-1/2',
};

/** Dvojmístné číslo s vedoucí nulou (den/měsíc/hodina/minuta/sekunda). */
function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Datum pro tag `[UTCDate "YYYY.MM.DD"]` v UTC (ne lokální čas serveru). */
function formatUtcDate(date: Date): string {
  return `${String(date.getUTCFullYear())}.${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`;
}

/** Čas pro tag `[UTCTime "HH:MM:SS"]` v UTC. */
function formatUtcTime(date: Date): string {
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

/**
 * Sestaví anonymní PDN celé partie: STR tagy + movetext s full-move číslováním
 * (černý+bílý půltah pod jedním číslem, černý začíná) + výsledkový token.
 * Každý číslovaný tah je na SAMOSTATNÉM řádku (čitelnost); PDN je vůči bílým
 * znakům v movetextu tolerantní, takže zůstává parseovatelný. Lichý počet
 * půltahů (partie končí po tahu černého) → poslední řádek nese jen jeden půltah.
 *
 * Bez jmen hráčů (GDPR): `[White "?"]` / `[Black "?"]`. Čas je v UTC
 * (`[UTCDate]`/`[UTCTime]`), aby záznam nezávisel na časové zóně serveru.
 *
 * `result === 'ongoing'` je NEplatný vstup (archivuje se jen dokončená partie)
 * a vyhodí RangeError – tiše zapsat rozehranou partii jako „hotovou" by byla
 * horší chyba než hlasitý pád.
 *
 * `variant` (fáze 103) rozhoduje o DVOU věcech: (1) do PDN se zapíše tag
 * `[Variant "<id>"]` + odpovídající `[Event]` (vize „do PDN se zapisuje i
 * varianta"); (2) `formatMove` dostane RULESET té varianty – u létavé dámy
 * (ruská/česká/pool) je dlouhý tah dámy `26-10` legální a bez správného rulesetu
 * by ho `formatMove` odmítl jako teleport (RangeError). Default 'american' drží
 * zpětnou kompatibilitu volajících bez varianty.
 */
export function formatGamePdn(
  moves: readonly Move[],
  result: GameResult,
  date: Date,
  variant: VariantId = 'american',
): string {
  if (result === 'ongoing') {
    throw new RangeError('formatGamePdn: nelze archivovat rozehranou partii (result "ongoing")');
  }
  const token = RESULT_TOKEN[result];
  const ruleset = rulesetForVariant(variant);
  const tags = [
    `[Event "${EVENT_NAME[variant]}"]`,
    '[Site "local"]',
    `[UTCDate "${formatUtcDate(date)}"]`,
    `[UTCTime "${formatUtcTime(date)}"]`,
    '[Round "-"]',
    '[White "?"]',
    '[Black "?"]',
    `[Variant "${variant}"]`,
    `[Result "${token}"]`,
  ].join('\n');

  // Jeden číslovaný tah (pár půltahů) na řádek. Výsledkový token na vlastním
  // posledním řádku movetextu. `formatMove` s rulesetem varianty – jinak by
  // létavý tah dámy spadl na „teleport".
  const lines: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNo = i / 2 + 1;
    const black = formatMove(moves[i]!, ruleset);
    const white = i + 1 < moves.length ? formatMove(moves[i + 1]!, ruleset) : undefined;
    lines.push(white === undefined ? `${String(moveNo)}. ${black}` : `${String(moveNo)}. ${black} ${white}`);
  }
  lines.push(token);
  const movetext = lines.join('\n');

  return `${tags}\n\n${movetext}\n`;
}

/**
 * Atomicky zapíše PDN jako `<id>.pdn` do `dir`. Zápis jde nejdřív do
 * `<id>.pdn.tmp` v TÉMŽE adresáři a pak `rename` na finální jméno – rename je
 * na stejném filesystému atomický, takže čtenář nikdy neuvidí půlku souboru.
 *
 * NIKDY nevyhazuje. Při selhání zaloguje přes `console.error` a pokusí se
 * uklidit případný `.tmp` (ať po sobě nenechá půlnedopsaný soubor). `try`
 * obaluje výhradně I/O – žádnou programovou chybu tu nemaskujeme.
 */
export async function writeGamePdn(dir: string, id: string, pdn: string): Promise<void> {
  const finalPath = join(dir, `${id}.pdn`);
  const tmpPath = `${finalPath}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, pdn, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    console.error(`Nepodařilo se archivovat PDN partie ${id}:`, err);
    // Úklid rozdělaného .tmp. Když neexistuje (selhalo už mkdir/writeFile),
    // unlink taky selže – to je v pořádku, spolkneme to.
    try {
      await unlink(tmpPath);
    } catch {
      /* .tmp nemusí existovat – nic k úklidu */
    }
  }
}
