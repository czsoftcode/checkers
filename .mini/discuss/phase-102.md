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
