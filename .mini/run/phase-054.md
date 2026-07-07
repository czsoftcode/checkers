---
phase: 54
verdict: done
steps:
  - title: "Plumbing: ballotIndex v GameDto + createGame"
    status: done
  - title: "Stav zápasu + barvy podle kola v startNewGame"
    status: done
  - title: "Terminální handler: owed 2. kolo, rozlišení vzdání, championship mimo flip"
    status: done
  - title: "Auto-start 2. kola po zavření modalu"
    status: done
  - title: "Testy se zuby + ověření unhappy path"
    status: done
verify:
  - title: "Odehrát reálný zápas 2 kol v prohlížeči (Mistrovství)"
    detail: "Testy jsou server-independent (fake klient). Ověřeno mechanicky: argumenty createGame, barvy, auto-start, zámek úrovně. Lidským okem stojí za kontrolu skutečný průběh proti běžícímu serveru+enginu: 1. kolo (člověk černý, engine otevírá) → výsledkový modal → po zavření 2. kolo se STEJNÝM zahájením a člověkem bílým (člověk táhne první) → po 2. kole stop, další partie až na Nová hra. A že animace ballotu 2. kola i zvuky sedí."
---

# Phase 54 — report z auto session

## Co je hotové
Klient staví nad partiemi „zápas 2 kol" na úrovni Mistrovství. Vše ověřeno mechanicky (typecheck všech balíčků, 919 testů napříč repem zelených, lint čistý).

**Plumbing (`server-client.ts`):** `GameDto` má nové `ballotIndex?: number | null`; `isGameDto` ho validuje (nezáporné celé / null / chybějící OK, jiné = drift → odmítne); `createGame(level, humanColor, ballotIndex?)` posílá index do těla POST /games JEN když je zadán (0 se pošle korektně — podmínka `=== undefined`, ne truthy).

**Stavový automat + barvy (`app-shell.ts`):** stav zápasu jen v paměti (`matchBallotIndex`, `playingRoundTwo`, `currentIsChampionship`, `currentBallotIndex`, `resignedThisGame`). Barvy u Mistrovství FIXNÍ podle kola (1. kolo černá = engine otevírá, 2. kolo bílá = člověk táhne první), nezávisle na alternaci `nextColor` (ta zůstává jen pro ostatní úrovně). 2. kolo se spustí AUTO po zavření výsledkového modalu 1. kola (`closeModalByUser`). Vzdání 1. kola zápas zruší. Úroveň zamčená na Mistrovství po celý zápas (i ve 2. kole, kde firstMoveMade sám neuzamkne).

## Nezávislý self-review — 1 potvrzený nález OPRAVEN + 2 okrajové
Sub-agent (čerstvý kontext) našel **reálnou tichou chybu na unhappy path**:

- **Nález 1 (CONFIRMED, opraveno):** `resignedThisGame` se nastavoval optimisticky při kliknutí na Vzdávám, ale `controller.resign()` byl fire-and-forget `void`. Když vzdání selže (síť → `resync` vrátí partii na ongoing) a hráč 1. kolo pak dohraje REGULÉRNĚ, příznak zůstal viset → regulérní konec se vyhodnotil jako vzdání a zápas se omylem zrušil (2. kolo nenaskočilo). **Oprava:** `resign()` přijímá volitelný callback s výsledkem (`didResign`); app-shell příznak sundá, když vzdání neproběhlo. Zvolil jsem callback místo `Promise<boolean>` návratu záměrně — return by u existujících `controller.resign();` v ~6 controller testech vyvolal lint `no-floating-promises` (zbytečný churn). Přidán cílený test se zuby (selhané vzdání → callback(false) → regulérní konec spustí 2. kolo); ověřeno, že bez opravy padá.
- **Nález 2 (okrajové, opraveno):** `refreshControls()` běžel v `render()` PŘED nastavením `matchBallotIndex` v terminální větvi → mezi koly byl za otevřeným modalem výběr úrovně krátce odemčený (klávesnicí dosažitelný). Přesunut na konec `render()`.
- **Nález 3 (okrajové, opraveno):** selhání `createGame` 2. kola nechávalo `playingRoundTwo=true` (viselý zámek úrovně). `catch` v `startNewGame` teď stav zápasu vyčistí.

Sub-agent potvrdil bez nálezu: plumbing ballotIndex (0/NaN/Infinity/null/chybějící správně), barvy (championship nikdy nesahá na nextColor, 1. kolo vždy černá), žádná rekurze/dvojí 2. kolo, error nespouští kolo, disposed guard proti zombie controlleru.

## Testy se zuby (ověřeno reálným rozbitím)
Cílené breaky → padne správný test, po revertu zelené: (a) championship bere barvu z alternace → „začíná ČERNOU" padne; (b) ignorace příznaku vzdání → „vzdání zruší zápas" padne; (c) callback nesundá příznak → „selhané vzdání" padne. Pokryto: auto-start 2. kola (stejný index, bílá), žádné 3. kolo, vzdání ruší, non-championship beze změny, championship začíná černou i po prokládané hře, zámek úrovně ve 2. kole, dispose bez zombie, plumbing (createGame body, isGameDto drift).

## Mimo rozsah (dle discuss)
Reload zápas nedrží (jen v paměti — rozhodnutí discuss). Cíl fáze zmiňoval LocalStorage, ale rozhodnutí bylo in-memory (viz `.mini/discuss/phase-054.md`).
