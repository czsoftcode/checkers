---
phase: 99
verdict: done
steps:
  - title: "Ruleset kingCapturePriority + CZECH_RULESET"
    status: done
  - title: "legalMoves: filtr priority dámy"
    status: done
  - title: "Golden testy priority (obě strany)"
    status: done
  - title: "Perft brána: česká == americká + neměnnost ostatních"
    status: done
---

# Phase 99 — report z auto session

Fáze C dokončena: česká varianta = létavá dáma + kvalitativní priorita braní dámou.

## Co se udělalo
- **Ruleset**: nové pole `kingCapturePriority: boolean` (interface + JSDoc). `CZECH_RULESET` (`manCaptureBackward:false`, `king:'flying'`, `promoteMidCapture:false`, `kingCapturePriority:true`) jako prod const, export z `index.ts`. Ostatní tři rulesety dostaly `kingCapturePriority:false`.
- **legalMoves** (public gate): po nasbírání skoků – je-li `ruleset.kingCapturePriority` a existuje-li skok, jehož kámen na `move.from` je dáma, vrátí se JEN skoky dámou; jinak beze změny. Filtr žije jen v `legalMoves`, stavební bloky (`jumpMovesFrom` atd.) nedotčené. Předpoklad „druh táhnoucího kamene = kind na `move.from`" drží proto, že česká nemá proměnu uprostřed braní (druh kamene je po celou sekvenci konstantní).
- **Golden testy** (`czech-king-priority.test.ts`, 11 testů): černý i bílý na tahu, pozice kde bere dáma i muž → jen skok dámou; pozice kde dáma brát nemůže → muž bere normálně; kontrola `applyMove` výsledné desky u všech. Zuby: tytéž pozice s rulesetem lišícím se JEN vypnutou prioritou vrátí i skok mužem (dokazuje, že skok mužem existuje a odstranil ho filtr, ne jeho absence).
- **Perft brána** (`perft-czech.test.ts`): česká otevírací perft 1–6 == americká čísla (7/49/302/1469/7361/36768) = zadarmo cross-check `manCaptureBackward=false`; zuby proti pool (hloubka 5: 7361 ≠ 7482). Americká/pool/ruská perft beze změny (jejich existující testy prošly).

## Kontrakt mezi moduly (přidání povinného pole)
Přidání povinného `kingCapturePriority` rozbilo TS literály `Ruleset` v pěti test souborech (`ruleset-seam`, `flying-apply`, `flying-notation` ×2, `flying-capture`) – doplněno. Mimo `packages/rules` se `Ruleset` nikde nekonstruuje jako literál (konzumenti berou parametr / default `AMERICAN_RULESET`), typecheck napříč všemi 6 balíčky prošel.

## Ověření
- `pnpm lint` čistý, `pnpm typecheck` (6 balíčků) OK, `packages/rules` testy 369/369.
- Nezávislý adversariální sub-agent (čerstvý kontext): žádná vážná chyba. Potvrdil korektnost filtru, unhappy path (poškozená deska / díra → `RangeError` přes `cellAt`, žádný tichý „konec hry"), cross-module kontrakt i ručně přepočítanou geometrii golden pozic (žádný skrytý druhý skok). Jeho jediný legitimní nález – zastaralá hlavička v `ruleset.ts`, která tvrdila, že priorita/`promoteMidCapture` se teprve dolijí – opraven.

## Vědomé hranice (nejsou to nedodělky)
- **perft-czech je slabá brána priority/létavosti**: v otevírací hloubce 1–6 žádná dáma nevznikne, takže priorita ani létavá dáma se v tomto testu nespustí – ověřuje POUZE `manCaptureBackward`. To je v hlavičce souboru přiznáno; prioritu/létavost kryjí golden testy (`czech-king-priority`, `flying-*`), ne perft. Odpovídá řezu fáze (hlubší crafted priority perft jen „pokud levný přes rozšířený perftRef" – oracle prioritu neumí, mimo řez).
- **Pravidla české** zafixována proti potvrzení uživatele (český hráč) + brainking.com, NE převzata z todo 58 (to předpokládalo „muž bere dozadu jako pool" = špatně).
