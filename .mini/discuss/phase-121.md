# Phase 121 — Italská: E2E a statický build

## Intent
Uzavírací brána italského oblouku (IT-11): prokázat italskou od zahájení do konce v AIvP i PvP a v publikovatelném statickém buildu. ZJIŠTĚNO: je to KOMPOZICE už zeleného (IT-6..IT-10) + build-verify + živá kontrola, NE nová práce.

## Key decisions
- **Obě „nové" věci jsou nízkorizikové (potvrzeno čtením kódu):**
  - **Statický build:** italské assety JSOU importované → Vite je zabalí. `board-image.ts` `import ... './assets/right_game_board.webp?url'`; `piece-images.ts` `import ... './assets/red.webp?url'` + `red_queen.webp?url`; `styles.css` `url('./assets/right_game_board.webp')`. Vite následuje `?url` importy i CSS `url()`.
  - **Přepnutí varianty + LocalStorage je GENERICKÉ (fáze 102):** `lobby.ts` klíč `checkers.variant` (volba pro libovolnou variantu); „přepnutí zahodí partii" plyne z výměny klienta (`main.ts` založí čerstvý `LocalClient` na novou variantu → stará partie zmizí). Italská = jen další VariantId, žádný italsky-specifický háček → jen VERIFY.
- **Dělba E2E (potvrzeno uživatelem — oba, tato dělba):**
  - AUTOMATIZOVANÉ (v suitě): (a) AIvP kompletní partie do TERMINÁLNÍHO výsledku přes `LocalClient` (deterministicky); (b) kontrola, že `dist` po buildu obsahuje italské assety (hashované názvy right_game_board/red/red_queen); (c) unit test přepnutí varianty na/z italské + LocalStorage persistence (default american).
  - ŽIVÁ KONTROLA v prohlížeči (lidské oko, NEautomatizovat): italská AIvP z NASERVÍROVANÉHO `dist` OFFLINE (bez herního serveru) — otočená deska + red kameny + terminální modal; + lehká PvP sanity ve dvou oknech.
- **PvP kompletní partie NEZNOVU-automatizovat:** dvouklientský WS E2E do konce už pokryla IT-10. IT-11 jen odkáže + lehká živá kontrola (browser automation dvou PvP klientů je flaky — nález fáze 120).

## Watch out for
- **Statický build = jádro fáze (jediné dřív neověřitelné):** `pnpm build` (Vite dist) MUSÍ projít; ověřit, že dist reálně nese italské assety (ne že se import „ztratil"); a hlavně ZAHRÁT italskou AIvP z naservírovaného distu OFFLINE (žádný herní server) — to je přímý důkaz success criteria „publikovatelný build zahrnuje italskou".
- **Pozor na paritu desky v živé kontrole:** fáze 117 řešila, že italský obrázek má tmavá pole na jiné paritě (komentář v board-view.ts o „SUDÉ paritě padne na SVĚTLÉ"). V živé kontrole POTVRDIT, že finální vizuál sedí (kameny na tmavém dřevě, tmavé pole vpravo dole) i z buildu — kdyby build něco rozhodil.
- **Regrese (uzavírací):** perft a testy VŠECH ostatních variant (american/pool/russian/czech) zelené BEZE ZMĚNY; celá vitest suita zelená; tsc čistý. Do rules/src se nesahá.
- **Rozsah:** nepřidávat featury. Pokud E2E/build odhalí reálný defekt (např. asset chybí v dist, přepnutí u italské nezahodí partii), OPRAVIT; jinak jen prokázat. Případné mimo-italské mezery (např. AIvP PDN archiv, todo [71]) NEřešit tady.
