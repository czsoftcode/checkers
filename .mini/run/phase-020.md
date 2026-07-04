---
phase: 20
verdict: done
steps:
  - title: "Vite scaffolding balíčku web"
    status: done
  - title: "Mapovací vrstva pole↔mřížka + render pozice"
    status: done
  - title: "Model výběru a zvýraznění (čistá logika)"
    status: done
  - title: "Interakce: klik vybírá a zvýrazňuje"
    status: done
  - title: "Sebekontrola unhappy path + smoke test DOM"
    status: done
verify:
  - title: "Vizuální podoba desky v prohlížeči (pnpm --filter @checkers/web dev)"
    detail: "Ověřeno jen mechanicky (HTTP 200, DOM struktura, počty polí/kamenů, orientace přes data-square). Skutečný vzhled – barvy polí, kulaté kameny, korunka dámy (♛), responzivita přes vmin – jsem n/mohl posoudit očima. Otevři http://localhost:5173 a zkontroluj, že deska vypadá jako dáma a je čitelná."
  - title: "Zvýraznění při kliknutí pohledem"
    detail: "Testy ověřují CSS třídy 'selected'/'target', ne jejich vizuální projev. Klikni na černý kámen na spodní hraně černé skupiny (pole 9–12) a zkontroluj, že žlutý rámeček výběru a zelené terčíky cílů jsou dobře vidět a na správných polích."
---

# Fáze 20 — report z auto session

## Co je hotové
Postaven webový klient (`packages/web`): Vite scaffolding, CSS grid deska 8×8, render výchozí pozice, výběr kamene kliknutím a zvýraznění legálních tahů. Veškerá legalita jde přes sdílenou `@checkers/rules` – klient sám nerozhoduje, co je tah.

- **Scaffolding:** `vite.config.ts`, `index.html` (externí modul-script, žádný inline), skripty `dev`/`build`/`preview`/`typecheck`/`test`. Do katalogu přidány `vite ^8.1.3` a `jsdom ^29.1.1`.
- **Mapování + render** (`board-view.ts`): mřížku staví přímo přes `isDarkSquare`/`coordsToSquare` z rules (jediný zdroj pravdy, žádná duplicitní geometrie). 32 tmavých polí nese `data-square` 1–32.
- **Model** (`selection.ts`, čistý, bez DOM): `selectableAt` (jen kámen strany na tahu) a `targetsFor` (`path[0]` každého legálního tahu přes `legalMoves`). Povinné braní se respektuje automaticky – když je skok, `legalMoves` prosté tahy nevrátí.
- **Interakce** (`controller.ts`): klik na vlastní kámen vybere + zvýrazní; opětovný klik / prázdné / cizí pole / mimo desku výběr zruší. Žádný server, tah se neprovádí (todo 20).

## Ověření (mechanicky, sám)
- `pnpm --filter @checkers/web typecheck` ✓, `test` ✓ (15 testů), `build` ✓ (Vite 8, CSS i JS extrahované do externích souborů).
- `pnpm dev` reálně servíruje: `GET /` → 200, `/src/main.ts` → 200, import `@checkers/rules` se v dev resolvuje přes `/@fs/.../packages/rules/src/index.ts`.
- Celý monorepo `pnpm typecheck` + `pnpm test` zelené (nic jsem nerozbil), `pnpm lint` čistý.
- Build `dist/index.html` bez inline scriptů/stylů (grep = 0), skript i CSS jsou linkované externí soubory → CSP-friendly. `dist/` je gitignorovaný.

## Testy mají zuby
- Mandatory-capture test (`selection.test.ts`): kámen 11 má volné prosté tahy (15, 16), ale při dostupném skoku kamene 5 vrací `targetsFor(11) === []`. Kdyby rules přestala vynucovat braní, vrátí `[15,16]` a test padne.
- Orientace desky (`board-view.test.ts`): horní řada nese pole 1–4, dolní 29–32. Zrcadlení/otočení/posun mapování test shodí (doplněno po self-review).

## Nezávislý self-review (sub-agent, čerstvý kontext)
Kritický defekt nenašel. Nálezy a jak jsem s nimi naložil:
1. **CSP je jen deklarovaná, ne vynucená; dev režim inline styly používá (Vite HMR).** Vynucení CSP hlavičkou je serverová věc (todo 20 napojuje server) a striktní `<meta>` CSP by rozbila Vite dev HMR. Produkční build je čistý. **Necháno jako známé omezení** – reálná CSP hlavička patří k serverovému napojení.
2. **Testy bez zubů na orientaci desky.** → **Opraveno**, přidán orientační test (viz výše).
3. **Nekonzistence mimo rozsah:** `selectableAt` u poškozené desky mlčí, `targetsFor`→`legalMoves` by házelo `RangeError`. **Aktuálně nedosažitelné** – pozice je konstantní (`initialPosition()`, délka 32, validní `turn`). Relevantní až v todo 20, kdy pozice přijde ze serveru; tam sjednotit ošetření.
4. **`path[0]` u vícenásobného skoku zvýrazní mezidopad stejně jako finální cíl.** Dle scope OK (bez provádění tahu), rozliší se v todo 19.

## Na co navázat (todo 20)
- Až pozice přestane být konstantní (přijde ze serveru), ošetřit poškozený vstup jednotně – dnes je `render()` bez try/catch, protože cesta k výjimce je nedosažitelná.
- CSP zavést jako serverovou hlavičku při napojení serveru.
