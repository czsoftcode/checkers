# Fixtures – jazykově neutrální kontrakt pravidel

Sdílené testovací pozice americké dámy (English draughts). Přibíjejí
generátor tahů knihovny `@checkers/rules` a stejnými čísly se přibije
i případný budoucí Rust engine (řízená duplicita generátoru). Implementuj
formát z tohoto popisu, ne z TS kódu.

## Formát souboru

Každý `*.json` v tomto adresáři je jeden objekt:

| Pole            | Typ        | Význam |
|-----------------|------------|--------|
| `name`          | string     | Identifikátor fixture (kebab-case, shodný s názvem souboru). |
| `description`   | string     | Lidský popis pozice a pointy testu. |
| `board`         | string     | Přesně 32 znaků, viz kódování níže. |
| `turn`          | string     | `"black"` nebo `"white"` – strana na tahu. |
| `expectedMoves` | string[]   | VŠECHNY legální tahy pozice v PDN, setříděné lexikograficky (prosté řazení řetězců). Prázdné pole = žádný legální tah. |
| `perft`         | number[]?  | Volitelné: `perft[i]` = počet listů stromu legálních tahů v hloubce `i + 1`. |

## Kódování desky (`board`)

Hraje se na 32 tmavých polích číslovaných 1–32 (standardní PDN číslování):
pole 1–4 jsou horní řada (strana černého), pole 29–32 dolní řada (strana
bílého). Černý táhne v partii první. Černý muž táhne k vyšším číslům
(vpřed = k řadě 29–32, kde se proměňuje), bílý muž k nižším (k řadě 1–4);
dáma táhne všemi čtyřmi diagonálními směry.

Znak na indexu `i` řetězce popisuje pole číslo `i + 1`:

| Znak | Význam      |
|------|-------------|
| `.`  | prázdné pole |
| `m`  | černý muž   |
| `k`  | černá dáma  |
| `M`  | bílý muž    |
| `K`  | bílá dáma   |

## Notace tahů (`expectedMoves`)

PDN notace jednoho tahu s plnou sekvencí dopadů:

- prostý tah: `22-18` (z pole 22 na sousední pole 18),
- skok: `26x17x10` (výchozí pole + KAŽDÉ pole dopadu; brané kameny se
  nezapisují – plynou z geometrie: mezi dvěma po sobě jdoucími poli
  sekvence leží přeskočené pole).

Zkrácený zápis skoku bez mezidopadů (`26x10`) se nepoužívá.

## Pravidla hry pokrytá fixtures

Braní je povinné; vícenásobný skok je jeden tah a nesmí skončit uprostřed
větve; maximum braní se nevyžaduje (kratší větev z rozcestí je legální);
muž nebere vzad ani v pokračování sekvence; proměna ukončuje tah; stejný
kámen nelze v sekvenci přeskočit dvakrát; dáma se smí kruhem vrátit na
výchozí pole; hráč bez tahu prohrává (pat neexistuje).

Očekávané tahy jsou odvozené RUČNĚ (z ručně psaných testů fází 3–6),
perft hodnoty pocházejí z nezávislého zdroje (Aart Bik). Nesedí-li
implementace, je chyba v implementaci – hodnoty ve fixtures se neupravují.
