/**
 * Kniha zahájení (fáze 56–58) – statická read-only tabulka pozice → kandidátní
 * tahy.
 *
 * Slouží plnosilovému soupeři (viz `levelUsesBook` v levels.ts): než engine
 * začne hledat, server nahlédne sem a je-li pozice v knize, zahraje knižní tah
 * bez volání enginu. Server knize NEVĚŘÍ o nic víc než enginu – knižní tah se
 * stejně ověří přes `findLegalMove`, nelegální/chybějící se zahodí a hledá se
 * normálně (viz app.ts).
 *
 * Klíč je `positionKey` z rules (strana na tahu + obsah 32 polí), NE Zobrist:
 * lookup je jednou za tah, žádný tlak na rychlost, a plná serializace nemá
 * kolizní riziko (hash má). Seed se NEpíše jako ručně nabušené klíče ani jako
 * 32-buňkové desky – buduje se PŘEHRÁNÍM tahů reálnými pravidly od výchozí
 * pozice, takže klíče i tahy pocházejí z jednoho zdroje (rules) a nemůžou se
 * rozejít s tím, co server v provozu klíčuje.
 *
 * VÍC KANDIDÁTŮ NA POZICI (fáze 57): hodnota je SEZNAM tahů. Reálná teorie se
 * větví (na tutéž pozici víc dobrých pokračování). Kandidáti se hromadí,
 * identické tahy se dedupují; výběr při lookupu je DETERMINISTICKÝ (první
 * vložený), viz `lookupBookMove`.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 11-15 (fáze 58): seed nese hlavní odpovědi bílého
 * na první tah černého 11-15 (Single Corner 22-18, 23-19, Kelso 24-20, 21-17,
 * 23-18, 22-17) do ~8 půltahů. Zdroj: Richard Pask, „Complete Checkers" (volné
 * PDF, checkermaven.com), trunk/drawn linie sekce 11-15. KAŽDÝ půltah je ověřen
 * přehráním přes reálná pravidla (`buildBook` páruje `from`+dopadové pole proti
 * `legalMoves`, právě jedna shoda – jinak Error). Braní je v zahájení běžné
 * (výměny), proto se páruje přes dopad, ne jako prostý tah.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 9-13 (fáze 59): druhý naplněný první tah černého.
 * Seed nese 6 hlavních odpovědí bílého na 9-13 (21-17, 22-17, 22-18, 23-18,
 * 24-19, 23-19) do ~8 půltahů, z Pask Část 1 (9-13s), trunk příslušných ballotů.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 9-14 (fáze 60): třetí naplněný první tah černého.
 * Seed nese 6 hlavních odpovědí bílého na 9-14 (22-17, 22-18, 23-18, 23-19,
 * 24-19, 24-20) do ~8 půltahů, z Pask Část 2 (9-14s), trunk ballotů 26/30/34/
 * 35/39/42. Výchozí pozice má tak nově 3 kandidáty prvního tahu: 11-15 (první
 * vložený, deterministicky vybraný), 9-13 a 9-14. Pozice po 9-14 (engine=bílý)
 * má 6 kandidátů (po 9-13 rovněž 6).
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 10-14 (fáze 61): čtvrtý naplněný první tah černého.
 * Seed nese 6 hlavních odpovědí bílého na 10-14 (22-17, 22-18, 23-18, 23-19,
 * 24-19, 24-20) do ~8 půltahů, z Pask Část 3 (10-14s), trunk ballotů 45/47/50/
 * 50B/53/58. U 23-19 první ballot 50A svým trunkem transponuje do 7-10 (T) a
 * 24-20 první ballot 57 je krátký transpoziční stub („INTO … V15"); pro obě
 * odpovědi se proto bere první ballot s VLASTNÍM samostatným trunkem (50B, resp.
 * 58) – stejně jako fáze 60 přeskočila transpoziční linie. Výchozí
 * pozice má tak nově 4 kandidáty prvního tahu: 11-15 (první vložený,
 * deterministicky vybraný), 9-13, 9-14 a 10-14. Pozice po 10-14 (engine=bílý)
 * má 6 kandidátů.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 10-15 (fáze 62): pátý naplněný první tah černého.
 * Seed nese 7 hlavních odpovědí bílého na 10-15 (21-17, 22-17, 22-18, 23-18,
 * 23-19, 24-19, 24-20) do ~8 půltahů, z Pask Část 4 (10-15s), trunk prvních
 * ballotů 62/67/72/73/78/80/81. POZOR – ODLIŠNÉ OD FÁZÍ 58-61: 10-15 má právě
 * 7 legálních odpovědí bílého a seed pokrývá VŠECHNY, takže žádná bílá odpověď
 * z knihy nevypadne (u 9-13/9-14/10-14 vždy jedna zbývala). Výchozí pozice má
 * tak nově 5 kandidátů prvního tahu: 11-15 (první vložený, deterministicky
 * vybraný), 9-13, 9-14, 10-14 a 10-15. Pozice po 10-15 (engine=bílý) má
 * 7 kandidátů (nejvíc ze všech naplněných prvních tahů).
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 11-16 (fáze 63): šestý naplněný první tah černého.
 * Seed nese 7 hlavních odpovědí bílého na 11-16 (21-17, 22-17, 22-18, 23-18,
 * 23-19, 24-19, 24-20) do ~8 půltahů, z Pask Část 6 (11-16s), trunk prvních
 * ballotů 105/110/113/117/121A/122/125. Jako 10-15 (fáze 62) má i 11-16 právě
 * 7 legálních odpovědí bílého a seed pokrývá VŠECHNY → žádná bílá odpověď
 * z knihy nevypadne; první kandidát bílého po 11-16 je 21-17 (ballot 105). DVĚ
 * ODCHYLKY od „prostě první ballot": (a) u 24-20 je první ballot 124A
 * transpoziční stub (trunk „INTO 12-16 24-20; 8-12" po 5 půltazích, do
 * mimorozsahového 12-16), proto se bere první 24-20 ballot s VLASTNÍM trunkem =
 * 125 (jako fáze 61 vzala 50B/58 místo stubů); (b) u 21-17 (ballot 105) trunk
 * transponuje do 10-15 už po 7 půltazích, takže tato JEDNA linie má 7 (ne 8)
 * půltahů. U 23-19 (ballot 121A) je černého třetí půltah 16-23 VYNUCENÉ braní
 * (bílý 23-19 nastaví kámen na 19, který černý musí sebrat). Výchozí pozice má
 * tak nově 6 kandidátů prvního tahu: 11-15 (první vložený, deterministicky
 * vybraný), 9-13, 9-14, 10-14, 10-15 a 11-16. Pozice po 11-16 (engine=bílý) má
 * 7 kandidátů (jako po 10-15).
 *
 * ROZSAH / VĚDOMĚ ODLOŽENO: zrcadlová symetrie desky (kniha netrefí zrcadlené
 * pozice); náhodný výběr pro variabilitu (zatím deterministicky); zbývající
 * první tah černého (12-16). „Complete Checkers" je
 * kniha 3-move; hlubší čistě-GAYP odbočky mimo trunk zde nejsou.
 */

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move, Position, Square } from '@checkers/rules';

