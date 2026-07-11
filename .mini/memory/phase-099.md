# Phase 99 — Česká: priorita braní dámou

**Goal:** Přidat kingCapturePriority do Ruleset + CZECH_RULESET prod const (létavá dáma + priorita braní dámou); filtr v legalMoves - existuje-li legální skok dámou, vypustit všechny skoky mužem. Přesná česká pravidla (bere muž dozadu? manCaptureBackward + přesná definice priority) ZAFIXOVAT proti JEDNOMU zdroji, NEpřebírat 'totéž jako pool' z todo (může být špatně - řada zdrojů uvádí, že český muž bere jen vpřed). Brána: česká perft proti zafixovanému zdroji + golden testy priority; americká/pool/ruská beze změny čísel. Dokončuje fázi C. Řez z todo 58.

## Steps
- [done] Ruleset kingCapturePriority + CZECH_RULESET
- [done] legalMoves: filtr priority dámy
- [done] Golden testy priority (obě strany)
- [done] Perft brána: česká == americká + neměnnost ostatních

## Auto-commit
- Phase 99: Česká: priorita braní dámou

## Discussion
# Phase 99 — Česká: priorita braní dámou

## Intent
Přidat českou variantu = létavá dáma + priorita braní dámou (kvalitativní přednost dámy). Dokončuje
fázi C (americká, pool, ruská už hotové). Mechanika snadná (filtr v legalMoves), riziko bylo jen ve
správném opsání pravidel — vyjasněno s uživatelem (český hráč) + zdroj.

## Key decisions
- **Česká pravidla POTVRZENA uživatelem (český hráč) + zdroj brainking.com/cz/GameRules?tp=29
  (do fixtures jako reference; přes WebFetch se stránka nenačetla, platí potvrzení uživatele):**
  1. **Kámen (muž) bere JEN VPŘED** (manCaptureBackward = FALSE) — na rozdíl od ruské/pool. Todo 58
     předpokládalo „totéž co pool" (dozadu) → BYLO ŠPATNĚ.
  2. **Dáma je LÉTAVÁ** (king = 'flying').
  3. **Braní povinné + priorita dámy:** existuje-li tah, kde bere DÁMA, hráč MUSÍ brát dámou (všechny
     tahy braním mužem se vypustí). ŽÁDNÉ pravidlo maxima (nemusí brát nejvíc) — jen kvalitativní
     přednost dámy.
  4. **Proměna NA KONCI tahu** (promoteMidCapture = FALSE), NE uprostřed vícenásobného braní (na rozdíl
     od ruské).
- **CZECH_RULESET:** manCaptureBackward:false, king:'flying', promoteMidCapture:false,
  kingCapturePriority:true. Nové Ruleset pole: `kingCapturePriority: boolean` (ostatní varianty false).
- **ŽÁDNÁ nová cesta generátoru.** Český muž bere vpřed krok-2 = STÁRÁ extendJumps (jako pool, immediate
  removal, parita drží — muž nepromuje uprostřed). Česká dáma = extendFlyingKingJumps. Proměna = dnešní
  apply (konec tahu). Jediný NOVÝ kód: filtr priority + CZECH_RULESET + pole. Menší fáze, než zněl cíl.
- **Filtr priority v legalMoves (public gate), NE v stavebních blocích.** Po nasbírání všech skoků:
  je-li ruleset.kingCapturePriority a existuje-li skok, jehož táhnoucí kámen (piece na move.from) je
  DÁMA → ponechat jen skoky dámou. Protože česká nemá mid-capture promotion, druh táhnoucího kamene je
  po celou sekvenci konstantní → stačí kind kamene na move.from.

## Watch out for
- **Opening perft = zadarmo cross-check bitu manCaptureBackward.** Muž jen vpřed + žádné dámy brzy →
  česká otevírací perft musí v mělkých hloubkách SEDNOUT NA AMERICKÁ čísla (7/49/302/1469/7361/36768).
  Kdyby seděla na pool, muž bere dozadu = špatně. Divergence od americké až hluboko (první dáma/létavost).
- **Priorita se opening perftem NEOVĚŘÍ** (žádné dámy brzy). Nutné RUČNĚ postavené pozice s dámou, kde
  může brát dáma I muž → legální jen skoky dámou (a bez dámy-braní se muž bere normálně). Golden +
  ověřit apply obou stran.
- **Perft zdroj:** česká publikovaná perft čísla nemusí existovat; opening = shoda s americkou (dokud
  se létavost/priorita neprojeví), hlubší/crafted = druhá implementace nebo ruční počty (jako fáze 96/98).
- **americká/pool/ruská beze změny čísel** — kingCapturePriority defaultně false, filtr se jich netýká.
- **Priorita = jen kvalita (dáma>muž), NE kvantita/maximum** — nepřidávat maximum (non-goal vlny).

## Run report
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
