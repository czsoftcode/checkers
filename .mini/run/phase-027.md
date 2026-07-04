---
phase: 27
verdict: done
steps:
  - title: "Čistý modul rekonstrukce tahu z diffu + testy"
    status: done
  - title: "CSS: vyzdvižený kámen během animace + mizení sebraných"
    status: done
  - title: "Animační přehrávač v board-view (WAAPI, řetěz skoků)"
    status: done
  - title: "Napojení do update(): předchozí pozice, přerušitelnost, fallback"
    status: done
  - title: "Ověření + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální dojem animace v reálném prohlížeči proti enginu"
    detail: "Logiku jsem ověřil testy s mockovaným WAAPI (jsdom WAAPI nemá), ale skutečnou plynulost, rychlost (~180 ms/skok) a čitelnost jsem v reálném prohlížeči NESPUSTIL (chtělo by běžící server+engine+partii). Zahraj partii proti AI a zkontroluj: (a) tah AI i vlastní tah jede plynule po diagonále; (b) vícenásobný skok je vidět přes mezidopady, ne skokem start→cíl; (c) sebrané kameny mizí postupně, jak je kámen míjí; (d) proměna na dámu (koruna) naskočí až na konci pohybu; (e) rychlost je příjemná (ladí konstanta HOP_MS v board-view.ts)."
  - title: "„Nová hra“ a přerušení uprostřed běžící animace"
    detail: "Otestováno logicky (dispose + snap), ale ne okem. Klikni „Nová hra“ nebo zahraj další tah, když ještě letí animace předchozího – nesmí zůstat viset „duch“ kamene ani se rozbít deska."
  - title: "Kruhový skok dámy po směru hodinových ručiček"
    detail: "Ověřeno jednotkovým testem (fixní pozice → hops [19,26,17,10]). V reálné hře je vzácný; pokud na něj narazíš, zkontroluj, že obíhá po směru hodinových ručiček a ne opačně / neskočí rovně."
---

# Fáze 27 — report z auto session

## Co je hotové
Animace tahu kamene po desce (tah AI i vlastní tah člověka). Klient tah odvodí
z porovnání předchozí a nové pozice ze serveru – **server se neměnil**.

- `packages/web/src/move-diff.ts` – čistá funkce `diffMove(prev,next)`: najde
  from/to/captured, přes **backtracking (DFS)** složí pořadí mezidopadů skoku, u
  víc platných cest (kruhový skok dámy) vybere variantu **po směru hodinových
  ručiček** (shoelace, Y na obrazovce dolů). Pojistka „jeden diff = jeden tah“ →
  jinak `null` a deska se jen tiše překreslí. 8 jednotkových testů.
- `packages/web/src/board-view.ts` – animační přehrávač přes Web Animations API:
  posun kamene skok po skoku, sebrané kameny mizí postupně, kámen je během pohybu
  vyzdvižený (`.piece.moving`). Přerušitelnost: jiná pozice během animace → snap
  na cíl a nová; stejná pozice (opakovaný poll à 250 ms) animaci nepřeruší. Bez
  WAAPI (jsdom, starý prohlížeč) i při redukovaném pohybu → okamžité překreslení
  (dnešní chování). Nově `dispose()` (ukončí běžící animaci).
- `packages/web/src/styles.css` – třída `.piece.moving` (z-index nad ostatními).
- `packages/web/src/controller.ts` – `dispose()` volá `view.dispose()`.

## Ověření (mechanické, vše zelené)
- `pnpm lint`, `pnpm typecheck` – čisté.
- Testy: web **92** (z toho 8 nových pro `diffMove` + 5 pro animační vrstvu),
  cli 24, engine 222, server 90.
- `vite build` webu prošel (produkční režim).

## Nezávislý self-review (čerstvý kontext) – co našel a jak je vyřešeno
Sub-agent potvrdil, že jádro (rekonstrukce, clockwise, kontrakt captured↔hops,
přerušitelnost, `positionsEqual`) je v pořádku. Dva reálné nálezy jsem **opravil**:
1. **`BoardView` neměl `dispose`** – úklid animace stál jen na tom, že app-shell
   starou desku odpojí (`replaceChildren`). Křehký kontrakt → přidán explicitní
   `dispose()` (ruší WAAPI i časovače), controller ho volá.
2. **Animační vrstva neměla testy** (jsdom WAAPI nemá → celá větev byla v testech
   mrtvá, porušení „testy mají zuby“) → přidán `board-view-animation.test.ts`
   s mockovaným WAAPI: rozjezd skoku, doběhnutí + mizení sebraných, přerušení
   jinou pozicí, ignorování stejné pozice, `dispose` uprostřed.

Zbytek nálezů byl kosmetický bez následku na stav (dvojitý fade posledního
sebraného kamene = dvě překrývající se opacity animace na elementu, který se hned
odebírá; `.remove()` na odebraném uzlu je no-op).

## Odchylky od plánu (vědomé)
- **Mizení sebraných kamenů řeším přes WAAPI (opacity), ne přes CSS třídu** jak
  navrhoval krok 2. Důvod: WAAPI je CSP-safe a má deterministický úklid
  (`.finished.then(remove)`), zatímco CSS třída + `transitionend` je křehčí. CSS
  třída `.piece.moving` (vyzdvižení) zůstala dle plánu.
- **Drive-by fix v `packages/web/src/backgrounds.ts`** (fáze 26, nesahal jsem na
  jeho chování): `import.meta.glob(...) as Record<string,string>` → `glob<string>(...)`.
  Bez toho `pnpm lint` celého repa padal na předchozí (ne mnou způsobené)
  `no-unnecessary-type-assertion`. Type-safe, ověřeno typecheckem. Zmiňuji, ať to
  není skryté.

## Známá omezení
- **Vícenásobný skok se rekonstruuje z diffu**, ne z tahu ze serveru. U kruhového
  skoku dámy, který končí přesně na výchozím poli, není z desky vidět „který“
  kámen táhl – hledá se přes DFS smyčku; když ji jde složit z víc než jednoho
  kamene, je to nejednoznačné → `null` → bez animace (jen překreslení). V reálné
  hře prakticky nedosažitelné, ale je to vědomá mez.
- **Reálný vizuální dojem není strojově ověřený** – viz `verify` výše.

## Poznámka k rozhodnutí
Volba „animovat i vlastní tah a rekonstruovat ho z diffu (ne z už známé
`selection.path`)“ je vědomé rozhodnutí (jedna logika, jeden testovaný modul).
Je zaznamenané v `.mini/discuss/phase-027.md`; ADR přes `/mini:decision` jen pokud
to chceš mít formálně.
