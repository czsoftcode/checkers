# Phase 8 — Remízová pravidla a terminace

**Goal:** Knihovna rules umí detekovat remízu nad rámec samotné pozice: nová vrstva stavu partie (pozice + čítač pliesWithoutProgress + historie pozic) s pravidly 80 půltahů bez braní a bez tahu mužem a trojí opakování stejné pozice se stejnou stranou na tahu; brána fáze jsou testy remíz (reset čítače braním i tahem muže, opakování dámami) a garance, že každá partie terminuje.

## Steps
- [done] Klíč pozice a typ GameState
- [done] Posun stavu po tahu (advanceState)
- [done] Výsledek stavu s remízami
- [done] Test terminace seedovaným playoutem
- [done] Export API a zelený workspace

## Auto-commit
- Phase 8: Remízová pravidla a terminace

## Discussion
# Phase 8 — Remízová pravidla a terminace

## Intent
Knihovna rules dostane vrstvu „stav partie" nad rámec jedné pozice, aby uměla detekovat remízy a garantovat terminaci každé partie. Dvě remízová pravidla:
- **80 půltahů bez pokroku:** 80 půltahů po sobě bez braní a bez tahu mužem (hýbou se jen dámy) = remíza. Čítač `pliesWithoutProgress` žije napříč tahy.
- **Trojí opakování:** stejné rozestavění + stejná strana na tahu potřetí = remíza. Potřebuje historii pozic.

Vznikne `GameState` (pozice + čítač + historie klíčů), funkce pro posun stavu po tahu a detekce výsledku vracející i `draw`. Stávající `gameResult(position)` zůstává (pozičně nikdy `draw` nevrátí); stavová varianta je nadstavba. Server a engine později staví na téhle vrstvě.

## Key decisions
- **Prohra má přednost před remízou** (rozhodl uživatel): když strana na tahu nemá legální tah a zároveň platí remízová podmínka (čítač 80 / opakování), platí prohra. Pořadí kontrol: nejdřív bez-tahu prohra, pak remízy.
- **Remíza se vyhlašuje automaticky a hned** – žádné „na žádost hráče". Jinak není garance terminace (random vs random v todo 11). Vědomý trade-off: hráč nedostane volbu hrát dál.
- **80 půltahů = pevná konstanta** v knihovně (odpovídá 40 tahům na stranu z oficiálních pravidel), žádná konfigurace.
- **Klíč pozice = deterministická textová serializace** (rozestavění všech 32 polí + strana na tahu). Žádný hash – bez rizika kolizí. V americké dámě pozice + strana na tahu plně určuje legální tahy (nic jako rošáda/en passant), klíč je tedy kompletní.
- **Historie opakování se čistí při pokroku:** po braní nebo tahu mužem se dřívější pozice už nikdy nemůže vrátit (kámen zmizel / muž jde jen vpřed), historie se zahazuje → zůstává krátká. Optimalizaci musí přibít test.
- **Reset čítače:** braní NEBO tah mužem (proměna je tah mužem, taky resetuje). Tah dámou bez braní čítač inkrementuje.
- GameState je immutable stejně jako Position (konzistence s applyMove, který vrací novou pozici).

## Watch out for
- `GameResult` typ se rozšíří o `'draw'` – zkontrolovat dopady na existující konzumenty typu (zatím jen testy).
- Trojí opakování počítá i první výskyt pozice (výchozí stav = 1. výskyt); pozice po posledním tahu musí být do historie započtena dřív, než se výsledek vyhodnotí.
- Test na to, že opakování „přes" braní/tah mužem se NEpočítá (historie vyčištěná).
- Reálné opakování nastává jen tahy dam – testovací pozice stavět s dámami.
- Garance terminace: test se seedovaným náhodným playoutem (random vs random) – každá partie musí skončit v omezeném počtu půltahů (hrubá mez: nejhorší případ desítky tisíc půltahů nehrozí, mez řádově tisíce).

