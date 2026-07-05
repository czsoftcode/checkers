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
