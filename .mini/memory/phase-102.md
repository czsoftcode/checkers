# Phase 102 — AIvP: výběr varianty v lobby

**Goal:** Přidat do lobby (AI větev) picker čtyř variant řízený registrem, preference do LocalStorage (default americká); protáhnout zvolenou variantu do local-client + worker-protokolu (pole variant) + selection/controller (legalMoves/applyMove dané varianty) + computeAiMove + lokální /hint; Mistrovství dostupné JEN pro americkou (ovlivnění pickeru úrovní); přepnutí varianty zahodí rozehranou partii a začne novou. i18n: názvy variant a všechny nové texty přes i18n (cs/en), žádné natvrdo řetězce. Brána: v lobby zvolím pool/ruskou/českou a odehraju kompletní partii proti AI CELÉ v prohlížeči (bez serveru); americká cesta beze změny; i18n testy zelené. Uzavírá WEB část todo 56 (server dto zůstává -> D3). Řez z todo 59 (fáze D); 56 i 59 zůstávají otevřené. Největší UI fáze vlny - v discuss zvážit rozdělení.

## Steps
- [done] Worker + local-client nesou variantu
- [done] Controller/selection čtou variantu z hry
- [done] app-shell: variantu partie + filtr Mistrovství
- [done] Lobby: picker varianty + LocalStorage
- [done] i18n: názvy variant + aria (cs/en)
- [done] Brána: end-to-end + americká beze změny
- [done] Nezávislý sub-agent review

## Auto-commit
- Phase 102: AIvP: výběr varianty v lobby

## Discussion
# Phase 102 — AIvP: výběr varianty v lobby

## Intent
Umožnit hráči zvolit v LOBBY jednu ze čtyř variant a odehrát proti AI kompletní partii CELÉ v prohlížeči
(bez serveru). Vertikální řez AIvP: picker v lobby → local-client/worker/compute-move/selection/controller
+ computeAiMove + lokální hint, vše s variantou. Jedna fáze (potvrzeno). Uzavírá WEB část todo 56 (server
dto → D3).

## Key decisions
- **Picker varianty je v LOBBY, NE mezi herními tlačítky (uživatel to výslovně upřesnil).** Umístění:
  v lobby u tlačítka „Hrát proti počítači" (`onPlayVsComputer` → main.ts `showSolo` → app-shell). Úroveň
  ZŮSTÁVÁ ve hře (app-shell control bar), varianta NE.
- **Tok:** lobby picker → zvolená varianta se předá do `showSolo(variant)` → `createAppShell(variant)` →
  partie se založí v té variantě. Změna varianty = návrat do lobby („Do místnosti") + nová AI hra. ŽÁDNÉ
  přepínání varianty za běhu, ŽÁDNÝ discard dialog (to naplní „přepnutí zahodí a začne novou" přirozeně).
- **Preference v LocalStorage** (nový klíč, vzor jako `LEVEL_STORAGE_KEY`), default 'american'. Jediný
  zdroj pravdy = picker → hra; LocalStorage jen odraz (nesmí se rozejít).
- **Mistrovství × varianta (potvrzeno):** Mistrovství (championship) je JEN americká. Level `<select>`
  v app-shell filtruje možnosti podle VARIANTY partie (přišla z lobby): ne-americká skryje championship.
  Fallback: uložená úroveň = championship + ne-americká varianta → spadne na professional při zakládání.
  Výuka (hint) funguje ve všech variantách (lokální hint s ruleset).
- **i18n (uživatel připomněl):** názvy 4 variant + aria-label pickeru přes `cs`/`en` objekty v i18n.ts
  (vzor jako `LEVEL_LABELS`), ŽÁDNÉ natvrdo řetězce. Pool nemá český název → ponechat „Pool" (cs/en se
  smí lišit).
- **Jedna vertikální fáze (potvrzeno, varianta A)** – nedělit; plan ji rozseká na kroky.

## Watch out for
- **Dotčené soubory:** lobby.ts (picker + LocalStorage + i18n + předání varianty), main.ts (showSolo
  nese variantu), app-shell.ts (createAppShell(variant), filtr championship dle varianty), local-client.ts
  (createGame nese variantu → computeAiMove + legalMoves/applyMove s ruleset), controller.ts + selection.ts
  (legalMoves/applyMove/zvýraznění dané varianty – čtou variantu Z HRY, ne zvlášť, ať se nerozejde),
  local/engine-worker-protocol.ts + compute-move.ts (pole `variant`, default american = zpětně kompat.),
  i18n.ts (klíče). Hint (Výuka) lokálně s ruleset varianty.
- **Web worker-protokol je JINÝ než engine protokol** (ten dostal variant v D0/fáze 100). Web
  worker-protocol pole `variant` se přidává TEĎ; default american.
- **Americká cesta BEZE ZMĚNY** (default american, stávající AI hra beze změny; americké testy zelené).
- **Mistrovství×varianta je rozprostřené přes dvě obrazovky** – varianta v lobby, filtr úrovně ve hře.
  App-shell MUSÍ znát variantu partie, aby championship skryl; jinak by šlo v ne-americké spustit ballot,
  který nedává smysl (a local-client ballotIndex mimo championship už dnes odmítá 400 – fáze 53).
- **Selection/controller čtou variantu z herního stavu (jediný zdroj), ne z odděleného propu** – jinak
  UI zvýrazní tahy jiné varianty, než hra reálně počítá.
- **i18n testy zelené** (nové klíče v cs i en, snapshot/áčkové testy i18n existují).

## Run report
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
