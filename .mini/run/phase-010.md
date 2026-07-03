---
phase: 10
verdict: done
steps:
  - title: "Funkce perft(position, depth)"
    status: done
  - title: "Perft 1–6 proti nezávislému zdroji"
    status: done
  - title: "Formát a obsah fixtures/*.json"
    status: done
  - title: "Testy načítající fixtures z JSON"
    status: done
  - title: "Brána M1: export a zelený workspace"
    status: done
---

# Phase 10 — report ze session

## Klíčový výsledek: BRÁNA M1 PROŠLA
Perft 1–6 z výchozí pozice sedí NAPOPRVÉ na čísla nezávislého zdroje (Aart Bik): 7 / 49 / 302 / 1469 / 7361 / 36768. Generátor tahů z fází 3–6 je tím ověřený proti světu, ne jen proti vlastním testům. Milník M1 (knihovna pravidel) je uzavřený – 256 testů zelených, lint i typecheck čisté.

## Co vzniklo
- `packages/rules/src/perft.ts`: perft(position, depth), rekurzivní počet listů stromu legálních tahů; neplatná hloubka → RangeError. Exportováno z index.ts (přibije i budoucí Rust engine).
- `packages/rules/fixtures/` – 8 JSON fixtures (jazykově neutrální kontrakt): výchozí pozice s perft 1–6 + pasti z GDD 2.7 (povinné braní, větvení multi-skoku, zákaz zastavení uprostřed větve, muž nebere vzad, proměna ukončuje tah, kruhový skok dámy, zablokovaná pozice). Formát zdokumentovaný ve fixtures/README.md.
- `test/support/fixtures.ts` (loader s přísnou validací – poškozená fixture testy hlasitě shodí) + `test/fixtures.test.ts` (legalMoves přes formatMove vs. expectedMoves, perft hodnoty, konzistence kódování desky s positionKey) + `test/perft.test.ts`.
- Anti-cirkularita: expectedMoves jsou odvozené RUČNĚ z ručně psaných testů fází 3–6, perft čísla z nezávislého zdroje – nic není vygenerované vlastním generátorem a zapsané zpět.

## Infrastruktura (vynucená oprava)
Testový loader potřebuje node:fs → přidán @types/node do workspace katalogu a devDependencies rules + `types: ["node"]` do tsconfig rules (TypeScript 6 už @types balíčky automaticky nenačítá). Zásada „nulové I/O" platí dál pro src/ – loader žije v test/.

## Nad rámec plánu (z nezávislého self-review)
Sub-agent ručně přepočítal geometrii všech 8 fixtures proti pravidlům (všechny správně, včetně obou konvencí odstraňování braných kamenů u kruhového skoku) a potvrdil perft čísla vlastní znalostí (včetně hloubek 7–8). Tři neblokující nálezy, všechny opravené:
1. blocked-position kódovala v partii NEDOSAŽITELNOU pozici (muži na vlastních proměňovacích řadách) – nahrazena dosažitelnou se stejnou pointou (černý muž 21, bílí muži 25 a 30: jediný směr vpřed blokovaný, dopad skoku obsazený).
2. Loader tiše ignoroval neznámé klíče – překlep nepovinného pole („pertf") by vypnul kontrolu perft bez povšimnutí. Teď tvrdá chyba + test.
3. README doplněno o explicitní směr tahu mužů (černý k vyšším číslům) – Rust čtečka nemusí nic dovozovat.

## Ověření, že testy mají zuby (mutace)
Moje: perft bez rekurze (6 testů padlo), cizí tah přidaný do fixture (1 test padl). Sub-agentovy: oslabení povinnosti braní (8 testů padlo), prázdná fixture (pád při načtení). Vše vráceno, finální stav zelený.

## Unhappy path (projito)
- perft: záporná/neceločíselná/NaN hloubka → RangeError; pozice bez tahů → 0.
- Loader: prázdný soubor, nevalidní JSON (s cause), chybějící/vadná pole, neznámé klíče, vadný řetězec desky → hlasitá chyba; tiché přeskočení fixture nemožné (test vyžaduje přesnou množinu názvů).

## Poznámky
- Test kontraktu kódování: fixtures a positionKey sdílejí znaky `.mkMK` – přibito testem přes reálný kód obou stran (ne mock).
- Žádné rozhodnutí typu „zvážená a zamítnutá alternativa" nevzniklo – ADR není potřeba.