/**
 * Kniha zahájení: klíč `positionKey` → seznam kandidátních tahů (≥ 1, nikdy
 * prázdný). Pořadí v seznamu = pořadí vložení (viz `buildBook`); na tom stojí
 * deterministický výběr.
 */
export type OpeningBook = ReadonlyMap<string, readonly Move[]>;

/**
 * Jedno zahájení jako sekvence půltahů `[from, to]` od výchozí pozice, kde `to`
 * je CÍLOVÉ (dopadové) pole – u braní pole dopadu, ne mezipole. Braní i prosté
 * tahy se tak zapisují stejně; `buildBook` je rozliší párováním proti
 * `legalMoves`. (Stejná konvence jako `Ply.to` v rules/openings.ts.)
 */
type OpeningLine = readonly (readonly [Square, Square])[];

/**
 * Seed: komplex 11-15 z Pask, „Complete Checkers", sekce 11-15 (trunk/drawn).
 * Každá linie = 11-15 + jedna hlavní odpověď bílého + hlavní pokračování do
 * ~8 půltahů. Pokrývá OBĚ barvy enginu: výchozí pozice (engine=černý začíná
 * 11-15) i pozice po 11-15 (engine=bílý odpovídá). Komentář nese původní zdroj.
 * Legalitu KAŽDÉHO půltahu vynutí `buildBook` při načtení modulu.
 */
