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
