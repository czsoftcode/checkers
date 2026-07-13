---
phase: 114
verdict: done
steps:
  - title: "italianQualityFilter: 3-stupňová kaskáda"
    status: done
  - title: "Fixtury: čtyři zuby kaskády"
    status: done
  - title: "Brána: perft + suita + tsc"
    status: done
---

# Phase 114 — report z auto session

## Co je hotové
- **`italianQualityFilter(maxSet, position)`** v `packages/rules/src/moves.ts` — uspořádaná FID kaskáda nad max-množinou: stupeň 2 (dáma > muž), stupeň 3 (nejvíc braných dam), stupeň 4 (nejmenší index první brané dámy v `move.captures`). Vrací MNOŽINU plně shodných přeživších, ne jeden tah. Metriky čtené z `position` (stav před tahem); druh táhnoucí figury z `move.from` (italská nemá proměnu uprostřed braní).
- **Zadrátování do `legalMoves`** uvnitř bloku `if (ruleset.mustCaptureMaximum)`: spočítá se `maxSet`, a `if (capturePriority === 'italianFull') return italianQualityFilter(maxSet, position)`, jinak `return maxSet`. Kvalita běží AŽ ZA maximem. Coupling (italianFull předpokládá běh max-bloku) je okomentovaný; guard na nesmyslnou kombinaci se nezavádí (YAGNI, dle rozhodnutí fáze).
- **Nový test** `packages/rules/test/italian-quality-priority.test.ts` — samostatná fixture na každý stupeň + plná shoda + flag-vázanost (AMERICAN). Každý stupeň má zub přes `ITALIAN_NO_QUALITY` (= italská s `capturePriority: 'none'`, max zůstává zapnutý). 8 testů zelených.

## Nálezy self-review a co se s nimi stalo
Nezávislý sub-agent (čerstvý kontext) našel **reálnou vadu ve fixture stupně 3**: původní M2 nebrala žádnou dámu, takže ji vyřadil už stupeň 4 (`firstKingIndex = Infinity`) — zub byl falešný, test by prošel i s rozbitým stupněm 3. Opraveno: M2 teď bere dámu už na indexu 0 (27 změněn z muže na dámu), takže stupeň 4 remizuje a rozhoduje čistě stupeň 3.

Ověřeno mutací: po dočasném vypnutí filtru stupně 3 test stupně 3 **padne** (zub je reálný); src pak obnoven byte-identicky.

Druhý nález sub-agenta (footgun `italianFull` bez `mustCaptureMaximum` tiše nic neudělá) je záměrné YAGNI rozhodnutí této fáze — ponecháno jen okomentované, guard se nepřidává.

## Brána
- `pnpm -r typecheck` čistý (6 balíčků).
- Celá suita zelená: rules 401 (vč. perft american 7/49/302/1469/7361/36768, pool/russian/czech beze změny čísel + czech-king-priority), web 629, server 199, engine 268, ai 57, cli 24.
- Neitalské varianty netknuté — filtr je vázaný na `capturePriority === 'italianFull'` (jen ITALIAN_RULESET) a navíc uvnitř `mustCaptureMaximum`.

## Poznámka
IT-5 (nezávislý FID perft) je definitivní razítko na subtilní chyby ve stupni 4 — tato fáze je „správně podle fixture". Žádné rozhodnutí k zápisu přes `/mini:decision` (coupling a YAGNI jsou už zachycené v diskuzi fáze).
