---
phase: 91
verdict: done
steps:
  - title: "Odstranit mrtvé store metody bez volajícího"
    status: done
  - title: "Sesypat GameRecord/StoredGame union + AnyGameDto na PvP-only (atomicky)"
    status: done
  - title: "Ověřit: bez zbytků engine + PvP e2e"
    status: done
---

# Fáze 91 — report z auto session

## Co se udělalo

Interní refaktor serveru bez změny chování: záznam partie sesypán z unie
`EngineGameRecord | PvpGameRecord` na jediný PvP typ. Konkrétně:

- **store.ts** — pryč `EngineGameRecord`, `EngineStoredGame`, `EngineStatus`,
  `engineStatus` z báze, engine větev `toRecord` (overloady zrušeny), metody
  `create`/`resign`/`acceptDraw`/`setEngineStatus`, ballot los
  (`seedBallot`/`applyBallotByIndex`) a s ním celý `rng`/konstruktor. `GameRecord`
  je teď alias na `PvpGameRecord`. Guardy `mode !== 'pvp'` v PvP metodách (dřív
  hlasitý throw na engine partii) odstraněny — po smazání `create()` byly
  nedosažitelné. `markPvpLeft` guard `game?.mode !== 'pvp'` → `game === undefined`
  (množina vstupů na `false` je identická). `applyMove` ruší `drawOfferBy`
  bezpodmínečně.
- **dto.ts** — pryč `GameDto`, `gameToDto`, `AnyGameDto`. `GameStateMessage.game`
  je teď `PvpGameDto`.
- **app.ts** — `dtoFor` zjednodušen na jedinou PvP větev (pryč engine branch,
  `gameToDto`, slicing `ballotMoves`, čtení `engineStatus`/`level`/`humanColor`).
  Guardy `record.mode !== 'pvp'` v `handleMove` a `requirePvpGame` odstraněny.
  `new GameStore()` bez `rng`; `BuildAppOptions.rng` pryč.
- **index.ts** — vyčištěné re-exporty (pryč `EngineGameRecord`, `EngineStatus`,
  `GameDto`, `AnyGameDto`, `gameToDto`, `mulberry32`).
- **prng.ts** — smazán (jediný konzument byl smazaný `ballot.test.ts`).
- **testy** — `ballot.test.ts` smazán celý (engine ballot); z `dto.test.ts` pryč
  `gameToDto` describe; ze `store.test.ts` pryč engine describy (úroveň, resign,
  acceptDraw) a engine-throw testy, generické (moves/archived/effectiveResult)
  převedeny na `createPvp`; z ws testů smazáno 5 „ENGINE partii přes místnost →
  error" testů (testovaly nemožný stav), dva „jakákoli partie ve store" fixtures
  převedeny na `createPvp`.

## Vědomé rozhodnutí ke kontraktnímu testu (dto.test.ts)

Fáze zmiňovala „kontraktní test serverového `GameDto` proti webové kopii". Ve
skutečnosti `dto.test.ts` webovou kopii neimportuje — testoval serverový
`gameToDto` přímo. Server své `GameDto` už neprodukuje (AI je v prohlížeči), takže
**žádný sdílený kontrakt server↔web nezaniká**: web si svou vlastní kopii `GameDto`
(mode `'engine'`) drží dál výhradně pro lokální AI klienta (`LocalClient`), server
ji nikdy neposílá. Živý drátový kontrakt je `PvpGameDto` (mode `'pvp'`), který
server dál produkuje přes `pvpGameToDto` a web čte přes `isPvpGameDto` — ten je
nedotčený.

## Ověření

- `pnpm -r typecheck` zelené (všech 6 balíčků).
- `pnpm -r test` zelené: rules, cli, engine (250), ai (54, **nedotčeno** — kontrakt
  fáze 86 intaktní, `git status packages/ai` prázdný), server (150), web (563).
- `pnpm lint` (eslint .) exit 0.
- Grep `packages/server/src` na smazané symboly = žádný kód, jen slovo v jednom
  komentáři.
- PvP e2e: reálné WebSocket integrační testy (`pvp-move-ws`, `pvp-resign-draw-ws`)
  proti živé Fastify instanci — dva klienti se spárují, tah i konec partie
  (vzdání/remíza) se doručí OBĚMA přes game hub. Zelené.
- Nezávislý red-team sub-agent (čerstvý kontext) prošel diff + protistranu ve webu:
  žádný dosažitelný bug. Potvrdil, že `createPvp` je jediný konstruktor záznamu,
  takže odstranění `mode`-guardů není tichá regrese.

## Slabina / trade-off

`BuildAppOptions` drží už jen `pdnDir` — rezervovaný, nikdy nečtený hook pro budoucí
PvP PDN archiv (fáze 90), který `main.ts` dál předává kvůli stabilní signatuře. Po
odstranění `rng` z něj `buildApp` teď nečte NIC, takže je param `options` vědomě
nevyužitý (`// eslint-disable-next-line` s odůvodněním). Není to bug, ale pokud PDN
archiv nikdy nepřijde, je to trvalý mrtvý hook — rozhodnutí k pozdějšímu úklidu, ne
nález této fáze.
