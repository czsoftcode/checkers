---
phase: 52
verdict: done
steps:
  - title: "createGame přijme a pošle humanColor"
    status: done
  - title: "LocalStorage helpery pro barvu"
    status: done
  - title: "startNewGame pošle zvolenou barvu"
    status: done
  - title: "Překlopení barvy po dohrané partii"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Ověření bílé větve E2E + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální round-trip člověk=bílý proti reálnému serveru"
    detail: "Server-side (POST /games humanColor=white spustí engine, vrátí white, turn) je mechanicky pokrytý human-color.test.ts z fáze 50, orientace/mapování klienta pokrývá app-shell.test.ts. Co jsem NEspustil je skutečný browser round-trip: člověk=bílý → deska otočená bílým dolů, engine (černý) sám táhne první, po dohrání partie se barva na PŘÍŠTÍ hru viditelně střídá a přežije reload stránky (F5). Doporučuju projet 2 partie za sebou a ověřit i reload."
  - title: "Neuložené změny obrázků kamenů NEPATŘÍ do commitu fáze 52"
    detail: "black_queen.webp a white_queen.webp mají v pracovním stromu neuložené binární změny, které NEJSOU z mé práce (vznikly během session, patrně todo 32 'nové kameny'). Nedotkl jsem se jich. Než se fáze 52 commitne, rozhodni, jestli je vyjmout (git restore) nebo commitnout zvlášť – jinak je 'git add -A' smíchá do commitu barvy."
---

# Fáze 52 — report z auto session

## Co se udělalo
Aktivoval jsem dosud spící bílou větev z fáze 51:

1. **`server-client.ts`** — `createGame(level, humanColor)` posílá do `POST /games` tělo `{ level, humanColor }`. Barva se posílá VŽDY explicitně (server má default, ale nespoléháme na něj).
2. **`app-shell.ts`** — nové `loadNextColor`/`saveNextColor` (LocalStorage klíč `checkers.nextColor`, validace na `black`/`white`, try/catch jako u úrovně), `opposite`, stavová proměnná `nextColor` (init z úložiště). `startNewGame` posílá `nextColor`. Překlopení barvy je v `render()` uvnitř terminálního latche `notifiedTerminalKey`, gated `s.result !== 'ongoing'` — takže PŘESNĚ jednou za DOHRANOU partii; pád enginu (`engineStatus==='error'`) barvu NEpřeklopí. Základ překlopení je `opposite(humanColor)` = barva skutečně odehrané partie.
3. **Testy** — `server-client.test.ts`: reálné POST tělo nese `humanColor` (black i white). `app-shell.test.ts`: střídání black↔white po dohrání + uložení do LocalStorage, engine-error neflipuje, první partie bere uloženou barvu, a regresní test na fallback (viz níž).

Ověřeno mechanicky: web typecheck čistý, lint čistý, 221 testů web zelených; celé repo zelené (cli 24, engine 250, server 137).

## Nález z nezávislého self-review (opraveno)
Sub-agent (čerstvý kontext) našel **jednu reálnou regresi**, kterou jsem sám zanesl: fallback jsem napsal jako `game.humanColor ?? nextColor` s odůvodněním „robustnost". To bylo **špatně**. `??` se aktivuje jen když DTO nemá `humanColor` — a to nastane výhradně proti serveru BEZ fáze 50, který pole `humanColor` v požadavku ignoruje a člověka drží ČERNÉHO. Dosadit tam poslanou `nextColor` (např. bílou) by znamenalo zrcadlově obrácenou desku a invertované mapování výhry KAŽDOU DRUHOU hru. Vrátil jsem na `?? 'black'` (korektní degradace = shoda s fází 51, feature se jen nestřídá) a opravil zavádějící komentář.

K opravě jsem přidal cílený test se zuby (starý server bez `humanColor` + překlopená barva → mapování musí zůstat černé). Ověřil jsem jeho zuby: s buggy `?? nextColor` test spadne, po opravě prochází.

Zbytek review bez nálezu: kontrakt těla sedí na zod schema serveru, četnost překlopení je přesně 1×/partii, LocalStorage unhappy-path ošetřený, opuštěná (nedohraná) partie barvu nemění.

## Pro člověka
- Vizuální ověření bílé perspektivy a střídání přes reload (viz `verify`).
- Neuložené změny webp obrázků kamenů v pracovním stromu NEJSOU moje – rozhodnout, co s nimi před commitem (viz `verify`).

## Mimo fázi (pro pozdější fázi)
Pravidlo 2 kol v Mistrovství (stejný ballot 2× se střídáním barev) tady NENÍ – potřebuje serverovou podporu (fixní `ballotIndex` přes 2 partie; server dnes losuje čerstvě a `GameDto` `ballotIndex` ani nevrací). Zůstává jako samostatná fáze.
