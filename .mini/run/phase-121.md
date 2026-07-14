---
phase: 121
verdict: done
steps:
  - title: "AIvP kompletní partie: integrační test"
    status: done
  - title: "Přepnutí varianty + LocalStorage (italská)"
    status: done
  - title: "Statický build + assety v dist"
    status: done
  - title: "Živá kontrola z naservírovaného dist (offline)"
    status: done
  - title: "Uzavírací brána"
    status: done
---

# Fáze 121 — report z auto sezení

## Co je hotové (mechanicky ověřeno)

Fáze byla podle diskuse KOMPOZICE už zeleného (IT-6..IT-10) + build-verify, ne nová logika. Nesahal
jsem do produkčního kódu ani do `rules/src` (ověřeno `git status`). Přidal jsem jen dva testy ve `web`.

1. **AIvP kompletní partie do konce** — nový `test/local/local-client-italian-e2e.test.ts`. Deterministicky
   (fixní seed/hodiny) odehraje italskou AIvP přes `LocalClient` + in-process worker (žádný herní server)
   od zahájení do TERMINÁLNÍHO výsledku. Každý půltah člověka porovná `dto.legalMoves` proti
   `legalMoves(pos, ITALIAN_RULESET)` a `postMove` nesmí thrownout; recording worker hlídá, že engine
   počítá italsky (`variant === 'italian'`). Partie nezamrzne, dojede k výsledku.

2. **Přepnutí varianty + LocalStorage** — nový `test/variant-switch-italian.test.ts` (5 testů). Lobby
   round-trip: italská se uloží do `checkers.variant` a po remountu (restart) se předvybere; default american.
   Plus invariant, na kterém stojí zahození partie: dva klienti různých variant mají oddělené obchody partií.

3. **Statický build + assety** — `pnpm --filter @checkers/web build` prošel. V `dist/assets` jsou hashované
   italské assety `right_game_board-Chnqq2S0.webp`, `red-DRqycPw9.webp`, `red_queen-Gzubf5kc.webp` a VŠECHNY
   jsou referencované z JS bundlu i CSS (důkaz, že `?url` import nezmizel tree-shakingem).

5. **Uzavírací brána** — celá suita zelená: rules 435, engine 273 (vč. perftu a M3 brány), cli 24, ai 57,
   server 216, web 669. `tsc --noEmit` napříč všemi balíčky čistý. `rules/src` nedotčeno → perft čísla
   ostatních variant beze změny z konstrukce.

## Krok 4 (živá kontrola z distu) — potvrzeno uživatelem

Mechanicky jsem ověřil offline stranu buildu (dist se servíruje, offline worker chunk přítomný a servírovaný,
italské assety 200, žádný proxy na herní server); browser automation na to nešla (řídí uživatelův prohlížeč,
nedosáhne na sandbox server). Vizuální paritu (otočená deska, red kameny na tmavém dřevě, tmavé pole vpravo
dole, terminální modal) a přepnutí varianty v reálné appce **potvrdil uživatel okem při done kroku** → krok 4
uzavřen, `verdict: done`.

## Kritická poznámka (z nezávislého self-review)

Nezávislý recenzent (čerstvý kontext) potvrdil ZUBY e2e testu mutací (rozbití rulesetu na americký test
shodí), ale upozornil na dvě věci, které jsem zapracoval do komentářů, ať netvrdí víc, než dělají:

- **e2e nepokrývá FID max-count/tie-break NA TAHU ČLOVĚKA** – deterministická trajektorie k volbě mezi
  více braními různé délky nedojde. Ověřuje jen, že italský ruleset je zadrátovaný a partie pod ním doběhne
  (divergence od americké nastane na capture pozicích). Plný max/prioritu pokrývají rules-level perft/fixtures
  (IT-5), ne tenhle e2e.
- **„přepnutí zahodí partii" je v unit testu jen INVARIANT dvou oddělených obchodů partií, ne wiring
  `main.ts showSolo`** – ten reálný seam žádný test nevykoná (main.ts je netestovatelný vstupní bod). Je to
  pre-existing stav z fáze 102. Proto je wiring v `verify` na live kontrolu, ne vydávaný za pokrytý testem.

Žádná z těch dvou věcí není defekt italské – jsou to poctivé hranice rozsahu testů, které jsem doplnil do
komentářů i sem. Reálný defekt (asset chybí v dist, přepnutí nezahodí partii) se neobjevil.
