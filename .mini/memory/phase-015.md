# Phase 15 — Časová kontrola a quiescence (M3)

**Goal:** Engine hledá iterativním prohlubováním 1..N s měkkým časovým limitem (vrací výsledek poslední kompletní iterace) a quiescence prodloužením při povinných skocích - brána M3: porazí random hráče >=95 % ze 100 partií a nikdy nepřekročí tvrdý timeout.

## Steps
- [done] Quiescence: prodloužení při povinných skocích
- [done] Přerušitelný search s deadline
- [done] Iterativní prohlubování s měkkým limitem
- [done] Protokol v2: timeMs v bestmove
- [done] Brána M3: série proti random + tvrdý timeout

## Auto-commit
- Phase 15: Časová kontrola a quiescence (M3)

## Run report
---
phase: 15
verdict: done
steps:
  - title: "Quiescence: prodloužení při povinných skocích"
    status: done
  - title: "Přerušitelný search s deadline"
    status: done
  - title: "Iterativní prohlubování s měkkým limitem"
    status: done
  - title: "Protokol v2: timeMs v bestmove"
    status: done
  - title: "Brána M3: série proti random + tvrdý timeout"
    status: done
---

# Phase 15 — report from the auto session

## Co se udělalo

- **Quiescence** (search.ts): negamax v hloubce 0 nekončí statickou evaluací, dokud je strana na tahu v povinném skoku – vynucená výměna se dohraje do klidné pozice. Stand-pat neexistuje (braní je povinné), terminaci zaručuje úbytek materiálu. Fixture test horizont efektu: dáma, jejíž tahy vypadají staticky nejlépe, ale visí do povinného skoku – search s quiescence je nevybere ani v hloubce 1; předpoklad „statická evaluace tah přeceňuje" je v testu přibitý explicitním assertem. Orákulum vlastnostních testů (čistý negamax bez ořezu) dostalo stejnou specifikaci quiescence.
- **Přerušitelný search**: injektovatelné hodiny, kontrola deadline jednou za 64 uzlů (čítač, ne systémové hodiny v každém uzlu), překročení vyhodí interní `SearchAborted`.
- **searchTimed**: iterativní prohlubování 1..25 (`MAX_SEARCH_DEPTH`); hloubka 1 doběhne vždy bez hodin (výsledek existuje i pro timeMs=1); heuristika „uplynulo + 2× poslední iterace > timeMs" další iteraci nezačne; iterace přerušená uvnitř se celá zahodí – vrací se poslední KOMPLETNÍ iterace + dosažená hloubka.
- **Protokol v2**: `bestmove` má povinné `timeMs` (kladné celé číslo, jinak `invalid_message`; kontrola obálky před parsováním pozice), `PROTOCOL_VERSION = 2` (přibitá literálem v testu, ne tautologií). `SEARCH_DEPTH` zmizel, handler volá `searchTimed`. `handleLine` má injektovatelné hodiny pro deterministické testy.
- **Brána M3**: 100 partií vs random, střídání barev, timeMs=25: **100 výher, 0 remíz, 0 proher; nejpomalejší tah 27,2 ms** (tvrdý strop 525 ms nikdy ani zdaleka neatakován). Rozložení hloubek: 3–11 podle fáze partie (těžiště 4–6), 140 tahů v koncovkách dosáhlo stropu 25. Legalita každého tahu enginu ověřena nezávislým voláním legalMoves.

Ověřeno mechanicky: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` (rules 259, cli 24, engine 108 testů) – vše zelené. Nic pro lidské oko (UI žádné), pole `verify` vynechávám.

## Nezávislý self-review (sub-agent, dle pravidel projektu)

Korektnostní chybu v produkčním kódu nenašel (kořenové okno `best − 1`, znaménka, terminace quiescence i validace protokolu prošly). Našel ale reálnou testovací díru: můj test „přerušení uprostřed iterace" ve skutečnosti končil heuristikou PŘED iterací (hloubka 2 má kvůli quiescence 85 uzlů, ne <64, jak jsem předpokládal) – větev `SearchAborted` neměla žádné deterministické pokrytí. Opraveno **samokalibračním testem**: dvěma běhy se stojícími hodinami se změří počet odečtů hodin, pak se hodiny přetečou přesně na první kontrole uvnitř cílové iterace. Mutační kontrola: po rozbití `catch SearchAborted` test spadne (ověřeno, pak vráceno).

Dokumentační nálezy (opraveny v komentářích, ne v kódu): záruka odezvy je přesně `max(timeMs, čas hloubky 1) + okno kontroly` – hloubka 1 s quiescence běží bez hodin; `timeMs` nemá horní mez (vědomé – volající je důvěryhodný server, strop případně přidá M4).

## Na co si dát pozor dál

- **Brána už NENÍ deterministická**: searchTimed měří skutečný čas, dosažená hloubka závisí na zátěži stroje. Prahy (95/100) mají velkou rezervu (reálně 100/100 i pod zátěží), ale spadlá brána = signál chyby, ne důvod prahy povolit.
- **timeMs bez horní meze**: zpráva s absurdním limitem zabaví jednovláknový engine na dlouho; fronta požadavků stojí. M4 orchestrace (tvrdý kill timeMs+500) s tím musí počítat – kill škáluje se stejnou hodnotou, překlep v serveru se propaguje do obou.
- **Engine remízy pořád nevidí** (čítač půltahů, opakování) – ve vyhrané koncovce se umí točit; hloubkový strop 25 je v koncovkách běžně dosahovaná větev. Řeší až protokolové rozšíření / server.
- **Heuristika faktoru 2** je záměrně optimistická: hraniční iteraci raději začne a nechá utnout (propadne trocha času), než aby nechávala budget ležet. Kdo ji bude ladit, ať hne faktorem, ne mechanismem přerušení.
- Trik s oknem `best − 1` dál stojí na celočíselném skóre – platí i pro quiescence.