const SEED_LINES: readonly OpeningLine[] = [
  // Single Corner (11-15 22-18) – Pask CC, řádek 13757. Výměna 15x22 25x18.
  [[11, 15], [22, 18], [15, 22], [25, 18], [12, 16], [29, 25], [9, 13], [18, 14]],
  // 11-15 23-19; 8-11 – Pask CC, řádek 14699.
  [[11, 15], [23, 19], [8, 11], [22, 17], [11, 16], [24, 20], [16, 23], [27, 11]],
  // Kelso (11-15 24-20) – Pask CC, řádek 16170.
  [[11, 15], [24, 20], [15, 18], [22, 15], [10, 19], [23, 16], [12, 19], [25, 22]],
  // 11-15 21-17; 8-11 – Pask CC, řádek 13037.
  [[11, 15], [21, 17], [8, 11], [17, 13], [9, 14], [22, 18], [15, 22], [25, 9]],
  // 11-15 23-18; 9-14 – Pask CC, řádek 14191.
  [[11, 15], [23, 18], [9, 14], [18, 11], [8, 15], [22, 18], [15, 22], [25, 9]],
  // 11-15 22-17; 15-18 – Pask CC, řádek 13518.
  [[11, 15], [22, 17], [15, 18], [23, 14], [9, 18], [17, 14], [10, 17], [21, 14]],
  // --- KOMPLEX 9-13 (fáze 59): 6 hlavních odpovědí bílého na první tah 9-13.
  // Pask „Complete Checkers", Část 1 (9-13s); trunk (hlavní linie) uvedených
  // ballotů, prvních ~8 půltahů. 11-15 linie výše zůstávají PRVNÍ → deterministický
  // první kandidát na výchozí pozici je dál 11-15; 9-13 je druhý kandidát.
  // 9-13 21-17; 5-9 – Ballot 1. Prosté tahy, bez braní.
  [[9, 13], [21, 17], [5, 9], [25, 21], [11, 15], [29, 25], [9, 14], [23, 18]],
  // 9-13 22-17; 13-22 – Ballot 3. Výměna 13x22 25x18, pak 18x11 8x15.
  [[9, 13], [22, 17], [13, 22], [25, 18], [11, 15], [18, 11], [8, 15], [21, 17]],
  // 9-13 22-18; 6-9 – Ballot 4. Končí bílého braním 18x11.
  [[9, 13], [22, 18], [6, 9], [25, 22], [1, 6], [24, 19], [11, 15], [18, 11]],
  // 9-13 23-18; 5-9 – Ballot 8. Prosté tahy, bez braní.
  [[9, 13], [23, 18], [5, 9], [26, 23], [11, 16], [30, 26], [10, 14], [24, 19]],
  // 9-13 24-19; 5-9 – Ballot 17. Výměna 22-18 15x22 25x18.
  [[9, 13], [24, 19], [5, 9], [28, 24], [11, 15], [22, 18], [15, 22], [25, 18]],
  // 9-13 23-19; 5-9 – Ballot 13. Výměna 22-18 15x22 25x18.
  [[9, 13], [23, 19], [5, 9], [27, 23], [11, 15], [22, 18], [15, 22], [25, 18]],
  // --- KOMPLEX 9-14 (fáze 60): 6 hlavních odpovědí bílého na první tah 9-14.
  // Pask „Complete Checkers", Část 2 (9-14s); trunk (hlavní linie) uvedených
  // ballotů, prvních ~8 půltahů. 11-15 linie výše zůstávají PRVNÍ → deterministický
  // první kandidát na výchozí pozici je dál 11-15; 9-14 je třetí kandidát (za 9-13).
  // 9-14 22-17; 5-9 – Ballot 26. Výměna 14-17 21x14, pak černý bere zpět 9x25 29x22.
  [[9, 14], [22, 17], [5, 9], [17, 13], [1, 5], [25, 22], [14, 17], [21, 14]],
  // 9-14 22-18; 5-9 – Ballot 30. Výměna 10x19 24x15 (18-15 break).
  [[9, 14], [22, 18], [5, 9], [25, 22], [11, 16], [18, 15], [10, 19], [24, 15]],
  // 9-14 23-18; 14-23 – Ballot 34. Vynucené braní 14x23 27x18, pak 10x17 21x14.
  [[9, 14], [23, 18], [14, 23], [27, 18], [12, 16], [18, 14], [10, 17], [21, 14]],
  // 9-14 23-19; 5-9 – Ballot 35. Výměna 22-18 15x22 25x18.
  [[9, 14], [23, 19], [5, 9], [27, 23], [11, 15], [22, 18], [15, 22], [25, 18]],
  // 9-14 24-19; 11-15 – Ballot 39. Dvojitá výměna 15x24, 18x9 5x14, 28x19.
  [[9, 14], [24, 19], [11, 15], [22, 18], [15, 24], [18, 9], [5, 14], [28, 19]],
  // 9-14 24-20; 10-15 – Ballot 42. Prosté tahy, bez braní (do Key Landing 19).
  [[9, 14], [24, 20], [10, 15], [22, 17], [7, 10], [25, 22], [3, 7], [29, 25]],
  // --- KOMPLEX 10-14 (fáze 61): 6 hlavních odpovědí bílého na první tah 10-14.
  // Pask „Complete Checkers", Část 3 (10-14s); trunk (hlavní linie) uvedených
  // ballotů, prvních ~8 půltahů. 11-15 linie výše zůstávají PRVNÍ → deterministický
  // první kandidát na výchozí pozici je dál 11-15; 10-14 je čtvrtý kandidát (za 9-14).
  // 10-14 22-17; 7-10 – Ballot 45 (Pask řádek 6988). Výměna 14-17 21x14.
  [[10, 14], [22, 17], [7, 10], [17, 13], [3, 7], [25, 22], [14, 17], [21, 14]],
  // 10-14 22-18; 6-10 – Ballot 47 (Pask řádek 7794). Výměna 11-15 18x11 8x15.
  [[10, 14], [22, 18], [6, 10], [25, 22], [11, 15], [18, 11], [8, 15], [29, 25]],
  // 10-14 23-18; 14-23 – Ballot 50 (Pask řádek 8403). Vynucené braní 14x23 27x18.
  [[10, 14], [23, 18], [14, 23], [27, 18], [12, 16], [32, 27], [16, 20], [26, 23]],
  // 10-14 23-19; 7-10 – Ballot 50B (Pask řádek 8555; 50A trunk transponuje do
  // 7-10 (T), proto se bere první ballot 23-19 s vlastním diagramem = 50B).
  // Trojitá výměna 11x18 22x15, 10x19 24x15.
  [[10, 14], [23, 19], [7, 10], [19, 15], [11, 18], [22, 15], [10, 19], [24, 15]],
  // 10-14 24-19; 6-10 – Ballot 53 (Pask řádek 8977). Výměna 13x22, pak bílý 25x9.
  [[10, 14], [24, 19], [6, 10], [22, 17], [9, 13], [28, 24], [13, 22], [25, 9]],
  // 10-14 24-20; 7-10 – Ballot 58 (Pask řádek 9502; 57 je transpoziční stub).
  // Výměna 11-16 20x11 8x22 25x18.
  [[10, 14], [24, 20], [7, 10], [22, 18], [11, 16], [20, 11], [8, 22], [25, 18]],
  // --- KOMPLEX 10-15 (fáze 62): 7 hlavních odpovědí bílého na první tah 10-15.
  // Pask „Complete Checkers", Část 4 (10-15s); trunk (hlavní linie) prvních
  // ballotů 62/67/72/73/78/80/81, prvních ~8 půltahů. 11-15 linie výše zůstávají
  // PRVNÍ → deterministický první kandidát na výchozí pozici je dál 11-15; 10-15
  // je pátý kandidát (za 10-14). POZOR: 10-15 pokrývá VŠECH 7 legálních odpovědí
  // bílého, takže žádná bílá odpověď z knihy nevypadne (fáze 58-61 měly vždy
  // jednu nepokrytou); první kandidát bílého po 10-15 je 21-17 (Pask ballot 62).
  // 10-15 21-17; 6-10 – Ballot 62 (Pask řádek 9868). Řetěz braní 9x18 23x14 10x17 22x13.
  [[10, 15], [21, 17], [6, 10], [17, 14], [9, 18], [23, 14], [10, 17], [22, 13]],
  // 10-15 22-17; 6-10 – Ballot 67 (Pask řádek 10757). Řetěz braní 9x18 23x14 10x17 21x14.
  [[10, 15], [22, 17], [6, 10], [17, 14], [9, 18], [23, 14], [10, 17], [21, 14]],
  // 10-15 22-18; 15-22 – Ballot 72 (Pask řádek 11566). Výměna 15x22 25x18, pak bílý 18x11.
  [[10, 15], [22, 18], [15, 22], [25, 18], [9, 13], [29, 25], [11, 15], [18, 11]],
  // 10-15 23-18; 6-10 – Ballot 73 (Pask řádek 11688). Braní 9x18, 15x24, bílý dvojité 22x6.
  [[10, 15], [23, 18], [6, 10], [18, 14], [9, 18], [24, 19], [15, 24], [22, 6]],
  // 10-15 23-19; 6-10 – Ballot 78 (Pask řádek 12343). Prosté tahy (closed line).
  [[10, 15], [23, 19], [6, 10], [22, 17], [1, 6], [25, 22], [11, 16], [29, 25]],
  // 10-15 24-19; 15-24 – Ballot 80 (Pask řádek 12600). Výměna 15x24 28x19.
  [[10, 15], [24, 19], [15, 24], [28, 19], [6, 10], [22, 17], [9, 14], [25, 22]],
  // 10-15 24-20; 6-10 – Ballot 81 (Pask řádek 12705). Prosté tahy.
  [[10, 15], [24, 20], [6, 10], [28, 24], [1, 6], [23, 18], [12, 16], [32, 28]],
  // --- KOMPLEX 11-16 (fáze 63): 7 hlavních odpovědí bílého na první tah 11-16.
  // Pask „Complete Checkers", Část 6 (11-16s); trunk (hlavní linie) prvních
  // ballotů 105/110/113/117/121A/122/125, prvních ~8 půltahů. 11-15 linie výše
  // zůstávají PRVNÍ → deterministický první kandidát na výchozí pozici je dál
  // 11-15; 11-16 je šestý kandidát (za 10-15). Jako 10-15 (fáze 62) pokrývá
  // 11-16 VŠECH 7 legálních odpovědí bílého; první kandidát bílého je 21-17.
  // 11-16 21-17; 7-11 – Ballot 105 (Pask řádek 16180). Řetěz braní 10x17 22x13,
  // pak 11-15; trunk pak transponuje do 10-15 → tato linie má JEN 7 půltahů.
  [[11, 16], [21, 17], [7, 11], [17, 14], [10, 17], [22, 13], [11, 15]],
  // 11-16 22-17; 7-11 – Ballot 110 (Pask řádek 16642). Čtyřtahový řetěz braní
  // 10x17 21x14 9x18 23x14 (Attack #1).
  [[11, 16], [22, 17], [7, 11], [17, 14], [10, 17], [21, 14], [9, 18], [23, 14]],
  // 11-16 22-18; 7-11 – Ballot 113 (Pask řádek 16991). Prosté tahy do výměny 24x15.
  [[11, 16], [22, 18], [7, 11], [25, 22], [3, 7], [29, 25], [16, 19], [24, 15]],
  // 11-16 23-18; 7-11 – Ballot 117 (Pask řádek 17452). Řetěz braní 11x18 22x15 10x19 24x15.
  [[11, 16], [23, 18], [7, 11], [18, 15], [11, 18], [22, 15], [10, 19], [24, 15]],
  // 11-16 23-19; 16-23 – Ballot 121A (Pask řádek 17925). Černý VYNUCENĚ bere 16x23
  // (bílý 23-19 nastaví kámen na 19), bílý zpět 26x19.
  [[11, 16], [23, 19], [16, 23], [26, 19], [8, 11], [27, 23], [11, 15], [22, 18]],
  // 11-16 24-19; 7-11 – Ballot 122 (Pask řádek 18078). Prosté tahy do výměny 18x11.
  [[11, 16], [24, 19], [7, 11], [22, 18], [3, 7], [25, 22], [11, 15], [18, 11]],
  // 11-16 24-20; 16-19 – Ballot 125 (Pask řádek 18610; 124A je transpoziční stub
  // do 12-16, proto 125). Výměna 16-19 23x16 12x19, pak 18x9.
  [[11, 16], [24, 20], [16, 19], [23, 16], [12, 19], [22, 18], [9, 14], [18, 9]],
];