## Run report
---
phase: 8
verdict: done
steps:
  - title: "Klíč pozice a typ GameState"
    status: done
  - title: "Posun stavu po tahu (advanceState)"
    status: done
  - title: "Výsledek stavu s remízami"
    status: done
  - title: "Test terminace seedovaným playoutem"
    status: done
  - title: "Export API a zelený workspace"
    status: done
---

# Phase 8 — report ze session

## Co vzniklo
- `packages/rules/src/state.ts` (nový): `positionKey` (textový klíč: strana na tahu + 32 znaků desky, poškozenou pozici včetně děr a nesmyslných buněk odmítá RangeError), `GameState` (immutable: pozice + `pliesWithoutProgress` + `repetitionHistory`), `initialGameState`, `advanceState` (pokrok = braní nebo tah mužem → čítač 0 a historie zahozená; prostý tah dámou → čítač +1), konstanta `MAX_PLIES_WITHOUT_PROGRESS = 80`.
- `packages/rules/src/result.ts`: `GameResult` rozšířen o `'draw'`; `gameResultFromState` – pořadí: prohra bez tahu (přednost, rozhodnutí z diskuse) → remíza čítačem ≥ 80 → remíza trojím opakováním.
- Testy: `test/game-state.test.ts` (25 testů) a `test/termination.test.ts` (50 seedovaných partií random vs random, všechny terminují, deterministický PRNG mulberry32 – žádný Math.random).
- Exporty z `index.ts`; celý workspace zelený (lint + typecheck + 217 testů rules).

## Nad rámec plánu (z nezávislého self-review)
Fáze zavádí kontrakt mezi moduly, takže dle CLAUDE.md proběhl self-review sub-agentem s čerstvým kontextem. V jádru remízové logiky chybu nenašel; tři nálezy jsem opravil:
1. **Kontrakt „vyhodnoť po každém půltahu"** byl nevyslovený – dávkové přehrání tahů mohlo remízu „přejet". Detekce opakování teď počítá KTERÝKOLI klíč v historii (ne jen aktuální pozici), takže opakování uvnitř úseku bez pokroku se dohledá i zpětně; kontrakt je explicitně v docstrinzích `advanceState` i `gameResultFromState`. Zbytková mez: remízu z ČÍTAČE přejetou pokrokem zpětně dohledat nelze (informace je resetem zničená) – proto kontrakt per-půltah platí dál a server (todo 16/17) ho musí dodržet.
2. **`positionKey` sliboval víc, než dělal** – díra v poli a nesmyslná buňka se serializovaly tiše (dvě různě poškozené desky mohly sdílet klíč). Teď RangeError, přibito testy.
3. **Doplněné testy:** přednost prohry i před opakováním (ne jen před čítačem), stejná deska s jinou stranou na tahu se nepočítá, retro-detekce opakování, poškozený stav propaguje RangeError.

## Ověření, že testy mají zuby (mutace)
Čtyři dočasné mutace zdrojáku, každá shodila testy: práh opakování 3→2, práh 3→4, pokrok bez tahu muže, vypnutá přednost prohry. Vše vráceno, finální stav zelený.

## Unhappy path (projito)
- Poškozená pozice (krátká deska, cizí turn, díra, nesmyslná buňka) → RangeError, žádný tichý klíč.
- Strukturálně neplatný tah v `advanceState` → RangeError z `applyMove`, vstupní stav nezmutovaný.
- Ručně poskládaný nekonzistentní `GameState` → nevede na falešnou remízu (počítá se jen to, co v historii opravdu je).
- `advanceState` na skončeném stavu projde bez chyby – vědomé, zdokumentované (server hlídá konec sám).

## Poznámky
- Během mutační kontroly mi `git checkout` omylem vrátil `result.ts` na verzi z HEAD – obnoveno z kontextu, finální běh testů to potvrzuje (217/217).
- Empirický test terminace (50 partií) je pojistka, ne důkaz – skutečná garance plyne z pravidla 80 půltahů + konečného počtu pokroků (~16 000 půltahů teoretická mez, strop testu 5 000).
- Žádné rozhodnutí typu „zvážená a zamítnutá alternativa" nad rámec diskusních poznámek nevzniklo – ADR není potřeba.
