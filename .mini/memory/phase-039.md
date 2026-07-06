# Phase 39 — Kámen strany na tahu

**Goal:** Vedle desky (na šířce <768 px pod deskou) zobrazit svítící kámen barvy strany, která je na tahu – posazený na černém průhledném kruhu a o 30 % větší než hrací kámen. Bez blikání, jen zvýrazněný (svítící) kámen; mimo běžící partii se skryje.

## Steps
- [done] Indikátor: DOM prvek + řízení ze stavu (app-shell.ts)
- [done] CSS: černý kruh + kámen 1,3× + svícení (desktop vpravo)
- [done] CSS <768: indikátor pod deskou
- [done] Test app-shellu se zuby
- [done] Vizuální ověření v prohlížeči

## Auto-commit
- Phase 39: Kámen strany na tahu

## Run report
---
phase: 39
verdict: done
steps:
  - title: "Indikátor: DOM prvek + řízení ze stavu (app-shell.ts)"
    status: done
  - title: "CSS: černý kruh + kámen 1,3× + svícení (desktop vpravo)"
    status: done
  - title: "CSS <768: indikátor pod deskou"
    status: done
  - title: "Test app-shellu se zuby"
    status: done
  - title: "Vizuální ověření v prohlížeči"
    status: done
---

# Phase 39 — report z auto session

> **Doladění po vizuálním ověření (člověk):** kruh nakonec NENÍ černý průhledný,
> ale plná barva tmavého pole desky (`var(--dark)`), aby byl černý kámen dobře
> vidět. Lem kolem kamene (`padding`) doladěn na `0.25 × pole`. Velikost kamene
> zůstala na zadaných 1.3× hracího kamene. Vizuální kontrola v prohlížeči proběhla
> a je odsouhlasená.

## Co je hotové
- **DOM + řízení (app-shell.ts):** přidán prvek `.turn-indicator` (černý kruh s vnitřním `.piece`) jako sourozenec desky ve `.game`. Barvu a viditelnost řídí nová funkce `updateTurnIndicator(s)` volaná z `render()` – čte se stávající `GameStatus`, žádné nové volání serveru. Viditelný jen když `result === 'ongoing'`, barva podle `s.turn` (black = člověk, white = počítač). Barva se drží i ve skrytém stavu, ať při dalším zobrazení neproblikne stará. Navíc se indikátor skrývá na začátku `startNewGame()`, protože chybová cesta zakládání `render()` nevolá (jinak by tam visel z minulé hry).
- **CSS (desktop):** černý průhledný kruh `rgba(0,0,0,0.5)`, vnitřní kámen `calc(var(--square) * 0.72 * 1.3)` (= o 30 % větší než hrací kámen 0.72), statický glow přes `box-shadow` (žádná animace, jen svítí – dle zadání bez blikání). Vpravo od desky, svisle vycentrovaný přes `.game { align-items: center }`. Sdílí `.piece.black/.white` s deskou (jeden zdroj vzhledu barvy).
- **CSS (<768):** v `@media` se indikátor řadí pod desku (pořadí v DOM) a mezera se přehodí z `margin-left` na `margin-top`.
- **Test se zuby:** dva testy v `app-shell.test.ts` (celkem 134 zelených). Ověřeno mutací – při rozbití `toggle('hidden', !ongoing)` test „…po konci partie zmizí" spadl; po vrácení zase zelený.

## Mechanicky ověřeno mnou
- `pnpm --filter @checkers/web test` → 134 passed
- `tsc --noEmit` (web) → čisté
- `pnpm --filter @checkers/web build` → OK
- `pnpm lint` (root eslint) → čisté

## Co jsem NEověřil a proč
- **Vizuální kontrola v prohlížeči** (krok 5) – automatizovaný Chrome v tomhle prostředí neběží na stejném stroji jako dev server (dev servery odpovídají přes `curl` 200 na `[::1]:5173/5174`, ale prohlížeč je vidí jako error page). Nechávám na člověku, položky výše ve `verify`.

## Otevřená věc / riziko k rozhodnutí
- **Rezerva šířky desky 9rem.** Proti přetečení vpravo jsem zvolil zmenšení `--board-size` na `min(90vh, calc(94vw - 9rem))` (rezerva se uplatní jen když je aktivní člen 94vw, tj. na úzkém/vysokém okně; na běžném širokém monitoru je aktivní 90vh a deska se nezmění). Zvažoval jsem absolutní/fixed umístění indikátoru (nezabírá layout šířku), ale zamítl – na úzkém okně by se překryl s deskou a zakryl kameny, což je horší než scrollbar. Rezerva 9rem je **přibližná konstanta**: šířka indikátoru roste s velikostí pole, takže v pásmu ~769–1100 px nemusí sedět na pixel. Pokud to při vizuálním ověření drhne, je to kandidát na doladění. Tenhle trade-off (reserve vs. absolute) stojí za záznam – zvaž `/mini:decision` před `/mini:done`.

## Poznámka k prostředí
- Při ověřování jsem spustil vlastní web dev server na portu 5174 a po nezdařeném browser testu ho zase zabil (port je volný). Tvůj běžící dev server na 5173 a server na 3000 jsem nechal být. Můj pokus spustit druhý server na 3000 rovnou spadl na EADDRINUSE (běžel už tvůj) – nic po něm nezůstalo.