/** Úplná shoda tahů (from + path + captures) pro dedup kandidátů v seedu. */
function movesEqual(a: Move, b: Move): boolean {
  return (
    a.from === b.from &&
    a.path.length === b.path.length &&
    a.path.every((sq, i) => sq === b.path[i]) &&
    a.captures.length === b.captures.length &&
    a.captures.every((sq, i) => sq === b.captures[i])
  );
}

/**
 * Postaví knihu přehráním linií reálnými pravidly. Každý půltah `[from, to]`
 * spáruje proti `legalMoves(pozice)` přes `from` a DOPADOVÉ pole (`path[last]`);
 * musí sedět PRÁVĚ JEDNA legální shoda – jinak Error (fail loud). Tím se řeší:
 *  - braní (dopad ≠ sousední pole) i prosté tahy jednotně,
 *  - překlep v datech (nelegální tah = 0 shod → Error),
 *  - nejednoznačnost (dvě různé cesty se stejným dopadem = 2 shody → Error),
 * takže se do knihy nikdy nedostane špatný nebo dvojznačný tah tiše.
 * (Stejná párovací logika jako `playBallot` v rules – sdílený kontrakt.)
 *
 * Víc linií smí sdílet pozici a nabídnout RŮZNÉ tahy → víc kandidátů. Identický
 * tah na téže pozici se dedupuje. Exportováno kvůli testům se zuby.
 */
