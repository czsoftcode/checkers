---
phase: 13
verdict: done
steps:
  - title: "Definice protokolu a typů zpráv"
    status: done
  - title: "Řádkový buffer"
    status: done
  - title: "Zpracování zpráv jako čistá funkce"
    status: done
  - title: "Spustitelný proces enginu"
    status: done
  - title: "Integrační test přes skutečný podproces"
    status: done
---

# Phase 13 — report from the auto session

## Co vzniklo

Balíček `@checkers/engine` už není kostra – je z něj spustitelný proces s JSON Lines protokolem:

- **`src/protocol.ts`** – kontrakt: `PROTOCOL_VERSION = 1`, `ENGINE_ID`, typy požadavků (`hello`, `bestmove`) a odpovědí (`hello`, `bestmove`, `error` se šesti kódy). Pozice a tah se přenášejí přímo jako JSON tvar typů `Position`/`Move` z `@checkers/rules` – server v M4 má importovat tyhle typy, ne opisovat literály.
- **`src/line-buffer.ts`** – čistá třída skládající chunky na kompletní řádky (rozseknutý řádek, víc řádků v chunku, CRLF i rozseknuté CRLF, prázdné řádky, zbytek při EOF).
- **`src/handler.ts`** – čistá funkce `handleLine(raw, rng)`: hello → handshake, bestmove → náhodný legální tah (seedovatelný mulberry32, vědomá kopie z CLI). Všechny očekávatelné vady vstupu vracejí `error` (invalid_json, invalid_message, unknown_type, invalid_position, no_legal_moves), programátorské chyby propadají výš.
- **`src/respond.ts`** – poslední záchrana: výjimka handleru → `internal_error` s best-effort obnoveným `id` (server si spáruje i odpověď na požadavek, u kterého engine vybuchl), stack jde celý na stderr.
- **`src/main.ts`** – dráty: stdin → LineBuffer → respondToLine → stdout. Exit 0 jen při EOF nebo zavřené stdout rouře (spadlý čtenář, ošetřený EPIPE), exit 1 při chybných argumentech.
- **Testy: 44** (buffer 10, handler 19, respond 8, integrace 6, smoke 1). Integrační test spawnuje SKUTEČNÝ proces (`node --import tsx`): handshake, legální bestmove ověřený reálnou rules knihovnou, zpráva rozsekaná doprostřed řádku, dvě zprávy v jednom zápisu, garbage → error a proces dál žije, EOF → exit 0 + zpracování posledního řádku bez `\n`, neplatný seed → exit 1. Každé čekání má tvrdý timeout a `afterEach` proces zabíjí i při selhání.

Celé repo: lint, typecheck i testy všech balíčků zelené (5 balíčků, rules 259 + engine 44 + cli 24 + smoke).

## Nezávislý self-review (sub-agent) a co se s ním stalo

Fáze sahá na vstupní bod procesu a mezimodulový kontrakt, takže běžel nezávislý review s čerstvým kontextem. Nálezy a řešení:

1. **STŘEDNÍ – `internal_error` ztrácel `id`** → opraveno (`respond.ts`, extractId), pokryto unit testy včetně obou null větví.
2. **NÍZKÁ – neošetřený `error` event stdout/stdin (EPIPE = nedokumentovaný pád)** → opraveno v main.ts, exit 0 + opravená dokumentace exit kódů.
3. **NÍZKÁ – neomezený růst bufferu u řádku bez `\n` (OOM)** → vědomě odloženo, zapsáno do mini todo pod M6 (lokální důvěryhodný peer, jediný známý způsob, jak vstupem shodit proces).
4. **NÍZKÁ – integrační test používal LineBuffer ze src jako vlastní orákulum** → opraveno, harness má naivní split napsaný přímo v testu.
5. Kosmetika: doplněn unit test CRLF rozseknutého mezi chunky; usage teď říká, že seed bere dolních 32 bitů. Ponecháno beze změny: `tsx ^4.20.0` natvrdo (stejně jako v CLI balíčku, konzistentní s repem).

## Vědomá rozhodnutí (kandidát na /mini:decision)

Pozice se posílá jako plný JSON (`board` 32 polí + `turn`), tah jako objekt `{from, path, captures}` – zvažovaná a zamítnutá alternativa byla PDN string + historie tahů (kompaktnější, ale nejednoznačné parsování a engine by musel přehrávat partii). Pokud to stojí za ADR, spusť `/mini:decision` před `/mini:done`.

## Na co si dát pozor dál

- Protokol zatím nenese remízový stav (čítač půltahů, historie opakování) ani časový limit – bestmove dostane jen pozici. Rozšíření přijde s fází 14/15 (search + časová kontrola); verze protokolu na to je.
- `bestmove` na pozici bez tahů vrací `error no_legal_moves` – server musí konec partie poznat sám dřív, než se enginu ptá (stejný kontrakt jako u CLI random hráče).
