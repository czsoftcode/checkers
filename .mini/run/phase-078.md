---
phase: 78
verdict: done
steps:
  - title: "Store: zaznamenej důvod vynuceného konce"
    status: done
  - title: "DTO a drát: přenes důvod k PvP stavu"
    status: done
  - title: "Klient: parse reason a text výsledku"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Ruční průchod v prohlížeči: soupeř se vzdá → druhý vidí důvod"
    detail: "Mechanicky ověřeno testy (server 344, web 426, vše zelené) i typecheck/lint/build. Reálný běh dvou klientů v prohlížeči (vzdání jedním hráčem → druhý uvidí 'Soupeř se vzdal – vyhrál jsi!' v modalu i stavovém řádku) jsem NEspustil – to je na lidské oko."
  - title: "Ruční průchod: remíza dohodou vs. remíza podle pravidel se v UI liší"
    detail: "Text 'Remíza dohodou.' vs 'Remíza podle pravidel.' je ověřen jednotkově; vizuální kontrola v živé partii zbývá na člověka."
  - title: "Slyšitelný zvuk konce PvP partie: výhra / prohra / remíza"
    detail: "Přehrání win/loss/draw je ověřeno jednotkově (fake soundPlayer, časování prodlevy, mapování barvy, úklid při dispose, guard proti terminálnímu prvnímu stavu). Že to v prohlížeči SKUTEČNĚ zní (a autoplay policy nezablokuje) zbývá na lidské ucho."
---

# Phase 78 — report z auto session

## Co se udělalo
Přidán **důvod konce partie** na drát server→klient, aby výherce v PvP viděl PROČ hra skončila, ne jen holé „Vyhrál jsi!".

**Server:**
- `store.ts`: nové pole `forcedReason: ForcedReason | null` v záznamu partie (vedle `forcedResult`). Nastavuje se ve všech čtyřech vynucených cestách: `resign`/`acceptDraw` (engine) i `resignPvp`/`acceptDrawPvp` (PvP). Nový typ `ForcedReason = 'resign' | 'draw-agreement'` a drátový `EndReason = ForcedReason | 'rules'`. Helper `endReason(game)` vrací drátový důvod: **`null` právě když je partie `ongoing`** (tvrdá vazba na `effectiveResult`, aby klient během hry nikdy nedostal předčasný důvod), jinak `forcedReason ?? 'rules'`.
- `dto.ts`: `reason` je nové **povinné** pole `PvpGameDto`; `pvpGameToDto` ho bere zvenčí (identita, DTO nic neodvozuje). Opraven zastaralý komentář „forcedResult je zatím vždy null".
- `app.ts`: jediný trychtýř `dtoFor` počítá reason přes `endReason(record)` – platí pro REST i WS broadcast.

**Klient:**
- `server-client.ts`: klientská kopie `EndReason` + `isEndReason`. Pole `reason?` v `PvpGameDto` je **volitelné schválně** – kdyby dorazil starší/nekompletní stav bez reason, runtime guard `isPvpGameDto` ho nezahodí (deska nezamrzne) a text spadne na neutrální variantu.
- `pvp-controller.ts`: normalizace na hranici (`applyState`) – neznámá/chybějící hodnota → `null`. Přidáno do `PvpStatus`.
- `game-screen.ts`: `outcomeText(result, myColor, reason)` volí text: vzdání soupeře → „Soupeř se vzdal – vyhrál jsi!", vlastní vzdání → „Vzdal ses – prohrál jsi.", remíza dohodou vs. podle pravidel; bez důvodu = dosavadní text. Důvod se drží v closure, takže přežije i znovuotevření výsledku (Odveta odmítnuta).

## Ověření
- **build** (všech 5 balíčků) OK, **typecheck** OK, **lint** (`eslint .`) OK.
- **Testy zelené:** server 344, web 420, engine 250, plus rules/cli. Testy mají zuby: `endReason` na reálné funkci (i konec z pozice → `'rules'`), `pvpGameToDto` identita reason pro všechny 3 důvody, endpoint test na reálný tvar DTO, klient na normalizaci cizí hodnoty (`'nonsense' → null`) i na úplně chybějící klíč reason (starší server).

## Nezávislý adversarial review (čerstvý kontext, dle projektových instrukcí)
Fáze sahá na kontrakt mezi moduly (drát) a fallback cestu → pustil jsem nezávislého sub-agenta. **Nenašel žádný kritický ani střední reálný nález.** Ověřil oběma směry: guard je jediný choke-point, vazba result↔reason je tvrdá, normalizace na správném místě, fallback bez reason nezamrzne desku, pomlčky jsou en (U+2013), ne em.

Dvě drobnosti z review:
1. **Engine cesta ukládá `forcedReason`, ale engine DTO ho na drát neposílá** (nikdo ho v engine režimu nezobrazí). Ponecháno **vědomě**: kdybych ho v engine `resign` NEnastavil, `endReason(engineRecord)` by u vzdané engine partie vrátil chybně `'rules'`. Nastavení tedy drží data poctivá a symetrická napříč režimy, není to „vrstva pro budoucnost".
2. **Chybějící test na úplně nepřítomný klíč reason** (undefined ≠ null) – **doplněno** po review (`starší server: klíč reason ve stavu úplně CHYBÍ → fallback`), web testů je teď 420.

## Dodatek: zvuk konce partie v PvP (na žádost uživatele během `done`)
Uživatel si před uzavřením vyžádal doplnit zvuky výhry/prohry/remízy i do PvP (mp3 už byly v assets a `SoundPlayer` je uměl – ve hře proti počítači se hrály od fáze 28/29, v PvP chyběly).

- `pvp-controller.ts`: při přechodu běžící→terminální stav se z pohledu MÉ barvy naplánuje `win`/`loss`/`draw` zvuk, až PO dokončení animace posledního tahu + prodleva `END_SOUND_DELAY_MS` (500 ms) – **zrcadlí enginový `scheduleEndSound` z `controller.ts`**, ať konec zní v obou režimech stejně. Timer se ruší v `dispose` (žádná fanfára po odchodu z obrazovky). Konec může přijít i soupeřovým tahem.
- Exhaustivní mapa `soundForResult(result, myColor)` (`Record<Exclude<…>>` → přidání výsledku shodí kompilaci, ne tichý špatný zvuk).
- **Nezávislý review (druhé kolo, čerstvý kontext)** našel 1 středně závažný nález: kdyby byl úplně PRVNÍ přijatý stav rovnou terminální (vstup/reconnect do dohrané partie – todo 42), zvuk by zazněl hned při vstupu (divergence od enginu, který inicializuje z prvního stavu). **Opraveno** guardem `sawOngoing` (zvuk jen po reálně viděné běžící partii) + test se zuby. Zbylé drobnosti (unlock asymetrie – prakticky nedosažitelné; reálné časovače v testech à la enginové testy) ponechány vědomě.
- Web testů teď 426 (5 zvukových + 1 na guard prvního terminálního stavu).

## Na co dát pozor / co zbývá lidské oko
Vše ověřitelné mechanicky je ověřené. Zbývá reálný průchod ve dvou prohlížečích (viz `verify` výše) – to je vizuální/UX kontrola, kterou automat nezastoupí, a poslech, že zvuky konce v prohlížeči skutečně zazní.
