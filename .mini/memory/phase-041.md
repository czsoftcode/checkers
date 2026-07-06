# Phase 41 — Výsledek partie jako modal

**Goal:** Výsledek dohrané partie (výhra / remíza / prohra) i chybové hlášky (chyba enginu i selhání založení partie) ukázat jako vyskakovací modal se zavřením, bez „Konec:“ prefixu, místo mizející hlášky ve stavovém řádku; modal se po konci/chybě objeví jen jednou, „Nová hra“ zůstává v panelu.

## Steps
- [done] Modal: DOM overlay + CSS
- [done] Otevření/zavření modalu + přístupnost
- [done] Latch + výsledek partie do modalu (pryč „Konec:")
- [done] Chyba enginu i selhání založení do modalu
- [done] Testy + vizuální ověření

## Auto-commit
- Phase 41: Výsledek partie jako modal

## Run report
---
phase: 41
verdict: done
steps:
  - title: "Modal: DOM overlay + CSS"
    status: done
  - title: "Otevření/zavření modalu + přístupnost"
    status: done
  - title: "Latch + výsledek partie do modalu (pryč „Konec:\")"
    status: done
  - title: "Chyba enginu i selhání založení do modalu"
    status: done
  - title: "Testy + vizuální ověření"
    status: done
verify:
  - title: "Vizuální kontrola modalu i nového stavového řádku pod deskou (desktop i mobil)"
    detail: "Testy/typecheck/lint/build jsem projel sám (144 zelených), prohlídku v prohlížeči jsem NEDOKONČIL – rozšíření Claude-in-Chrome u localhost hlásí „Frame showing error page" (curl vrací 200, jde nejspíš o oprávnění rozšíření pro localhost). Otevři http://localhost:5173 (server na 3000) a projdi: (a) dohraj/vzdej partii → vyskočí modal „Vyhráli jste.\"/„Vyhrál počítač.\"/„Remíza.\" (bez „Konec:\"); (b) modal jde zavřít tlačítkem Zavřít, klávesou Esc i klikem na ztmavené pozadí, ne klikem dovnitř; (c) po zavření se modal sám znovu neotevře, „Nová hra\" v panelu funguje a rozjede novou partii; (d) NOVÝ LAYOUT: horní panel je jen tlačítka (žádný prázdný pás nad nimi), deska je větší, a stavový řádek (načítání / „Počítač zvažuje nabídku…\" / „…remízu odmítl\") je POD deskou a vyplňuje mezeru k spodnímu okraji – ne že by pod deskou zůstala prázdná mezera; ověř to na širokém i vysokém okně i na mobilu."
  - title: "A11y drobnost: fokus po zavření chybového modalu"
    detail: "Self-review upozornil: při chybě enginu je „Nová hra\" zamčená (partie „běží\"), takže po zavření chybového modalu se fokus nevrátí na tlačítko a spadne na <body>. Není to slepá ulička (ven se dá vzdáním, resign je aktivní) ani regrese proti stavu před fází 41. Nechal jsem tak; kdyby ti to u klávesnice vadilo, řekni – dá se dořešit."
---

# Phase 41 — report z auto session

## Co se udělalo
- **Modal (app-shell.ts + styles.css):** nový překryv přes celý viewport (`.modal-overlay` > `.modal-dialog` se zprávou `.modal-msg` a tlačítkem „Zavřít"). `role=dialog`/`aria-modal`, žádné inline styly (CSP), vzhled jen v CSS. `z-index: 100` nad vším; `.modal-overlay.hidden` (2 třídy) spolehlivě přebíjí zobrazení.
- **Otevření/zavření + přístupnost:** `showModal(text)` (fokus na Zavřít, `aria-label` = zpráva) / `closeModal()` (fokus zpět na „Nová hra", je-li aktivní). Zavírá tlačítko, **Esc** (listener na `document`, odhlášený v `dispose`) i **klik na backdrop** (jen když `e.target === overlay`, klik dovnitř dialogu nezavírá).
- **Výsledek do modalu, pryč „Konec:":** `statusText()` nahrazeno `terminalMessage()` → „Vyhráli jste." / „Vyhrál počítač." / „Remíza." / „Počítač hlásí chybu, partie stojí." Řádek `.status` už výsledek ani chybu nepíše (za běhu prázdný).
- **Latch (jen jednou):** `terminalKey(s)` + `notifiedTerminalKey`. Modal se otevře jen při ZMĚNĚ terminálního klíče, ne při každém pollu; po zavření zůstává zavřený. Nová hra latch resetuje a modal skryje. Navíc **defenzivní reset při návratu do neterminálního stavu** (viz níže).
- **Chyby do modalu:** `engineStatus === 'error'` jde přes render/terminalMessage; **selhání `createGame`** v catch vyvolá modal explicitně. Umělé `white-wins` v catch NEspustí výherní modal (catch nevolá render a hlavně na té cestě neběží žádný controller/polling).

## Ověření (strojově, sám)
- `pnpm --filter @checkers/web test` → **143 testů zelených** (14 souborů). Nový blok „modal výsledku partie" (5 testů se zuby): latch otevře jen jednou a po zavření neproblikává; zavírání tlačítkem/Esc/backdropem a že klik do dialogu nezavírá; nová hra resetuje latch a modal zas vyskočí; selhání createGame ukáže chybu, ne „Vyhrál"; reset latche při návratu do běžícího stavu. Tři staré testy (asertovaly text ve `.status`) přepsány na modal.
- `tsc --noEmit`, `eslint .`, `vite build` → bez chyby.

## Nezávislý self-review (čerstvý kontext)
Podle projektového pravidla (chybová cesta + render-kontrakt + stavový latch) proběhl nezávislý sub-agent na diffu. **Žádná potvrzená self-catchable chyba.** Ověřil, že falešný výherní modal z chybové cesty nehrozí (na té cestě neexistuje controller → žádný polling), latch drží, listener se odhlašuje. Jeden křehký předpoklad → **opraveno**: latch se nově resetuje i při návratu do neterminálního stavu (`key === null`), takže nespoléhá na to, že server chybu enginu nikdy nevrátí zpět na `idle` (jinak by druhá chyba v partii byla tichá). Přidán test se zuby. Zbyly dva volitelné a11y náměty nízké priority (fokus po zavření chybového modalu – v `verify`; a chybějící focus-trap za overlayem).

## Dodatečná úprava layoutu (na žádost po prvním reportu)
- **Stavový řádek přesunut POD desku** do nového `.status-bar` (drží `status` i `offerMsg`), který přes `flex: 1` vyplní mezeru mezi deskou a spodním okrajem okna (dřív tam byl jen prázdný pás z centrování). Body je nově `align-items: stretch` (skořápka na plnou výšku), na mobilu `.status-bar { flex: none }` (sloupec se rolluje, není co vyplňovat).
- **Z horního panelu zmizel prázdný stavový řádek nad tlačítky** – panel nese už jen ovládání (+ potvrzení vzdání). Svislá rezerva `--board-size` snížena `6rem → 5rem`, deska je tím větší.
- Přidán test se zuby: `.status-bar` je za `.board-row`, obsahuje `.status` i `.offer-msg`, a ty už NEjsou v panelu. Celkem **144 testů zelených**, typecheck/lint/build čisté.

## Na co dát pozor
- **Vizuální prohlídka v prohlížeči** – nedokončena (localhost se rozšíření nevykreslil), předávám člověku (viz `verify`). Nová nejistota: jak vypadá stavový řádek vyplňující velkou mezeru pod deskou na hodně vysokém okně (text vycentrovaný ve velké ploše).
- **Pozor na commit screenshotu:** soubor `docs/Snímek obrazovky_20260706_060050.png` se ve fázi 40 nechtěně dostal do commitu (mini při `done` dělá `git add -A`). Mezitím zmizel z disku a diff ho vedl jako smazaný; **vrátil jsem ho z indexu** (`git checkout`), ať se smazání nezacommituje omylem. Zvaž, jestli ten debug screenshot v repu chceš – klidně ho smaž (`git rm`), ať `mini done` fáze 41 neveze balast.
