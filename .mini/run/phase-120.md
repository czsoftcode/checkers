---
phase: 120
verdict: done
steps:
  - title: "Ověřit wiring variant→GameState"
    status: done
  - title: "Unit adversariál: findLegalMove(ITALIAN_RULESET)"
    status: done
  - title: "Serverový integrační test (jádro)"
    status: done
  - title: "E2E integrační WS: partie dvou klientů"
    status: done
  - title: "Živá kontrola v prohlížeči + brána"
    status: done
verify:
  - title: "Re-kontrola opravy italské PvP desky ve dvou oknech prohlížeče"
    detail: "Uživatel při živé kontrole našel bug: v PvP italské byly kameny na SVĚTLÝCH polích (v AIvP správně). Opraveno v board-view.ts (setVariant teď dorovná i geometrii, ne jen assety) + 3 regresní testy s prokázanými zuby. Zbývá lidské vizuální potvrzení ve dvou oknech, že kameny teď sedí na tmavém dřevě a partie jde odehrát (výzva → hra → tah přes vynucené braní)."
---

# Phase 120 — report z auto session

## Co se povedlo

Fáze byla VERIFY + adversariální test, ne nová validační vrstva – a přesně tak dopadla: žádný produkční kód se neměnil, přibyly jen dva testovací soubory v `packages/server/test/`.

**Wiring (krok 1) – doloženo čtením, bez přepisu.** `app.ts` `handleAccept` (ř. 469) volá `store.createPvp(challengerId, challengedId, me.variant)`, kde `me.variant` je varianta LOBBY dvojice (guard na ř. 452 ji zúží z `VariantId | null` na `VariantId`, ne-člen předsíně sem legálně neprojde). `store.createPvp` (ř. 202) zapíše `state: initialGameState(undefined, variant)` → `GameState.variant='italian'`. Server pak v `tryApplyMove` (ř. 212) bere `rulesetForVariant(record.state.variant)` = ITALIAN_RULESET pro `findLegalMove`. Plumbing z fáze 103/105 platí i pro italskou; žádný tichý default na american. Test `italská partie nese variantu` to i mechanicky potvrzuje (`state.variant === 'italian'`).

**Unit adversariál (krok 2)** – `italian-authority-dto.test.ts`, 8 testů nad reálným `findLegalMove(..., ITALIAN_RULESET)`. Tři italsky-specifické nelegality → `undefined` (server odmítne): (a) nemaximální 2-braní když existuje 3-braní, (b) braní mužem místo povinné dámy, (c) muž bere dámu. Legální maximum → non-null. Každý případ má ZUB: s AMERICAN_RULESET se odmítnutý tah NAJDE, což dokazuje, že ho odstranil výběr italského rulesetu, ne obecná nelegalita. Pozice = tytéž golden fixtury jako v `packages/rules`.

**Serverový integrační test – JÁDRO (krok 3)** – `italian-pvp-authority-ws.test.ts`, reálný WS harness (styl `variant-lobby-ws.test.ts`). Rozlišující pozici jsem NAŠEL BFS skriptem: 5 legálních italských tahů z výchozího rozestavění (`9-13, 21-17, 6-9, 17-14, 9x18`) → pozice, kde bílý má americky legální 1-braní `23x14`, ale italsky je povinné 2-braní `22x15x6` (maximum). Server `23x14` odmítne (`error` „Nelegální tah"), GameState se NEZMĚNÍ (5 tahů, týž hráč na tahu, žádný push), a maximum `22x15x6` přijme. Bez store-seamu (jen sehrání legálních tahů). Dokazuje VÝBĚR rulesetu podle varianty místnosti, ne obecnou nelegalitu (fáze 70).

**E2E (krok 4)** – druhý test v témže souboru: dva klienti odehrají KOMPLETNÍ italskou partii od zahájení do výsledku. Tahy generuje `@checkers/rules` (legalMoves ITALIAN + deterministický mulberry32 seed), linie NENÍ hardkódovaná. Po každém půltahu se pozice serveru porovná s klientovou (`positionKey`) – autorita = tatáž sdílená pravidla. Ověřeno, že partie doběhne s výsledkem (22 půltahů, white-wins), protne vynucené povinné braní i vícenásobné maximum, a server rozešle terminální výsledek oběma.

**Zuby ověřeny adversariálně:** dočasně jsem v `app.ts` přepsal výběr rulesetu na `rulesetForVariant('american')` → OBA WS testy spadly (server přijal `23x14` / E2E linie se rozešla). Revert čistý (`git checkout`). Testy tedy testují reálný kontrakt, ne kopii.

**Brána (krok 5, mechanická část):** `pnpm typecheck` čistý; `pnpm -r test` zelený (rules 435, cli 24, engine 273, ai 57, server 216 = +10 nových, web 660). `packages/rules/src` bez diffu → perft nedotčen, ostatní varianty (americká/pool/ruská/česká) netknuté (jejich testy prošly beze změny).

## Co zbývá / na co dát pozor

- **Živá kontrola v prohlížeči** (viz `verify`): dvouklientský E2E je pokrytý protokolově přes reálný WS, ale vizuální/UX playthrough ve dvou oknech (otočená deska, red/white kameny, tah přes vynucené braní) je na lidské oko – jako fáze 117. Neautomatizoval jsem to schválně: browser automation dvou souběžných PvP klientů je flaky a nepřidá nad zelený WS E2E nic protokolově nového.
- Rozlišující pozici (krok 3) i seed E2E (krok 4) jsem odvodil skriptem nad `@checkers/rules`; kdyby se italská pravidla v budoucnu změnila, WS jádro drží na komentované logice (americky-legální / italsky-nelegální), E2E na oracle z rules (linie se přepočítá, jádro „doběhne s výsledkem" platí dál).

Žádné rozcestí k ADR (žádná zamítnutá alternativa) – šlo o přímočarý verify + test podle diskuse.

## Následná oprava (bug z živé kontroly)

Uživatel při živé kontrole ve dvou oknech našel reálnou chybu: v PvP italské partii
seděly kameny na SVĚTLÝCH polích, zatímco v AIvP byly správně na tmavých. Fáze tak
přestala být čistě ověřovací – opravil jsem produkční kód.

**Příčina:** `board-view.ts` počítal italské zrcadlení sloupců (kameny na tmavou
paritu) jen JEDNOU při vytvoření desky, z parametru `variant`. AIvP variantu zná hned
(`controller.ts` ji předá), takže se zrcadlilo správně. PvP ale variantu v čase
vytvoření NEZNÁ (dorovnává ji `setVariant` z prvního stavu partie) a `setVariant`
přepínal jen assety + CSS třídu, NE geometrii → deska měla italské pozadí, ale hrací
pole (a kameny) na světlé paritě.

**Oprava:** buňky se vytvoří v reálném pořadí do mřížky a jejich pořadí v DOM řídí nová
`applyLayout(isItalian)`, kterou volá `setVariant`. Zrcadlení tak doběhne i pozdě (PvP).
`applyLayout` je idempotentní (guard `laidOutItalian`), takže opakovaný `setVariant`
nepřeruší animaci. Čistě vizuální – `data-square`, parita polí, klik i validace jdou dál
z reálných (row, col). Přidány 3 regresní testy (PvP cesta: geometrie po `setVariant`,
návrat na neitalskou, kámen na tmavém poli); zuby prokázány (reprodukce původního bugu
shodí přesně tyto 3, AIvP testy procházejí dál). Web suita 663 (+3) zelená, tsc čistý.
