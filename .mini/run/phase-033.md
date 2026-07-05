---
phase: 33
verdict: done
steps:
  - title: "Modul analytics.ts s Plausible init"
    status: done
  - title: "Typy pro window.plausible"
    status: done
  - title: "Externí async skript v index.html"
    status: done
  - title: "Import analytics v main.ts"
    status: done
  - title: "Ověření buildu + CHANGELOG"
    status: done
verify:
  - title: "Živý pageview na produkci"
    detail: "Kódem ověřit nejde. Po deployi na dama.softcode.cz otevři pár stránek a zkontroluj v Plausible dashboardu (plausible.softcode.cz), že návštěvy naskakují. Na localhostu Plausible ve výchozím stavu neměří, takže to nejde otestovat lokálně."
---

# Phase 33 — report z auto session

## Co se udělalo

Přidal jsem Plausible analytiku do web klienta bez jediného inline skriptu:

- **`packages/web/index.html`** — do `<head>` přibyl jen externí
  `<script async src="…plausible.softcode.cz/js/pa-pJc3_LNyudf00LwoMIRnP.js">`.
  Inline blok z oficiálního snippetu se sem NEDAL.
- **`packages/web/src/analytics.ts`** (nový) — inicializace `window.plausible`
  (frontovací stub + `plausible.init()`), typovaná přes `declare global`
  (soubor je modul díky `export {}`). Import z `main.ts`, takže init skončí
  v hashovaném JS bundlu, ne v HTML.
- **`packages/web/src/main.ts`** — přidán `import './analytics.js'`.
- **CHANGELOG** — sekce Added v `[Unreleased]`.

## Ověření (mechanicky, sám)

- `pnpm build` projde; `dist/index.html` obsahuje jen externí skript,
  `grep "plausible.init" dist/index.html` = 0 (žádný inline init), init je
  v `dist/assets/index-*.js`.
- `tsc --noEmit` projde (typy sedí).
- `pnpm test` — 125 testů zelených, nic se nerozbilo.

## Adversarial / unhappy path — závod v pořadí načtení

Tohle je jádro rizika u téhle změny, tak jsem ho prohnal nezávislým
sub-agentem v čerstvém kontextu. Sub-agent nahlásil KRITICKÝ nález: prý když
se externí `async` skript dotáhne dřív než deferovaný modul, analytika tiše
nic neměří.

**Ověřil jsem to sám proti reálnému staženému skriptu a nález je FALEŠNÝ.**
Bootstrap externího skriptu končí:

```js
window.plausible=window.plausible||{}, plausible.o&&S(plausible.o), plausible.init=S
```

Sub-agent přehlédl poslední příkaz `plausible.init=S`: externí skript VŽDY
přepíše `plausible.init` na reálný init `S` (idempotentní, hlídaný flagem
`.l`). JS je jednovláknový, modul běží synchronně do konce, takže reálná jsou
jen dvě pořadí — obě měří:

- **modul → skript:** stub `init()` nastaví `.o={}`; skript pak `.o` truthy →
  `S({})` → nainstaluje měření, pageview odejde.
- **skript → modul:** skript nastaví `.init=S`; `{}` není nullish, takže
  `plausible.init` už je `S`, `??` ho nechá; modul zavolá `plausible.init()`
  = `S()` → nainstaluje měření, pageview odejde.

Poučení: hodilo se, že jsem sub-agentovo tvrzení o obsahu externího skriptu
nepřevzal naslepo, ale stáhl skript a přečetl bajty.

## Vědomé kompromisy / co zůstává otevřené

- **Fronta `.q` je fakticky nevyužitá** — nikde v appce nevoláme
  `plausible('event')`, měří se jen automatické pageviews. Nechal jsem ji,
  protože je součástí oficiálního snippetu (bezpečnější držet přesný tvar) a
  otevírá pozdější custom eventy. Není to chyba, jen zatím mrtvá pojistka.
- **Žádná CSP se v repu reálně nevynucuje** (nginx ani server neposílá
  `Content-Security-Policy`). „CSP-čisté" je tu tedy sebekázeň, ne vynucené
  pravidlo — ale díky ní jsme připraveni CSP kdykoli zapnout bez rozbití.
- **Živý pageview** jde potvrdit až po deployi na produkci (viz `verify`).
