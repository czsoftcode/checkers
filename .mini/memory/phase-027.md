# Phase 27 — Animace tahu včetně meziskoků

**Goal:** Klient z porovnání staré a nové pozice odvodí přesunutý kámen a sebrané soupeřovy kameny, geometricky zrekonstruuje cestu (mezidopady) vícenásobného skoku a animuje kámen plynule diagonálně po jednotlivých skocích přes Web Animations API (CSP-safe, bez inline stylů), přičemž sebrané kameny mizí postupně, jak jsou přeskakovány; při nejednoznačné rekonstrukci se použije fallback rovný posun start→cíl.

## Steps
- [done] Čistý modul rekonstrukce tahu z diffu + testy
- [done] CSS: vyzdvižený kámen během animace + mizení sebraných
- [done] Animační přehrávač v board-view (WAAPI, řetěz skoků)
- [done] Napojení do update(): předchozí pozice, přerušitelnost, fallback
- [done] Ověření + nezávislý self-review

## Auto-commit
- Phase 27: Animace tahu včetně meziskoků

## Discussion
# Phase 27 — Animace tahu včetně meziskoků

## Intent
Dnes klient stáhne ze serveru celou pozici (`GameDto.position`) a `board-view.update`
ji jen idempotentně „přepíše" do DOMu → kámen se teleportuje, tah (hlavně AI) je špatně
vidět. Cíl: kámen se má po desce plynule přesunout a u vícenásobného skoku projít
**jednotlivými mezidopady** po diagonále (ne rovnou start→cíl), sebrané soupeřovy kameny
mizí postupně, jak jsou přeskakovány.

Server se NEMĚNÍ. Klient dostává jen výslednou pozici, takže tah i cestu skoku musí
**odvodit z porovnání předchozí a nové pozice**.

## Key decisions
- **Rozsah (volba 1B):** animují se OBA tahy — tah AI (bílý) i vlastní tah člověka po
  potvrzení serverem.
- **Jednotná cesta přes diff:** i vlastní tah člověka (byť klient zná `selection.path`)
  se rekonstruuje z diffu stejně jako tah AI — jedna logika, jeden testovaný modul, bez
  dvou větví.
- **Rychlost (volba 2B):** ~180 ms na jeden skok, jako pojmenovaná konstanta; počítá se
  s doladěním při ověřování. Trojskok ≈ 540 ms.
- **Rekonstrukce = čistá funkce ve vlastním modulu s unit testy.** Vstup: předchozí a nová
  pozice. Výstup: `{ from, to, hops: Square[], captured: Square[] }` seřazené v pořadí
  skoků (mezidopad leží vždy 2 pole za přeskočeným kamenem po diagonále), nebo `null`.
  Pixelové přehrání (Web Animations API) žije v `board-view`, ověří se okem.
- **Rekonstrukce jako backtracking (DFS), NE heuristika + řazení podle úhlu.** Z `from`
  vždy skoč přes diagonálně sousední sebraný kámen o 2 pole dál, dokud nespotřebuješ
  všechny sebrané a nedojdeš na `to`. Pořadí mezidopadů je platné jen tehdy, když každý
  krok je reálný skok přes sebraný kámen — proto DFS, ne „seřaď body dokola podle úhlu"
  (to by mohlo složit cestu, co neodpovídá skokům).
  - právě jedna cesta → použij ji (naprostá většina tahů, i běžné vícenásobné skoky),
  - víc cest (typicky kruhový skok dámy: po směru vs. proti směru hodinových ručiček) →
    vyber **variantu po směru hodinových ručiček** — orientaci urči přes znaménko plochy
    mnohoúhelníku (shoelace) s ohledem na to, že Y na obrazovce roste DOLŮ (znaménko se
    proti matematické konvenci obrací),
  - žádná cesta → teprve pak fallback rovný posun `from`→`to` (poslední pojistka, skoro
    nikdy). Nahrazuje původní „u nejednoznačnosti rovný posun" — nejednoznačnost (kruhový
    skok) se teď animuje korektně po směru hodinových ručiček.
