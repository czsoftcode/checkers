---
phase: 35
verdict: done
steps:
  - title: "Server: modul úrovní a mapa síly"
    status: done
  - title: "EngineClient: volitelný parametr síly"
    status: done
  - title: "Store: úroveň v záznamu partie"
    status: done
  - title: "App: POST /games přijme úroveň a protáhne ji k enginu"
    status: done
  - title: "Web: výběr úrovně při nové hře"
    status: done
verify:
  - title: "Vizuální podoba panelu (výběr úrovně + „Soupeř: …") naživo, hlavně mobil"
    detail: "Ověřeno strojově (select, řádek „Soupeř: …", zamykání). NEověřeno lidským okem: rozložení na úzkém panelu a čitelnost na tmavém pozadí."
  - title: "Reálná obtížnost Začátečníka"
    detail: "Doladěno měřením na { maxDepth: 1, carelessness: 0.5 } – uživatel potvrdil, že proti němu má šanci. Kalibrace zůstává věc reálného hraní (edit packages/server/src/levels.ts)."
---

# Phase 35 — report (po iteracích s uživatelem)

## Co se dodalo

Protažení volby úrovně (Profesionál / Začátečník) od UI přes server až do zprávy
pro engine. Herní logika (páky `maxDepth` + `carelessness`) existovala z fáze 34.

- **Server (`levels.ts` – nový)**: jediný zdroj pravdy o úrovních – `LEVELS`,
  `GameLevel`, `DEFAULT_LEVEL='professional'`, mapa `STRENGTH_BY_LEVEL`
  (`professional → undefined`, `beginner → { maxDepth: 1, carelessness: 0.5 }`).
- **`EngineClient`/`EngineMover`**: `bestmove(position, strength?)` – páky se do
  `BestmoveRequest` vkládají jen když jsou zadané (Profesionál = dnešní požadavek
  beze změny). `evaluate` (nabídka remízy) zůstal na plné síle (vědomě).
- **`store.ts`**: `GameRecord`/`StoredGame` drží `readonly level`; `create(level)`.
- **`app.ts`**: `POST /games` přijímá zod `{ level }` (default professional,
  neznámá → 400); `runEngineMove` čte úroveň ze záznamu a mapuje na páky.
- **`dto.ts` / `GameDto`**: nese `level` – klient tak ukáže SKUTEČNOU úroveň
  partie („Soupeř: …"), nezávisle na přepínači (server = autorita).
- **Web**: `createGame(level)`; panel má výběr úrovně + řádek „Soupeř: …". Appka
  po startu založí hru sama (napoprvé Profesionál – žádná prázdná obrazovka),
  úroveň jde volně přepínat AŽ do prvního tahu (přepnutí přehraje partii), po
  prvním tahu se zamkne, po konci partie zas odemkne. Styl třídami (CSP).

## Kalibrace (doloženo měřením)

Měření reálného enginu ukázalo: `maxDepth` je dominantní páka, ne nepozornost
(carelessness vybírá jen „druhý nejlepší tah", i s hodnotou 1 zůstává silná).
`maxDepth 2` slabšího hráče pořád poráží; `maxDepth 1` dá vyhratelnou partii.
Výsledek: Začátečník = `{ maxDepth: 1, carelessness: 0.5 }`. Uživatel potvrdil.

## Ověření

- Zelené napříč workspace: rules, cli (24), engine (247), web (128), server (103).
- Zuby: testy čtou REÁLNOU mapu `STRENGTH_BY_LEVEL` (ne kopii čísel); echo mód
  falešného enginu hlídá zpětnou kompatibilitu Profesionála (žádné páky na drátě);
  app-shell testy pokrývají přepnutí před tahem, zámek po tahu, odemčení po konci.
- Nezávislý sub-agent prošel rizikové body (chybové cesty POST /games, zpětná
  kompatibilita, cross-module kontrakty, úroveň per partie) bez vážného nálezu.

## Vědomé kompromisy / otevřené body

- **Nabídka remízy zůstává na plné síle** (`engine.evaluate` se neoslabuje) –
  slabý Začátečník „chytře" pozná remízu. Případné oslabení = pozdější fáze.
- **Mechanismus nepozornosti je binární páka.** Mezi „hloubka 1" (poražitelný) a
  „hloubka 2" (poráží slabšího hráče) není jemný mezistupeň – carelessness ten
  rozdíl nevyplní. Jemnější žebříček obtížnosti by chtěl silnější „blunder" režim
  v enginu (samostatná fáze), ne jen jiná čísla.
- **Kontrakt úrovní web↔server je ručně držená kopie** (web nezávisí na balíčku
  server, jako u `GameDto`). Dnes konzistentní, bez testu vynucujícího shodu.
- **Přepnutí úrovně před tahem = nová partie = nové náhodné pozadí.** Drobnost;
  při cvakání sem a tam se mění i obrázek. Lze při pouhém přepnutí pozadí zachovat.

## Poznámka k průběhu

Fáze prošla čtyřmi iteracemi UX s uživatelem (skutečné hraní odhalilo, že volba a
zobrazení úrovně jsou jádro použitelnosti, ne detail): kalibrace čísel, zobrazení
aktivní úrovně z `GameDto`, zamykání přepínače a nakonec model „auto-start +
odemčeno do prvního tahu". Rozhodnutí z `do` fáze „`GameDto` nenese úroveň" bylo
vědomě OTOČENO – reálné použití ukázalo, že bez zobrazení nejde ověřit, proti
čemu se hraje.
