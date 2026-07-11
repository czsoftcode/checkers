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