- **Bezpečnostní pojistka „jeden diff = právě jeden tah":** když rozdíl neodpovídá jednomu
  legálnímu tahu (nesedí geometrie/počet sebraných, dva slité tahy, přeskočený poll) →
  rekonstrukce vrátí `null` → **žádná animace, jen tiché přepsání desky** (dnešní chování).
- **Kruhový skok dámy → animace po směru hodinových ručiček** (výběr z platných variant DFS,
  viz výše). Rovný posun `from`→`to` zůstává jen jako fallback, když DFS nenajde ŽÁDNOU
  platnou cestu.
- **Přerušitelnost:** v běžném běhu se animace NEstohují (po tahu AI vrací každý další poll
  à 250 ms stejnou pozici → prázdný diff → no-op; člověk během tahu AI neklikne). Přesto:
  dorazí-li nová JINÁ pozice během animace, kámen okamžitě skočí na konec a zpracuje se
  nová (žádná fronta pozic).
- **CSP:** posun přes `element.animate([...], { duration, easing, fill: 'none' })`
  (Web Animations API, CSSOM — NE inline `style`, NE `<style>`). `fill: 'none'`, aby po
  animaci nezůstal zaseknutý transform (finální DOM je už na správném poli).
- **Pixelové offsety** ber z `getBoundingClientRect` buněk `.square` (robustní vůči
  responzivnímu gridu), ne z natvrdo dopočtené `--square`.

## Watch out for
- **Progresivní mizení sebraných kamenů je nejnáročnější kus.** Nová pozice ze serveru už
  sebrané kameny NEMÁ, ale `renderPiece` je dnes maže hned při update. Animační tok proto
  musí obrátit dnešní pořadí: nová pozice se aplikuje tak, že se sebrané kameny DOČASNĚ
  podrží v DOMu a odeberou se skok po skoku (na `finished` každého dílčího skoku). Řetěz
  dílčích WAAPI animací (await každého skoku → odeber sebraný pro ten skok → další).
- **Neshodit klikání ani idempotentní recyklaci `renderPiece`.** Kámen, který se hýbe, je
  recyklovaný element (kvůli komentáři v `renderPiece` — nesmí se vyměnit mezi
  mousedown/mouseup). Animace musí běžet na SPRÁVNÉM elementu po update, ne na nově
  vytvořeném.
- **z-index během animace:** pohybující se kámen musí být VIZUÁLNĚ nad ostatními (jinak se
  „podleze" pod kameny) i nad zvýrazněním. Přes třídu ve `styles.css` (CSP), přidat na
  začátku, odebrat na konci/při přerušení.
- **Proměna (man→king) na konci tahu:** kámen se během posunu může proměnit. Třída `king`
  se projeví na konci animace (kosmetika), ať koruna „nepředběhne" kámen.
- **Dispose / nová hra během animace:** poll/animace může doběhnout až po `dispose`
  (`disposed=true`) nebo po výměně partie — animace se musí dát zrušit a nesmí přepsat
  desku vyměněné partie (viz stávající `disposed` guard v controlleru).
- **Dva plies v jednom diffu:** kdyby `postMove` vrátil stav až po tahu AI, nebo poll
  přeskočil ply, diff obsáhne víc než jeden tah → pojistka výše to musí poznat a
  neanimovat.
- **Duration konstanta:** ~180 ms/skok je odhad; při trojskoku (~540 ms) se blíží dvěma
  poll cyklům — o důvod víc mít přerušitelnost otestovanou, ne jen naprogramovanou.
- **Kruhový skok = okrajový případ** (jen dáma, v reálné hře vzácný). Přidává backtracking
  + výpočet orientace kvůli málu — ale DFS je stejně potřeba pro korektní pořadí i u
  nekruhových skoků dámy (ty můžou taky větvit), takže „po směru hodinových ručiček" je
  jen malý přídavek. Test: fixní pozice s kruhovým skokem dámy ověří, že vyjde varianta
  po směru hodinových ručiček (a že orientace počítá s Y dolů).

## Run report
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
