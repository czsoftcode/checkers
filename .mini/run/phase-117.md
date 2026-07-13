---
phase: 117
verdict: done
steps:
  - title: "Protáhnout variantu do renderu + výběr URL"
    status: done
  - title: "CSS pravidla pro italskou (CSP-safe)"
    status: done
  - title: "Testy: výběr assetů podle varianty"
    status: done
  - title: "Tvrdé vizuální ověření + brána"
    status: done
---

# Fáze 117 — report z auto session

## Co je hotové
Italská varianta ve webovém renderu dostane vlastní assety (deska
`right_game_board.webp`, kameny `red.webp`/`red_queen.webp` místo vnitřních
„black"; „white" sdílené). Ostatní varianty jsou vizuálně netknuté. Do
`packages/rules/src` se nesáhlo – parita polí, číslování, Zobrist i perft beze změny.

**OPRAVA po prvním reportu (uživatel nahlásil špatně umístěné kameny):** discuss
tvrdil, že oba obrázky mají STEJNOU paritu a stačí prohodit asset bez rotace. To bylo
CHYBNĚ. Pixelové měření: `game_board` má tmavá pole na LICHÉ paritě (roh (0,0) světlý,
jas 152), `right_game_board` na SUDÉ (roh tmavý, jas 94) – OPAČNÁ parita. Engine klade
hrací pole na lichou paritu, takže u italského obrázku padla na SVĚTLÉ dřevo → kameny
stály na světlých polích. To je přesně vlast FID („casella in basso a destra nera" +
kameny na „caselle scure").

**Řešení = vizuální rotace renderu (původní záměr projektu):** pro italskou ZRCADLÍM
pořadí SLOUPCŮ v board-view (`colSeq = [...rowSeq].reverse()`). Tím se hrací pole enginu
posunou na sudou vizuální paritu = tmavé dřevo, a roh vpravo dole vyjde tmavý a obsazený
(FID/damiera). Řádky (orientace podle barvy hráče) beze změny. Čistě vizuální posun
pořadí appendu – `data-square`, parita, číslování, klik i validace se dál počítají
z reálných (row,col), engine/Zobrist/perft netknuté. Obrázek desky se NEMĚNÍ (je
správný). Asset-swap + red/white kameny z první verze zůstávají.

### Implementace
- `board-image.ts` / `piece-images.ts`: `enableBoardImage(root, variant, createImage?)`
  a `enablePieceImages(...)` vybírají URL podle varianty (`boardUrlFor`/`pieceUrlsFor`).
  Nové exporty `italianBoardImageUrl`, `italianPieceImageUrls`.
- `board-view.ts`: `createBoardView(..., variant='american')` + nová metoda
  `setVariant(variant)` na `BoardView`. Pro italskou synchronně přidá třídu
  `variant-italian`; assety přednačte podle varianty. Idempotentní.
- `controller.ts` (AIvP): předá `game.variant` do konstruktoru – variantu zná hned.
- `pvp-controller.ts` (PvP): variantu zná AŽ z autoritativního stavu, proto ji deska
  dostává přes `view.setVariant(dto.variant)` v `applyState` (idempotentní no-op po
  prvním stavu).
- `styles.css`: variantně-scoped pravidla `.board.variant-italian.board-img` (pozadí
  right_game_board), `.piece.black` → red.webp, `.piece.black.king` → red_queen.webp.
  Vše přes `url()` (Vite hash) – žádný inline styl (CSP).

## Ověření (mechanické, po opravě)
- **Parita (jádro rizika) – PIXELOVĚ end-to-end:** zrekonstruoval jsem italské vizuální
  mapování a změřil jas dřeva pod všemi 24 počátečními kameny: průměr 71, nejsvětlejší
  pole 98 (< 128) → VŠECHNY kameny na TMAVÉM dřevě. Roh vpravo dole jas 62 (tmavý) a je
  hrací (obsazený) → FID splněno. (V PRVNÍ verzi jsem tohle NEZměřil a spolehl se na
  chybné oko → kameny skončily na světlých polích. Teď měřeno na reálném obrázku.)
- **Testy zuby:** nové jsdom testy ověřují, že každé hrací pole italské leží na sudé
  vizuální paritě a roh vpravo dole je hrací; americká zůstává na liché paritě (regrese).
  Kdyby se zrcadlení sloupců ztratilo, testy padnou. `red.webp` je červený kámen.
- **Build:** `vite build` prošel; `right_game_board`, `red`, `red_queen` se zabalily a
  built CSS `.variant-italian` pravidla míří na správné hashované cesty. Žádný inline styl.
- **Suita:** celá `pnpm test` zelená (rules/engine/cli/ai/server/web), 639 web testů,
  268 engine testů (perft). `tsc` čistý, `eslint` čistý.
- **Interakce v otočené orientaci:** klik i zvýraznění jedou přes čísla polí 1–32 a
  `isDarkSquare`/`coordsToSquare`/validaci, které jsem nezměnil → logicky netknuté a
  kryté stávajícími testy (které dál procházejí). Živé kliknutí v prohlížeči jsem ale
  neodklikal (viz `verify`).

## Nezávislý adversariální self-review
Pustil jsem nezávislého sub-agenta (čerstvý kontext) – cross-module kontrakt, regrese,
async PvP, CSP. **Žádný korektnostní bug ani regrese ostatních variant.** Nálezy:
1. (nízká–střední) PvP: deska se tvoří bez znalosti varianty → konstruktor přednačte
   AMERICKÉ assety a teprve první stav přepne na italskou. U PvP italské = zbytečný
   preload + možný záblesk (americká/prázdná → italská) na pomalé lince. **Vědomě
   ponecháno:** týká se jen PvP italské (sekundární cesta, vyžaduje italskou místnost
   na serveru), NENÍ to regrese, brána (AIvP) je čistá, a odklad načtení pro PvP by
   zavlekl vlastní regresi (bezbarvá deska u VŠECH PvP variant před prvním stavem).
2. (nízká) Žádný test nepočítá počet preloadů → odstranění idempotenčního guardu (perf)
   test nechytne. Guard je triviální (`if next===applied return`), jeho viditelný efekt
   (přepínání třídy) testy hlídají. Ponecháno.
3. (velmi nízká) Testy výběru URL – doplnil jsem NEZÁVISLÉ string-checky (`game_board`
   vs `right_game_board`, `red.webp`/`red_queen.webp`), aby chytly i záměnu OBSAHU
   konstanty, ne jen záměnu za americkou. Opraveno.

## Co zbývá / na co dát pozor
- Živý vizuální gate (screenshot) jsem kvůli síťové izolaci prohlížeče neudělal – viz
  `verify`. Jádro (parita, zarovnání kamenů na tmavé dřevo, tmavé pole vpravo dole) je
  potvrzené přímým čtením obrázků, ne screenshotem z běžící appky.
- Drobný PvP záblesk (nález 1) je vědomé rozhodnutí, ne opomenutí.
