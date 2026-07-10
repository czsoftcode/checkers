---
phase: 87
verdict: done
steps:
  - title: "Politika síly + jádro výpočtu tahu"
    status: done
  - title: "Worker transport za injektovatelným rozhraním"
    status: done
  - title: "LocalClient: skeleton + createGame (+ballot)"
    status: done
  - title: "postMove + trigger enginu + poll model thinking→idle"
    status: done
  - title: "resign + offerDraw + endReason"
    status: done
  - title: "getHint + chybové cesty"
    status: done
  - title: "Regresní test: LocalClient == computeAiMove (pevný seed)"
    status: done
verify:
  - title: "Reálný Web Worker za běhu (round-trip postMessage → tah)"
    detail: "jsdom nemá Web Worker, takže `createWebWorkerEngineWorker` + `engine-worker-entry.ts` jsou ověřené jen typecheckem a Vite buildem, ne za běhu. Testy jedou přes in-process fake. Runtime chování (bundling workeru, správné párování zpráv, ~1 s search mimo hlavní vlákno) se prokáže až při napojení UI (fáze #49). Doporučuju při #49 ručně odehrát partii ve všech úrovních + nápovědu Výuky a losování Mistrovství."
---

# Fáze 87 — report z auto session

## Co je hotové
Prohlížečový `LocalClient` (`packages/web/src/local-client.ts`) implementuje celé
rozhraní `ServerClient` čistě v prohlížeči, bez serveru. Nové soubory:
- `src/local/prng.ts` — mulberry32 (vědomá kopie, web nezávisí na server/cli).
- `src/local/compute-move.ts` — `strengthFor(level)` (offline strop 12 pro silné úrovně,
  Začátečník/Střední beze změny) + `computeEngineMove` (volá `@checkers/ai computeAiMove`).
- `src/local/engine-worker.ts` — rozhraní `EngineWorker`, in-process fake (testy) +
  reálný Web Worker (provoz), s párováním zpráv přes `id` a odmítnutím visících requestů při pádu.
- `src/local/engine-worker-entry.ts` + `engine-worker-protocol.ts` — tenký vstup workeru a sdílený drátový protokol.
- `src/local-client.ts` — orchestrace (createGame +ballot, postMove + trigger enginu,
  getGame, resign, offerDraw, getHint), pravidla přes `@checkers/rules`, tah AI přes worker.

Do `packages/web/package.json` přibyly závislosti `@checkers/ai` + `@checkers/engine`
(oba browser-safe, bez `node:` mimo engine `main.ts`, který se neimportuje).
Ze `server-client.ts` je nově exportovaný `isGameDto` — testy jím ověřují, že DTO z
LocalClientu projde TÝMŽ guardem, na kterém stojí HTTP cesta i controller.

Ověřeno mechanicky: typecheck (všech 6 balíčků), eslint, `vite build`, a celá testová
sada monorepa **1435 testů zelených** (web 549, z toho 30 nových lokálních).

## Věrnost serverové cestě (kontrakt)
- **offerDraw:** `searchTimed(position).score` přepočtený na pohled enginu
  (`turn===engineColor ? score : -score`), přijmout `<= 0` — bit po bitu jako app.ts.
- **resign:** výherce = `opposite(humanColor)` (obrácená barva správně).
- **createGame + první tah enginu:** člověk=bílý i Mistrovství (bílý na tahu po ballotu)
  spustí engine hned; model `thinking`→`idle`; odpověď nese `thinking` PŘED aplikací tahu enginu.
- **poll model:** `postMove` vrátí stav hned, tah enginu se aplikuje proti AKTUÁLNÍ
  pozici až po awaitu, guard je před prvním awaitem (nezasekne se v `thinking`).

## Zuby testů (ověřeno dočasným rozbitím)
- Změna nepozornosti v `strengthFor` → padne unit test `strengthFor` i regresní test.
- Použití knihy v nápovědě → padne test „nápověda NEpoužívá knihu".
- offerDraw: verdikt porovnán s NEZÁVISLE spočítaným prahem z primitiva; obě větve
  (přijetí i řízeně dosažené odmítnutí) reálně proběhnou.
- Chybová cesta tahu enginu (worker selže) → `engineStatus='error'`, partie žije.

## Nálezy nezávislého self-review (fresh-context sub-agent) a jak jsem je vyřešil
1. **[OPRAVENO] getHint používal knihu, serverová nápověda ne.** Server hint =
   `bestmove(position, undefined)` bez knihy; LocalClient v zahájení radil knižní tah
   (11→15) místo hledaného (9→13). Přidán `useBook:false` do hint cesty + zubatý test.
2. **[OPRAVENO] Špatný chybový kód** u `ballotIndex` mimo Mistrovství (`game_over` →
   `invalid_request`, jako server), test kontroluje kód i status.

## Vědomé kompromisy (neopravené, s odůvodněním)
- **offerDraw počítá `searchTimed` na HLAVNÍM vlákně** (worker rozhraní umí jen
  `computeMove`, jak stanovil plán fáze). Při nabídce remízy tak UI může na ~1 s zamrznout.
  Věrnost síly se serverem je zachovaná; jde o UX. Pokud to při #49 vadí, čistá cesta je
  přidat workeru `evaluate` (samostatná drobná fáze). Tah AI i nápověda běží mimo vlákno.
- **Regresní test nedosáhne hloubky, kde by strop 12 vázal** (fast-clock zastaví search
  na hloubce 1), takže rovnost „LocalClient == computeAiMove" ověřuje „mimo strop 12"
  přesně jak zadání chce; zuby pro hodnotu stropu drží unit test `strengthFor`. Server
  strop nemá, takže nad hloubkou 12 se cesty rozejít MAJÍ — to není chyba.
- **Bez tvrdého timeoutu na `worker.computeMove`** — konzistentní se serverem (ten na
  chybu enginu taky nemá extra retry); pád workeru řeší `onerror`/`dispose` odmítnutím pending.

## Poznámka k dalšímu
Napojení UI na LocalClient, offline build, PvP a jakákoli změna serveru jsou MIMO řez
(fáze #49/#50 a dál). Tato fáze je čistá logika + testy, bez UI wiringu.
