# Phase 81 — i18n jádro + lobby (cs/en)

**Goal:** Postavit lokalizační jádro (detekce jazyka z navigator.languages → cs/en s fallbackem en, funkce t() + slovníky cs/en, dynamické nastavení <html lang>) a přeložit jím vstupní obrazovku lobby jako první ověřený svislý průřez.

## Steps
- [done] i18n jádro: detekce jazyka + t()
- [done] Bootstrap locale + <html lang>
- [done] Klíče lobby: cs + en překlady
- [done] Migrace lobby.ts na t()
- [done] Testy lobby se zuby (cs/en/fallback)
- [done] Ověření: build + typecheck + lint + testy + ruční průchod

## Auto-commit
- Phase 81: i18n jádro + lobby (cs/en)

## Run report
---
phase: 81
verdict: done
steps:
  - title: "i18n jádro: detekce jazyka + t()"
    status: done
  - title: "Bootstrap locale + <html lang>"
    status: done
  - title: "Klíče lobby: cs + en překlady"
    status: done
  - title: "Migrace lobby.ts na t()"
    status: done
  - title: "Testy lobby se zuby (cs/en/fallback)"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Vizuální průchod lobby v cs i en prohlížeči"
    detail: "Mechanicky ověřeno, že správný slovník RENDERUJE (jsdom testy). Vizuálně jsem NEověřil: že se delší anglické texty (např. „Play against the computer", „Could not connect to the room…") vejdou do karty lobby a tlačítek a nerozbíjejí layout na mobilu i desktopu. Přepni jazyk prohlížeče (nebo DevTools → Sensors → Locale) na en vs cs, reload, projdi vstup, roster, výzvu, odpojení."
  - title: "<html lang> se reálně přepíná v prohlížeči"
    detail: "Wiring `document.documentElement.lang = initLocale()` v main.ts je jen typecheck+build ověřený (jde o jeden řádek na vstupním bodu, který nejde rozumně unit-testovat bez natažení celého bootstrapu s WS). V prohlížeči zkontroluj v Elements, že <html lang> je „en\" při anglickém prohlížeči a „cs\" při českém (statické lang=cs z index.html se má přepsat)."
---

# Phase 81 — report z auto session

## Co je hotové
Postaveno lokalizační jádro `src/i18n.ts` (cs/en):
- `detectLocale(languages)` — čistá funkce, vybere první podporovaný jazyk podle prefixu (`cs-CZ`→cs, `en-US`→en), fallback `en`.
- `initLocale()` / `setLocale()` / `getLocale()` — aktivní jazyk drží modul jako jedináček; `initLocale()` čte prohlížeč a vrací hodnotu pro `<html lang>`.
- `t(key, params?)` — dva ploché slovníky se STEJNOU sadou klíčů; anglický je přes `satisfies Record<MessageKey,string>` přibitý na klíče českého, takže chybějící překlad neprojde typecheckem. Interpolace `{jméno}` přes `=== undefined` (ne truthy → nula i prázdný string se dosadí korektně).

Bootstrap v `main.ts`: `document.documentElement.lang = initLocale()` PŘED prvním renderem lobby (přepíše statické `lang="cs"`).

Migrace `lobby.ts`: všechny KLIENTEM skládané user-facing řetězce jdou přes `t()` (nadpisy, tlačítka, placeholder, aria-label, „(ty)", výzva od X, čekání, obsazená přezdívka, hlášky odpojení). Serverem dodané hlášky (`onNotice`, `onError`, návrh přezdívky z `onNickTaken`) ZŮSTÁVAJÍ v jazyce serveru — vědomá hranice, zdokumentovaná v hlavičce `lobby.ts` i u příslušných míst.

## Testy
- `test/i18n.test.ts` — 14 testů: detekce (prefix, fallback, pořadí, velikost písmen, prázdno), interpolace včetně nuly a nedodaného placeholderu.
- `test/lobby-i18n.test.ts` — svislý průřez přes REÁLNÝ `createLobby`: `navigator.languages` → render cs / en / fallback (de→en). Ověřeno zuby: mutace anglického klíče shodí 2 asserty.
- `test/lobby.test.ts` — do `beforeEach` přidán `setLocale('cs')` (jsdom hlásí `en-US`, jinak by české asserty spadly).
- Celý web balíček: **451 testů zelených**. Lint, typecheck (5 balíčků), build — vše čisté.

## Adversariální self-review (nezávislý sub-agent, čerstvý kontext)
Sub-agent našel 3 opravitelné věci, všechny vyřešeny PŘED tímto reportem:
1. `browserLanguages`: guard `navigator.languages.length` by sám spadl v prostředí bez `languages`, ač komentář sliboval obranu → přepsáno defenzivně přes `?.` a opravený komentář (reálný důvod fallbacku je prázdné `languages` v privacy režimu, ne staré prohlížeče).
2. Stejný okraj u `navigator.language` → pokryto stejným přepisem (`single ? [single] : []`).
3. Test „číselný parametr" fakticky posílal string → přepsán na skutečné číslo `42` + přidán zub na `0` (chytil by regresi z `=== undefined` na truthy).

Sub-agent potvrdil jako v pořádku: parita slovníků je reálně vynucená kompilátorem, žádný leak jedináčka mezi testy (vitest izoluje soubory), migrace lobby bez záměny klíčů a bez zbylých natvrdo psaných řetězců, správné pořadí bootstrapu v main.ts.

## Vědomá omezení (ne nález, ale ať je to jasné)
- Přeložena je JEN lobby. Zbytek UI (herní obrazovka, sólo deska proti počítači, modaly konce partie, důvody konce, chybové hlášky) je pořád česky — vědomý mezistav prvního průřezu, doberou navazující fáze.
- Bez ručního přepínače jazyka — jazyk určuje jen nastavení prohlížeče (záměrně mimo tuto fázi).
- Produktový název „Americká dáma" (`APP_TITLE`, `document.title`) je značka, nepřekládá se.
- Serverové hlášky zůstávají česky (viz hranice výše) — v anglickém prohlížeči tak dnes uvidí uživatel u chyb/notice češtinu. Lokalizace serverových textů je na pozdější fázi (chce zásah do serveru, který je autorita).
