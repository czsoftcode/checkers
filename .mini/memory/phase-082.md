# Phase 82 — i18n: PvP herní obrazovka + modaly konce

**Goal:** Přeložit přes t() celou PvP herní obrazovku (game-screen.ts) včetně stavového pruhu, tlačítek (vzdát/remíza/odveta/konec), modalů konce partie a textů důvodů konce, s klíči cs/en a testy pokrývajícími obě strany (výhra/prohra) × každý důvod konce. Mimo tuto fázi: solo AI obrazovka, popisky desky, ruční přepínač jazyka.

## Steps
- [done] Klíče game.* do slovníků cs/en
- [done] Migrace outcomeText na t()
- [done] Migrace UI prvků a modalů na t()
- [done] Testy se zuby: výsledek × důvod × obě strany, cs/en
- [done] Ověření: build + typecheck + lint + testy + ruční průchod

## Auto-commit
- Phase 82: i18n: PvP herní obrazovka + modaly konce

## Run report
---
phase: 82
verdict: done
steps:
  - title: "Klíče game.* do slovníků cs/en"
    status: done
  - title: "Migrace outcomeText na t()"
    status: done
  - title: "Migrace UI prvků a modalů na t()"
    status: done
  - title: "Testy se zuby: výsledek × důvod × obě strany, cs/en"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Ruční průchod PvP partie v prohlížeči v cs i en"
    detail: "Mechanicky ověřeno (build, typecheck, lint, 1360 testů zelených). Neověřeno okem: skutečné vykreslení dvou klientů proti sobě - vstup do místnosti, výzva, dohrát partii do výsledku a otevřít modaly (potvrzení vzdání, příchozí remíza, výsledek Odveta/Konec, nabídka odvety, ztráta spojení) v prohlížeči s cs nastavením a pak s en (např. přes en-US v jazycích prohlížeče). Kontrola, že se nic nerozbije v layoutu delšími anglickými texty a že aria-label sedí."
---

# Phase 82 — report z auto session

## Co se udělalo
Herní PvP obrazovka (`game-screen.ts`) je kompletně přeložená přes `t()`:
- **37 nových klíčů `game.*`** v obou slovnících `i18n.ts` (cs zdroj pravdy, en přibitý přes `satisfies Record<MessageKey, string>` - chybějící/přebytečný klíč neprojde typovou kontrolou).
- **Migrováno:** stavový pruh (připojuji / ztráta spojení), panel (Soupeř:, Nabídnout remízu, Vzdát se), aria-label indikátoru na tahu, všechny modaly (potvrzení vzdání, příchozí remíza, výsledek s Odveta/Konec, čekání na odvetu, ztráta spojení, příchozí odveta) a běhové notice hlášky.
- **`outcomeText` exportována** a přepsaná na `t()` se zachovaným párováním `iWin × reason`.

## Testy (mají zuby)
Nový `game-screen-i18n.test.ts` (29 testů): matice `outcomeText` pro obě strany (výhra/prohra) × každý důvod konce (draw-agreement / rules / resign / null) × oba jazyky, nad REÁLNOU funkcí a REÁLNÝMI slovníky (ne mock). Plus DOM smoke, že se obrazovka reálně vykreslí anglicky (tlačítka + výsledkový modal). Ověřeno dvěma injektovanými chybami:
- prohození `resignWin`/`resignLoss` → spadlo 12 testů,
- rozbití anglického klíče `resultWin` → spadly 2 testy.

Stávající `game-screen.test.ts` dostal `setLocale('cs')` do `beforeEach` - default locale v jsdom je `en` (navigator `en-US`), takže jeho české asserty na texty by po migraci jinak spadly. Ty testy ověřují chování, ne jazyk, proto jsou přibité na cs.

## Ověření
`pnpm typecheck` (4 balíčky), `pnpm lint` (eslint), `pnpm --filter @checkers/web build`, `pnpm -r test` (rules 266, cli 24, web 480, engine 250, server 340 = **1360 testů zelených**). Vše prošlo.

## Nezávislý self-review
Fáze sahá na cross-module i18n kontrakt (klíče sdílené mezi `i18n.ts` a `game-screen.ts`) a na globální stav (`currentLocale` singleton), proto proběhl adversariální self-review nezávislým sub-agentem (čerstvý kontext). **Žádný funkční nález:** kompletnost překladu OK (žádný český UI string nezůstal; `errorLine`/`modalNotice` nesou serverovou hlášku, která zůstává v jazyce serveru vědomě dle hranice fáze 81), párování cs↔en 1:1 vynucené typem, testy mají zuby a nemají pořadovou vazbu (vitest izoluje soubory, `afterEach(initLocale)` resetuje).

## Vědomá omezení (ne nález)
- **Jazyk je fixní v okamžiku vzniku obrazovky** - `t()` se vyhodnotí při `createGameScreen`, texty se za běhu nepřekreslují. Bez reaktivity, protože ruční přepínač jazyka není v této fázi (a v lobby to je stejně). Až přijde přepínač, bude potřeba buď re-mount obrazovky, nebo re-render textů.
- **Serverové hlášky zůstávají česky** - chyby tahu (`errorLine`) a některé notice v modalu nesou hotový text ze serveru; v anglickém prohlížeči u nich uživatel uvidí češtinu. Lokalizace serveru je autorita a patří do pozdější fáze (hranice z fáze 81 platí).
- **Mimo řez (dle zadání fáze):** solo AI obrazovka (`app-shell.ts`/`controller.ts`), popisky desky (`board-view.ts`), ruční přepínač jazyka. Ty doberou navazující fáze.
- Nekonzistentní kombinace `výhra + draw-agreement/rules` (serverově nevznikne) vrátí generické „Vyhrál/Prohrál jsi" - rozumný fallback, netestovaný.