export function buildBook(lines: readonly OpeningLine[]): OpeningBook {
  const book = new Map<string, Move[]>();
  for (const line of lines) {
    let position = initialPosition();
    for (const [from, to] of line) {
      const matches = legalMoves(position).filter(
        (m) => m.from === from && m.path[m.path.length - 1] === to,
      );
      const [move, extra] = matches;
      if (move === undefined || extra !== undefined) {
        throw new Error(
          `Seed knihy zahájení: půltah ${String(from)}->${String(to)} má ${String(matches.length)} legálních shod (očekávána právě 1).`,
        );
      }
      const key = positionKey(position);
      const candidates = book.get(key);
      if (candidates === undefined) {
        book.set(key, [move]);
      } else if (!candidates.some((c) => movesEqual(c, move))) {
        candidates.push(move); // nový kandidát na známé pozici (větvení)
      }
      // else: identický tah už v seznamu → dedup, nic (shodný prefix linií)
      position = applyMove(position, move);
    }
  }
  return book;
}

/** Výchozí kniha zahájení serveru. */
export const OPENING_BOOK: OpeningBook = buildBook(SEED_LINES);

/**
 * Knižní tah pro pozici, nebo `undefined`, když pozice v knize není. Při víc
 * kandidátech vybírá DETERMINISTICKY první vložený (pořadí ze `buildBook`) –
 * náhodný výběr pro variabilitu je mimo rozsah. Volající MUSÍ vrácený tah ještě
 * ověřit proti pravidlům (`findLegalMove`) – kniha je data, ne autorita.
 */
export function lookupBookMove(book: OpeningBook, position: Position): Move | undefined {
  return book.get(positionKey(position))?.[0];
}
