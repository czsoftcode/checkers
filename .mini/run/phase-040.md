---
phase: 40
verdict: done
steps:
  - title: "DOM: obalit desku a indikátor do .board-row"
    status: done
  - title: "CSS desktop: panel v toku nad deskou"
    status: done
  - title: "CSS: svislé vejití panel + deska"
    status: done
  - title: "CSS mobil: pročistit @media (max-width:768px)"
    status: done
  - title: "TS: vyčistit obsah panelu"
    status: done
  - title: "Testy + vizuální ověření"
    status: done
verify:
  - title: "Vizuální kontrola v prohlížeči (desktop i mobil): deska vlevo, panel nikde nezasahuje do desky, přepínač+oddělovač+tlačítka v řádku"
    detail: "Testy/typecheck/lint/build jsem projel sám (zelené), ale prohlídku v prohlížeči jsem NEDOKONČIL – rozšíření Claude-in-Chrome hlásilo u localhost „Frame showing error page", i když dev server přes curl vrací 200 (nejspíš chybí oprávnění rozšíření pro localhost). Otevři http://localhost:5173 (server běží na 3000) a projdi: (a) deska je zpět u LEVÉHO okraje; (b) v řádku ovládání je vlevo přepínač úrovně, pak svislý oddělovač, pak Nabízím remízu / Vzdávám hru / Nová hra – oddělovač má správnou výšku a nevypadá divně; (c) několik mezilehlých šířek (~800-1100 px), jestli panel na ŽÁDNÉ šířce nezasahuje do desky a deska+panel se svisle vejdou; (d) nízké/landscape okno – sloupec se dá srolovat, ne useknout; (e) mobil <768 px: jak se řádek ovládání (přepínač+oddělovač+3 tlačítka) zalomí – tady je největší nejistota, jestli oddělovač po zalomení nevypadá špatně. Svislá rezerva 11rem ve --board-size je odhad výšky panelu; při nafouknutém panelu (zalomený status, viditelná hláška remízy) může vzniknout svislý scroll."
---

# Phase 40 — report z auto session

## Co se udělalo
- **DOM (app-shell.ts):** deska (`boardSlot`) + indikátor strany na tahu (`turnIndicator`) zabaleny do nového `<div class="board-row">`. `.game` je teď sloupec `[panel, board-row]`, panel je řádný sourozenec v toku (ne fixed).
- **CSS (styles.css):** `.panel` už nemá `position: fixed`/`top`/`right`/`z-index`/`max-width` – je v toku, `width: var(--board-size)`, `box-sizing: border-box`. `.game` = svislý sloupec, `align-items: flex-start` (panel zarovnaný k levé hraně desky). Nové `.board-row` = řádek deska+indikátor (na <768 px sloupec, indikátor pod deskou). Obsah panelu zarovnán na střed (`.status`, `.level-row`, `.controls` row, `.confirm`, `.offer-msg`). Body centrované v okně.
- **Svislé vejití:** desktopové `--board-size` změněno z `min(90vh, …)` na `min(calc(90vh - 11rem), …)` – rezerva na výšku panelu nad deskou.
- **Mobilní @media pročištěno:** odstraněna pravidla, která po sjednocení platí globálně (`.panel` blok, `.status`/`.controls`/`.confirm`/`.offer-msg` zarovnání). Zůstalo jen mobilně specifické (velikost desky 70vh, `.board-row` sloupcem, menší tlačítka, mezera indikátoru).
- **Vyčištěný obsah panelu (app-shell.ts):** `statusText()` vrací za běhu partie `''` (kdo je na tahu signalizuje barva kamene, ne text); konec partie a chyba enginu se v status řádku hlásí dál. Řádek se soupeřem `.level-info` úplně odstraněn (prvek, append, obě aktualizace v render/startNewGame) i jeho CSS.

## Ověření (strojově, sám)
- `pnpm --filter @checkers/web test` → **137 testů zelených** (14 souborů). Přidán nový blok testů „panel nad deskou: obsah a struktura": status je za běhu prázdný, `.level-info` v DOM není, status pořád drží konec partie i chybu enginu (zuby), a struktura panel-před-deskou / deska+indikátor uvnitř `.board-row`.
- Tři testy, které dřív asertovaly `.level-info` (`Soupeř: …`), přepsány na hodnotu přepínače (`select.value`).
- `tsc --noEmit`, `eslint .`, `vite build` → vše bez chyby.

## Nezávislý self-review (čerstvý kontext)
Podle projektového pravidla (fáze sahá na chybovou cestu v `startNewGame` a na render-kontrakt) jsem před reportem pustil nezávislého sub-agenta na diff. Výsledek: žádný self-catchable runtime/kompilační bug; jediný nález byl zastaralý komentář u vytvoření panelu (pořád popisoval starý fixed design) – **opraveno**. Potvrzeno i, že `boardSlot.replaceChildren()`/`append` míří pořád na správný prvek, chybová cesta neztratila logiku a mobilní @media korektně přebíjí desktop.

## Co se nedodělalo / na co dát pozor
- **Vizuální prohlídka v prohlížeči** – viz `verify` výš. Nedokončena kvůli tomu, že rozšíření nevykreslilo localhost; předávám člověku.
- **Vědomý trade-off (design):** zrušen samostatný řádek s úrovní běžící partie (`.level-info`). Soupeř se teď čte jen z přepínače, který je během partie zamčený = ukazuje úroveň běžící hry. Kdyby se v budoucnu přepínač odemkl i za běhu, tahle rovnost přestane platit a hráč ztratí z očí, proti čemu hraje.
- **Magická konstanta 11rem** ve svislé rezervě je odhad výšky panelu; není odvozená z reálné výšky. Když se panel nafoukne, hrozí svislý scroll (akceptováno, popsáno v komentáři).

Pokud chceš zaznamenat „proč" u zrušení `.level-info` jako ADR, spusť před `/mini:done` příkaz `/mini:decision`.

## Dodatečné úpravy (na žádost po prvním reportu)
- **Deska zpět k levému okraji:** `body justify-content` vráceno z `center` na `flex-start`.
- **Přepínač úrovně přesunut do řádku ovládání**, vlevo od „Nabízím remízu"; mezi přepínač a tlačítka přidán svislý oddělovač (`.controls-divider`, 1px). Zrušen samostatný řádek `.level-row` i popisek „Nová hra proti:" (`.level-label`) – přístupnost přepínače drží nově `aria-label`. Odpovídající CSS `.level-row`/`.level-label` odstraněno.
- Přidán test se zuby: přepínač je uvnitř `.controls`, v pořadí přepínač → oddělovač → Nabízím remízu; `.level-row`/`.level-label` v DOM nejsou. Celkem **138 testů zelených**, typecheck/lint/build čisté.
- **Pozor (nedořešeno vizuálně):** chování řádku ovládání na úzkém mobilu při zalomení (přepínač + oddělovač + 3 tlačítka) – oddělovač po wrapu může vypadat divně; je v seznamu k vizuální kontrole.
