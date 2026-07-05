# Phase 30 — Minimální doba přemýšlení enginu

**Goal:** Engine v runEngineMove nikdy nedotáhne dřív než za 300 ms: když výpočet bestmove trval méně, server před aplikací tahu dospí zbytek (min-think), aby i vynucený nebo jediný legální tah měl znatelnou pauzu; hranice jako pojmenovaná konstanta.

## Steps
- [skipped] Konstanta a volitelný override min-think
- [skipped] Změřit bestmove a dospat rozdíl v runEngineMove
- [skipped] Test: dolní mez u okamžitého tahu
- [skipped] Test: pomalý engine nedostane extra zpoždění
- [skipped] Test: spánek nezakryje změnu stavu
- [done] Self-review nezávislým sub-agentem + CHANGELOG

## Auto-commit
- Phase 30: Minimální doba přemýšlení enginu

## Run report
---
phase: 30
verdict: done
steps:
  - title: "Konstanta a volitelný override min-think"
    status: skipped
  - title: "Změřit bestmove a dospat rozdíl v runEngineMove"
    status: skipped
  - title: "Test: dolní mez u okamžitého tahu"
    status: skipped
  - title: "Test: pomalý engine nedostane extra zpoždění"
    status: skipped
  - title: "Test: spánek nezakryje změnu stavu"
    status: skipped
  - title: "Self-review nezávislým sub-agentem + CHANGELOG"
    status: done
verify:
  - title: "Reálný pocit z pauzy v prohlížeči (hlavně poslední tah)"
    detail: "Mechanicky ověřeno, že tah AI se zobrazí až po pauze a že se měří od konce animace tahu člověka (testy s mockovanou animací). Jestli ~700 ms subjektivně sedí – zvlášť u posledního tahu – umí posoudit jen člověk u reálné hry. Hodnota se ladí konstantou AI_MOVE_PAUSE_MS v controller.ts (700). Když bude přesto rychlé/pomalé, řekni a upravím."
  - title: "Krátká nereaktivnost tlačítek během pauzy"
    detail: "Klik na Vzdát/Nabídnout remízu podaný BĚHEM rozmýšlecí pauzy AI se neztratí, ale vyřídí se až po ní (≤ ~700 ms, u víceskoku člověka + délka jeho animace). Vědomý kompromis, ne bug. Pokud ti to bude vadit, dá se pauza udělat přerušitelná (větší zásah)."
---

# Phase 30 — report z auto session

## Zásadní: pivot přístupu (server → klient)

Fáze byla naplánovaná jako **serverová** min-think pauza (`runEngineMove` dospí do
300 ms). To jsem odvedl včetně testů a self-review – jenže po nasazení jsi hlásil,
že poslední tah je **pořád moc rychlý**, jen neznatelně pomalejší.

Diagnóza: serverová pauza běží **souběžně** s animací tvého vlastního tahu na
klientovi (taky ~300 ms) a s dotazováním po 250 ms. Než animace tvého tahu
doběhne, serverová pauza už je pryč → tah AI naskočí prakticky hned. Serverový
práh je tedy na *vnímanou* pauzu špatná páka.

Po dotazu ses rozhodl pro **pauzu na klientovi (~700 ms)**. Serverovou min-think
jsem proto celou **revertoval** (kód i testy jsou bit-identické s originálem –
`git diff packages/server` je prázdný) a mechanismus přesunul tam, kde se pauza
vnímá. Původních 5 „server" kroků je proto `skipped` (byly hotové, ale vědomě
zahozené ve prospěch správnějšího základu – viz globální instrukce „neopravovat
špatný základ"). Krok 6 (self-review + CHANGELOG) proběhl pro obě verze.

## Co je nasazené (klient)

`packages/web/src/controller.ts`:
- `poll()` po detekci tahu enginu (`engineJustMoved`: přechod bílý→černý) počká,
  až doanimuje tah člověka (`await lastRender`), a od jeho konce nechá uplynout
  aspoň `aiMovePauseMs` (výchozí 700, injektovatelné pro testy).
- **Podlaha, ne přičtení:** `remaining = aiMovePauseMs − (now − humanMoveAnimEndAt)`.
  Když engine počítal dlouho (soft budget serveru je ~1 s), `remaining ≤ 0` a
  nespí se → hra se celkově nezpomalí. `humanMoveAnimEndAt` se přes `performance.now()`
  nastaví JEN na přechodu tah-člověka → na-tahu-engine (ne opakovanými „thinking"
  polly, jinak by se známka posouvala a podlaha by se změnila v přičtení).

## Testy (packages/web/test/controller-ai-pause.test.ts) – 3 nové

- **tah enginu se zobrazí až po pauze** (rychlá odpověď). Zuby ověřeny mutací:
  bez pauzy tah naskočí hned → padá.
- **dlouho počítající engine nedostane pauzu navíc** (podlaha). Zuby: mutace
  „přičti vždy" → padá.
- **tah enginu počká, až doběhne animace tahu člověka** (`await lastRender`, s
  mockovanou řízenou WAAPI animací – jsdom jinak jde „instant" a tuhle load-bearing
  větev by minul). Zuby: odebrání `await lastRender` → padá. Hlídá i regresi
  „lastRender se nikdy nevyřeší → trvalé busy/zamrznutí".

Celá web sada zelená (119/119), server beze změny (90/90), lint i typecheck čisté.
Pauzové testy stabilní 5× po sobě (reálné časovače, široké rezervy).

## Self-review nezávislým sub-agentem (klientská verze) – co našel a jak jsem naložil

1. **resign/offerDraw se během pauzy zdrží ≤ pauza** – reálné, ale akce se
   neztratí a je to krátké. Nechal jsem tak (rušení pauzy = over-engineering),
   zdokumentováno v kódu i v `verify` výše.
2. **Testy neprocvičovaly `await lastRender`** (jsdom bez WAAPI → instant) – to je
   ta load-bearing větev proti zamrznutí. **Doplněn** třetí test s mockovanou
   animací (viz výše).
3. **Floor závisí na kontraktu `postMove` = vrací `turn=white`** (tah enginu jen
   pollem). Kdyby to server změnil, floor by se tiše rozbil. Přidán komentář;
   kontrakt navíc přibíjí serverový test „POST vrátí HNED … thinking".
4. Reload uprostřed přemýšlení → první tah bez podlahy (edge, přijatelné).
   Ostatní obavy (dispose během pauzy, koncové zvuky, thinking-reset, deadlock)
   sub-agent ověřil jako OK.

## Doporučení

Tady vznikla reálná křižovatka (server vs. klient, s revertem serverové verze) –
stojí za ADR. Než dáš `/mini:done`, zvaž `/mini:decision`, ať se zaznamená PROČ
(server pauza se schová za animaci → páka patří na klienta). Pozor taky: goal
fáze i názvy kroků pořád mluví o serverové min-think – neodpovídají tomu, co je
nasazené (client pauza); `mini done` to bere z tohohle reportu.
