# Phase 35 — Úroveň Začátečník: server a UI

**Goal:** Protáhnout volbu úrovně z UI přes POST /games a EngineClient až do BestmoveRequest (maxDepth + carelessness), aby si člověk mohl založit partii proti úrovni Začátečník a engine na ní hrál měřitelně slaběji než výchozí Profesionál. Rozsah: dvě úrovně (Profesionál = dnešní chování/výchozí, Začátečník = oslabený), mapa úroveň → { maxDepth, carelessness } na serveru, úroveň uložená v GameRecord, volitelný parametr síly na EngineMover.bestmove (zpětně kompatibilní), výběr úrovně v UI při nové hře. Konkrétní čísla jsou první odhad, ne ověřená kalibrace obtížnosti.

## Steps
- [done] Server: modul úrovní a mapa síly
- [done] EngineClient: volitelný parametr síly
- [done] Store: úroveň v záznamu partie
- [done] App: POST /games přijme úroveň a protáhne ji k enginu
- [done] Web: výběr úrovně při nové hře

## Auto-commit
- Phase 35: Úroveň Začátečník: server a UI

## Discussion
# Phase 35 — Úroveň Začátečník: server a UI

## Intent
Protáhnout volbu úrovně od UI až do zprávy pro engine. Herní logika už existuje
(fáze 34: `maxDepth` + `carelessness` v `BestmoveRequest`, validace v
`handler.ts:validateStrength`, výběr horšího tahu v `chooseMove`). Tahle fáze je
čistě instalatérská – žádná nová pravidla ani nová evaluace.

Dvě úrovně: `professional` (dnešní chování = plná síla, výchozí) a `beginner`
(výrazně oslabený). Rozsah vědomě dvě, další úrovně (žebříček) až později.

Řetěz, kterým volba teče:
1. UI `<select>` v panelu (`app-shell.ts`) → hodnota se čte při `startNewGame()`.
2. `POST /games` body `{ level }` (zod) → `ServerClient.createGame(level)`.
3. `GameStore.create(level)` uloží úroveň do `StoredGame`/`GameRecord`
   (tah enginu běží na pozadí v `runEngineMove`, musí úroveň znát ze záznamu).
4. Mapa `level → { maxDepth, carelessness }` na serveru (jedna konstanta).
5. `EngineMover.bestmove(position, strength?)` → `EngineClient` vloží páky do
   `BestmoveRequest`. `strength` je per-hra → parametr METODY, ne konstruktoru
   (v konstruktoru je jen `timeMs`).

## Key decisions
- **Výchozí úroveň = `professional`.** Když `POST /games` přijde bez `level`
  (dnešní klient i testy posílají prázdné tělo), platí professional → zachová
  dnešní chování, zpětně kompatibilní. UI má po startu předvybraného Profesionála.
- **Úroveň je pevná po dobu partie.** Server ji drží v `GameRecord`; změna
  `<select>` se projeví až u další „Nová hra". Během rozehrané partie se nemění.
- **Začátečník = výrazně slabší** (cíl: i slabší člověk má reálnou šanci vyhrát).
  Konkrétní čísla jsou PRVNÍ ODHAD, ne ověřená kalibrace – doladí se reálným
  hraním (editace konstanty + redeploy, ne runtime přepínač). Návrh k ověření v
  plánu: mělká hloubka (např. `maxDepth` 1–2) + dost vysoká `carelessness`
  (řádově 0,3–0,5). Pozor: quiescence dořeší povinná braní i s `maxDepth=1`,
  takže reálnou šanci nese hlavně `carelessness`, ne mělká hloubka.
- **Nabídka remízy (`engine.evaluate`) zůstává na plné síle.** Vědomá
  nekonzistence (slabý engine „chytře" pozná remízu). Jednodušší; obtížnost
  neřídí. Případné oslabení evaluace je věc pozdější fáze.
- Interní hodnoty `professional`/`beginner` (kód/drát), v UI česky
  „Profesionál"/„Začátečník".

## Watch out for
- **Zpětná kompatibilita `POST /games`.** Schéma musí brát `level` jako volitelný
  s defaultem `professional`, jinak spadnou stávající testy serveru i dnešní
  klient (posílají prázdné tělo). Ověřit: starý `createGame()` bez těla dál projde.
- **`EngineMover` má stub v testech** (`buildApp({ engine })`). Přidání parametru
  `strength` do `bestmove` se dotkne stubů → udělat ho VOLITELNÝ, ať staré stuby
  kompilují. Stejně tak `EngineClient.bestmove`.
- **Test se zuby (protažení, ne herní síla).** Tahle fáze netestuje „engine hraje
  slaběji" (to je fáze 34) – testuje, že se páky DONESOU až k enginu. Stub
  `EngineMover.bestmove` zachytí `strength` argument a ověří, že pro `beginner`
  dorazí jiné `{ maxDepth, carelessness }` než pro `professional`. Zuby: kdyby
  server tiše posílal pořád professional (páky se zahodí), test padne.
- **Cross-module kontrakt na názvy úrovní.** `level` řetězec sdílí zod enum
  (server), `<option>` value (web) a případně `GameDto`. Jeden zdroj (konstanta/
  typ), ne tři natvrdo opsané literály. Mapa `level→strength` je taky jedna
  konstanta – test čte reálnou mapu, ne svou kopii čísel.
- **`runEngineMove` čte úroveň ZE ZÁZNAMU partie**, ne z globálu/klienta – jinak
  by souběžné partie s různými úrovněmi hrály stejnou silou.
- **UI: `<select>` musí existovat před prvním `startNewGame()`** (appka zakládá
  partii automaticky při startu, `app-shell.ts:283`), s defaultem professional.
  Během `loading` ho zamknout (jako ostatní tlačítka). Bez inline stylů/scriptů
  (CSP) – třída v `styles.css`.
- **Otevřený bod pro plán: nese `GameDto` úroveň zpátky?** UI si výběr drží samo,
  ale `getGame`/resync po refreshi by úroveň neznalo. Levné přidat do `GameDto`
  (umožní zobrazit „Hrajete proti: Začátečník"). Rozhodnout v plánu; nemění
  jádro řetězu.

## Run report
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
