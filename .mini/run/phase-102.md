---
phase: 102
verdict: done
steps:
  - title: "Worker + local-client nesou variantu"
    status: done
  - title: "Controller/selection čtou variantu z hry"
    status: done
  - title: "app-shell: variantu partie + filtr Mistrovství"
    status: done
  - title: "Lobby: picker varianty + LocalStorage"
    status: done
  - title: "i18n: názvy variant + aria (cs/en)"
    status: done
  - title: "Brána: end-to-end + americká beze změny"
    status: done
  - title: "Nezávislý sub-agent review"
    status: done
verify:
  - title: "Odehrát v prohlížeči kompletní AI partii v pool/ruské/české variantě (bez serveru)"
    detail: "Programově je pokrytá pool partie (local-client-variant.test) + ruleset threading unit testy (russian/czech). Reálný Web Worker jsdom nemá – skutečné odehrání celé partie v prohlížeči včetně vizuálního zvýrazňování létavé dámy jsem ověřit nemohl. Build (vite) prošel, engine-worker-entry se bundluje."
  - title: "Vizuální kontrola pickeru varianty v lobby (layout, aria, mobil)"
    detail: "Přidán <select>.lobby-variant vedle tlačítka „Hrát proti počítači“ (řádek .lobby-solo, na úzkém displeji se zalomí). CSS bez inline stylů (CSP). Vzhled a zalomení na mobilu nutno posoudit okem."
  - title: "Americká cesta vypadá a chová se stejně jako dřív"
    detail: "Default 'american' všude, všech 586 web testů + 268 engine + 156 server + 57 ai + 382 rules + 24 cli zelených. Vizuální/UX shodu americké desky jsem neověřoval okem."
---

# Fáze 102 — report z auto session

## Co se povedlo
Vertikální řez AIvP výběru varianty je hotový a mechanicky ověřený (typecheck 6/6 balíků, lint zelený, build webu OK, všechny testy zelené). Přidal jsem 6 nových test souborů (24 testů) se zuby.

**Architektura (klíčové rozhodnutí):** variantu jsem **pevně navázal na instanci `LocalClient`** (`LocalClientOptions.variant`, default 'american'), místo abych ji protahoval přes `createGame` (sdílené rozhraní `ServerClient` s HTTP/PvP cestou zůstalo nedotčené). `main.ts` teď drží worker jako singleton, ale zakládá **čerstvý klient při každém vstupu do sóla** podle volby z lobby — „přepnutí varianty zahodí partii a začne novou“ tím plyne přirozeně z výměny klienta, bez jakéhokoli přepínání za běhu.

**Jediný zdroj varianty:** picker v lobby → `read()` čte `select.value` (DOM), tatáž hodnota se uloží do LocalStorage a předá do `onPlayVsComputer(variant)` → `main.ts showSolo(variant)` → klient i skořápka. LocalStorage je jen odraz, nemůže se rozejít s hraným.

**Varianta z herního stavu:** `GameDto` dostal volitelné `variant?` (default american, server DTO beze změny → D3). `controller` odvodí `ruleset` z `game.variant ?? 'american'` a protáhne ho do všech `selection` funkcí i `applyMove`/`resolveMove` — UI zvýrazňuje tytéž tahy, jaké engine počítá. `advanceState`/`gameResultFromState` variantu čtou ze `GameState` (nastavuje ji `seedInitial`).

**Mistrovství × varianta:** `app-shell` filtruje championship pro ne-americké (`availableLevels`), uložená úroveň championship + ne-americká spadne na professional (`levelSelect.value` nikdy prázdné).

## Nezávislý sub-agent review (krok 7)
Spustil jsem reviewera s čerstvým kontextem. Bez Critical/High. Našel jeden **Medium (opraven)** a drobnosti:

- **M1 (opraveno):** sdílený klíč `checkers.level` — vstup do ne-americké varianty tiše přepisoval uloženou preferenci Mistrovství (championship → professional). Fix: `saveLevel` volá **jen americká varianta**; ne-americká americkou preferenci čte jako default, ale nikdy ji nekontaminuje. Přidán regresní test se zuby (`app-shell-variant.test`).
- **L2/L3 (posíleno):** doplněn test dto/request varianty pro **všechny čtyři** varianty a kontrola `textContent` option v pickeru (chytí prohozený i18n klíč v lobby mapě — cross-module kontrakt).
- **L1 (vědomě ponecháno):** nezapsaná volba pickeru se ztratí při přepnutí jazyka (rebuild lobby čte z LocalStorage). Okrajové gesto, oprava by vyžadovala přeuspořádání handlerů (TDZ na `soloVariant`); riziko > přínos.
- **L4 (info):** `LocalClient` nemá `dispose`; osiřelý in-flight tah enginu při přepnutí varianty doběhne na sdíleném workeru — neškodné (id-korelace ověřena), max ~1s plýtvání.

## Trade-offs / co může selhat
- **Ne-americká úroveň se nepamatuje mezi spuštěními** (důsledek M1 fixu — sdílený klíč). Vědomé, není to požadavek fáze; per-varianta klíč by byl vrstva navíc. **Tohle je reálný crossroads — zvaž `/mini:decision` před `/mini:done`** (proč american-only save + proč klient vázaný na variantu místo `createGame` param).
- **Server DTO záměrně beze změny** (WEB část todo 56; server dto → D3). HTTP/PvP cesta variantu nenese → controller ji bere jako 'american'. Pokud by se v budoucnu přes HTTP posílala neplatná varianta, `isGameDto` ji odmítne (guard přes `isVariantId`).
- **Reálný Web Worker se v testech (jsdom) nespouští** — worker plumbing ověřuje jen typecheck + build + in-process fake. Skutečné odehrání partie v prohlížeči je v `verify` pro člověka.

## Poznámka pro člověka
`pnpm lint` shodil i dvě **předchozí** chyby z fáze 101 (`engine/test/selfplay-flying-king.test.ts` — optional-chain + array-type). Opravil jsem je (triviální, 2 řádky v testu), aby byl lint zelený; nesouvisí s fází 102.
