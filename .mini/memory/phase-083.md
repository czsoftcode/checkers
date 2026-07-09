# Phase 83 — i18n: AI obrazovka (hra vs. počítač)

**Goal:** Přeložit přes t() obrazovku hry proti počítači (app-shell.ts + controller.ts): výběr úrovně soupeře, tlačítka (nabídnout remízu, vzdát, nová hra, do místnosti), modal potvrzení vzdání, výsledky (vyhráli jste / vyhrál počítač / remíza), reakci počítače na nabídku remízy a chybové hlášky při zakládání partie, s klíči cs/en a testy se zuby. Kritické: popisky úrovní zůstávají jen zobrazovací - interní hodnota (professional atd.) jde po drátě anglicky, přeloží se jen label. Mimo fázi: ruční přepínač jazyka, board-view (bez českých textů), serverové hlášky.

## Steps
- [done] Klíče ai.* do slovníků cs/en
- [done] Migrace app-shell.ts na t()
- [skipped] Migrace controller.ts na t()
- [done] Ochrana stávajících testů na cs
- [done] Zubaté testy: úrovně (hodnota EN) + terminalMessage
- [done] Ověření: build + typecheck + lint + testy + ruční průchod

## Auto-commit
- Phase 83: i18n: AI obrazovka (hra vs. počítač)

## Run report
---
phase: 83
verdict: done
steps:
  - title: "Klíče ai.* do slovníků cs/en"
    status: done
  - title: "Migrace app-shell.ts na t()"
    status: done
  - title: "Migrace controller.ts na t()"
    status: skipped
  - title: "Ochrana stávajících testů na cs"
    status: done
  - title: "Zubaté testy: úrovně (hodnota EN) + terminalMessage"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Ruční průchod hry proti počítači v cs i en"
    detail: "Mechanicky ověřeno (build, typecheck, lint, 1376 testů zelených). Neověřeno okem: reálné vykreslení v prohlížeči - výběr úrovně (rozbalovací nabídka), dohrát partii proti počítači do výsledku (výhra/prohra/remíza → modal), potvrzení vzdání, nabídnout remízu (reakce počítače), tlačítko Do místnosti. V cs nastavení a pak v en (např. přes en-US v jazycích prohlížeče). Kontrola, že delší anglické texty (hlavně 'The computer reports an error, the game is halted.') nerozbijí layout panelu/modalu."
---

# Phase 83 — report z auto session

## Co se udělalo
Obrazovka hry proti počítači (`app-shell.ts`) je celá přeložená přes `t()`:
- **23 nových klíčů `ai.*`** v obou slovnících `i18n.ts` (cs zdroj pravdy, en přibitý přes `satisfies`).
- **`LEVEL_LABELS` (hotové české texty) → `LEVEL_LABEL_KEYS: Record<GameLevel, MessageKey>`** — popisky úrovní jdou přes `t()`, ale odesílaná HODNOTA (`<option value>`, `professional` atd.) zůstává anglická na drátě. Typová úplnost přes všechny úrovně zachována (`Record<GameLevel, …>`).
- Migrováno: výběr úrovně (aria + popisky), tlačítka (nabídnout remízu, vzdát, nová hra, do místnosti, zavřít), inline potvrzení vzdání, `terminalMessage` (výhra/prohra podle barvy člověka + remíza + chyba enginu), reakce počítače na nabídku remízy, hláška načítání a chyba zakládání partie.

## Krok 3 (controller.ts) — SKIPPED, vědomě
Plán předpokládal, že controller nese UI prefixy hlášek. **Realita: všech 8 českých stringů v `controller.ts` jsou `console.error(...)` — vývojářské logy do konzole, ne text viditelný uživateli.** Controller nemá žádný `textContent`/`aria-label`/`throw` s textem; deskou deleguje na `board-view`, skořápce hlásí strukturovaný `GameStatus` (bez českého textu). Konzolové debug logy se nelokalizují — jsou pro vývojáře, ne pro hráče, a překlad by byl zbytečná vrstva (proti zásadě „nepřidávej vrstvy"). Nezávislý self-review to potvrdil: žádný z logů neprotéká k uživateli.

## Testy (mají zuby)
Nový `app-shell-i18n.test.ts` (16 testů) nad REÁLNÝM `createAppShell` a reálnými slovníky (ne mock):
- **Kontrakt úrovní:** `<option value>` = anglická hodnota, `<option>` text = lokalizovaný popisek; po výběru úrovně v selectu dostane `client.createGame` anglickou hodnotu (`championship`, ne `Mistrovství`).
- **terminalMessage** (přes DOM modal, funkce je interní): výhra i prohra × obě barvy člověka (black/white) + remíza + chyba enginu, v cs i en.

Ověřeno třemi injektovanými chybami: prohození `resultWin`/`resultLoss` → 9 spadlých, přeložení HODNOTY úrovně (`opt.value = label`) → 2 spadlé (kontrakt chycen), rozbití en klíče → 3 spadlé.

Stávající `app-shell.test.ts` dostal `setLocale('cs')` do beforeEach (default locale v jsdom je en → jeho české asserty by jinak spadly). `controller-*.test.ts` úpravu nepotřebovaly — controller nemá lokalizovaný text.

## Ověření
`pnpm typecheck` (4 balíčky), `pnpm lint` (eslint), `pnpm --filter @checkers/web build`, `pnpm -r test`: **1376 testů zelených** (web 496, +16 nových; rules 266, cli 24, engine 250, server 340). Vše prošlo.

## Nezávislý self-review
Fáze sahá na cross-module kontrakt (`LEVEL_LABEL_KEYS` ↔ `GameLevel`, kontrakt úrovní UI↔server) → adversariální review nezávislým sub-agentem. **Žádný funkční nález:** kompletnost OK, kontrakt úrovní bez rizika 400, párování výsledku nezaměněno, testy mají zuby (vč. ověření, že „white perspektiva" opravdu testuje bílého — localStorage se nastaví před mountem), izolace globálního locale bez leaku, párování cs↔en 1:1 vynucené typem.

## Vědomá omezení (ne nález)
- **Jazyk fixní při vzniku obrazovky** — `t()` se vyhodnotí při `createAppShell`, texty se za běhu nepřekreslují (stejně jako lobby/PvP; ruční přepínač jazyka není v této fázi).
- **Konzolové logy a chybové logy zůstávají česky** (`console.error` v app-shell i controller) — vývojářské stopy, ne UI.
- **Mimo řez:** ruční přepínač jazyka, `board-view.ts` (nemá žádné české UI texty — jen komentáře). Po fázích 81-83 je lokalizované celé viditelné UI klienta (lobby + PvP + AI); zbývá už jen ruční přepínač a serverové hlášky.
- Drobná duplicita: `ai.toRoom` a `game.backToRoom` mají v en shodný text ('Back to the room') — oddělené namespace, ne chyba.
