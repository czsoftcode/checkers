---
phase: 2
verdict: done
steps:
  - title: "Základní typy knihovny rules"
    status: done
  - title: "Převod pole 1-32 na souřadnice a zpět"
    status: done
  - title: "Tabulka NEIGHBORS[32][4] se směrovou konvencí"
    status: done
  - title: "Tabulka JUMPS[32][4] na stejných směrech"
    status: done
  - title: "Invariantní testy tabulek a zelené CI"
    status: done
---

# Phase 2 — report from the auto session

## Co vzniklo
- `packages/rules/src/types.ts` – Color, PieceKind, Piece, Cell (= Piece | null), Square (dokumentační alias number), Position (board[32] + strana na tahu), Move (from + path + captures, navrženo pro vícenásobné skoky).
- `packages/rules/src/board.ts` – squareToCoords/coordsToSquare (standardní PDN číslování, neplatný vstup = RangeError, žádná tichá hodnota), směrová konvence DIR (NW=0, NE=1, SW=2, SE=3, sever = strana černého), tabulky NEIGHBORS[32][4] a JUMPS[32][4] generované při načtení modulu, přístupové funkce neighborOf/jumpOf validující pole i směr.
- 4 nové testovací soubory, celkem 92 testů v rules: ručně spočítané fixtures převodů, sousedů i skoků (včetně PDN příkladu 26x17x10), invarianty symetrie a rozložení počtu sousedů. Typecheck, testy i lint celého workspace zelené.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Recenzent nezávisle přepočítal geometrii a přes 15 fixture hodnot – vše sedí, žádná kritická chyba. Nálezy opravené ještě v této fázi:
- **Střední:** neighborOf/jumpOf nevalidovaly index směru – směr mimo 0-3 by vrátil undefined a tiše kaskádoval. Opraveno (RangeError) + testy.
- Vakuózní porovnání `!== null` v testu vazby JUMPS→NEIGHBORS propouštělo undefined. Opraveno na `!= null` + kontrola toBeDefined.
- isDarkSquare vracela pro záporné souřadnice špatný výsledek ((-1) % 2 === -1 v JS). Opraveno přes Math.abs + testy.
- Nedokumentované předpoklady typu Move (captures.length === path.length platí jen pro skoky; captures bez duplicit; path duplicity mít SMÍ – kruhový skok dámy se může vrátit i na from). Doplněno do doc-komentáře, aby je generátor a applyMove v dalších fázích mlčky neporušily.

Vědomě neopraveno (nechávám jako rozhodnutí návrhu):
- Přímý přístup do tabulek NEIGHBORS/JUMPS obchází validaci v neighborOf/jumpOf. Záměr: generátor tahů půjde kvůli výkonu přímo do tabulek (indexy si hlídá sám), accessory jsou pro okrajový/externí kód.
- Square je nebrandovaný alias number – kompilátor nechytí záměnu square vs. index do board[] (square − 1). Nejpravděpodobnější třída chyb v dalších fázích; hlídat v testech generátoru a perftu.

## Odchylka od plánu
Detail kroku 5 předpokládal počty sousedů „roh 2, kraj 2-3, střed 4" – skutečná deska je jiná: jednorohová pole 4 a 29 mají JEDINÉHO souseda, 12 krajních polí má 2, 18 vnitřních 4, pole se 3 sousedy neexistuje. Test používá skutečné, ručně odvozené rozložení.

## Unhappy path
NaN, ±Infinity, necelá čísla, 0, 33, záporná čísla, světlá pole, souřadnice mimo desku – všechno vyhazuje RangeError a je pokryto testy. Knihovna je čistá (žádné I/O, žádné vedlejší efekty při selhání).
