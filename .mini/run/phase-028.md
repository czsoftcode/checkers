---
phase: 28
verdict: done
steps:
  - title: "Modul sound.ts: přehrávač s mapou událostí"
    status: done
  - title: "Odemčení na první uživatelský gest"
    status: done
  - title: "Test sound.ts v jsdom"
    status: done
  - title: "Napojení do board-view na každý dopad"
    status: done
  - title: "Test animace + nezávislý self-review"
    status: done
verify:
  - title: "Reálný zvuk v prohlížeči: pohyb/dopad při tahu, střídání u víceskoku, a fanfára/zvuk prohry na konci partie?"
    detail: "Testy ověřují jen POČET a načasování volání play(...), ne že to reálně zní. Pusť klienta (server + web), zahraj tah a dvojskok/trojskok (rytmus pohyb→dopad→pohyb→dopad), a doveď partii do výhry i prohry (i přes vzdání) – hlasitost, délka a dojem jde posoudit jen uchem."
  - title: "První tah AI před prvním klikem na desku je záměrně tichý (autoplay policy)"
    detail: "unlock() visí na prvním kliknutí do desky. Když AI táhne jako první (dřív než člověk cokoli klikne), zvuk toho tahu prohlížeč zablokuje a je němý. Od prvního kliknutí dál OK. Posuď, jestli to vadí; případný fix (odemknout i z tlačítka Nová hra) je v controlleru, mimo tuto fázi."
---

# Phase 28 — report z auto session

## Co je hotové
- **Nový modul `packages/web/src/sound.ts`** – samostatná, rozšiřitelná vrstva
  přehrávání zvuků. `createSoundPlayer(audioFactory?)` vrací `{ unlock(), play(event) }`.
  Mapa `SOURCES` (událost→URL): `move` = `pohyb_kamene.mp3` (rozjezd), `land` =
  `dopad_kamene.mp3` (dopad), `win` = `vitezne_fanfary.mp3` (výhra), `loss` =
  `zvuk_prohry.mp3` (prohra), vše přes Vite `?url`. Přidání dalšího zvuku =
  rozšířit `SoundEvent` + jeden řádek mapy.
- **Zvuk konce partie v `controller.ts`**: při přechodu `ongoing → terminální`
  (detekováno v `applyServerState`, kudy tečou všechny cesty – tah, poll, vzdání,
  remíza) zazní JEDNOU fanfára (`black-wins`, člověk hraje černé) nebo zvuk prohry
  (`white-wins`); remíza je záměrně beze zvuku. Nezvučí při načtení už skončené
  partie ani opakovaně dalšími polly. Vzdání a nabídka remízy navíc odemykají audio
  (uživatelský gest), ať zvuk zazní i bez předchozího kliknutí do desky. Player je
  jeden sdílený (controller ho vytvoří a předá do board-view), injektovatelný přes
  `options.soundPlayer` kvůli testu.
- **Zvuk konce je ZPOŽDĚNÝ za animací vítězného tahu** (oprava nálezu: fanfára dřív
  zazněla na začátku posledního dvojskoku). `board-view.update()` nově vrací
  `Promise<void>`, který se vyřeší po dokončení (nebo přerušení) animace tahu;
  controller na něj navěsí `setTimeout(END_SOUND_DELAY_MS = 500 ms)` a teprve pak
  přehraje. Guardy `disposed` + `lastResult !== result` a `clearTimeout` v `dispose`
  zaručí, že zvuk staré partie nezazní do nové. Zpevnění: „opakovaný poll se stejnou
  pozicí" vrací promise BĚŽÍCÍ animace (ne hned vyřešený), takže i kdyby terminální
  výsledek dorazil na tutéž pozici až podruhé, zvuk počká na konec pohybu.
- **Guard bez Audio**: `audioFactory === null` (prostředí bez `Audio`) → `play`/`unlock`
  jsou bezpečné no-opy. `safePlay` navíc spolkne zamítnutý autoplay (příslib) i
  synchronní výjimku (jsdom „Not implemented") – zvuk je kosmetika, nesmí shodit hru.
- **Odemčení autoplay**: `unlock()` na prvním kliknutí do desky (uživatelský gest)
  jednou přehraje zvuk ztlumeně; idempotentní. Bez toho by prohlížeč mlčel po tazích AI.
- **Napojení do `board-view`**: `createBoardView(onSquareClick, player?)` – player je
  injektovatelný (default reálný). U víceskoku se střídá **rozjezd→dopad→rozjezd→dopad**:
  rozjezd (`move`) na začátku KAŽDÉHO skoku (první synchronně, další přes timery v čase
  `i*(HOP_MS+DWELL_MS)`), dopad (`land`) na KAŽDÉM dopadu (mezidopady přes hop-timery
  `hopArrivalMs`, finální dopad v `finalize`). Reduced-motion/instant větev přehraje jen
  dopad. Nový audio uzel pokaždé → překrývající se zvuky se nezaříznou.
- **Testy**: `sound.test.ts` (8) – guard, správné zdroje (4 různé soubory), nový uzel
  pokaždé, idempotence unlocku, spolknutí zamítnutého autoplayu i synchronní výjimky.
  `board-view-sound.test.ts` (6) – rozjezd na začátku každého skoku, dopad na každém
  dopadu, střídání u víceskoku, zrušení při cancel/dispose, reduced-motion větev.
  `controller-sound.test.ts` (7) – výhra→fanfára (jednou), prohra→zvuk prohry,
  remíza→ticho, vzdání→prohra+unlock, načtení skončené partie→ticho, a hlavně:
  zvuk konce ČEKÁ na dokončení animace vítězného tahu (i pro scénář „stejná pozice
  ongoing→terminální během animace"). Celý web suite: **113 zelených, 13 souborů**,
  typecheck i lint čisté.

## Nález nezávislého reviewu, který jsem OPRAVIL (důležité)
Sub-agent s čerstvým kontextem našel reálnou chybu v mém prvním návrhu: finální (a u
prostého tahu jediný) zvuk byl původně naplánovaný přes `setTimeout` přesně na `totalMs` –
tedy na stejný okamžik, kdy `anim.finished` → `finalize` → `clearTimers` ten timer uklidí.
Timery se nikdy nepředbíhají, `finished` se řeší na framu ≥ totalMs, takže `finalize` mohl
závod vyhrát a **finální zvuk by intermitentně mizel** – a moje tehdejší testy to nemohly
odhalit, protože fake `finished` se nikdy neřešil (finalize v testu neběžel).

Oprava: finální dopad hraje `finalize` (garantovaná cesta dokončení), timery jen mezidopady.
Testy jsem přepsal tak, že fake animaci reálně dořeší (finalize proběhne), takže teď ověřují
i finální zvuk – ověřeno „zuby" (vyříznutí `play` z finalize shodí 2 testy).

## Vědomé trade-offy / co jsem NEřešil (mimo rozsah)
- **iOS Safari**: „nový Audio uzel pokaždé" (kvůli překrývání dopadů) se tluče s per-element
  odemykáním na iOS – tam by dopady mimo gesto mohly zůstat blokované. Projekt ale mobil
  nemá v cílech (non-goal „žádná mobilní appka/PWA"), proto neřeším.
- **`safePlay` catch je široký** (chytne i případný TypeError z `node.play()`). U čistě
  kosmetického zvuku obhajitelné; v produkci je `node` garantovaný `new Audio`.
- **Zvuk konce partie při vzdání bez kliknutí do desky**: pokrytý – `resign()`/
  `offerDraw()` odemykají audio jako uživatelský gest. Přesto: pokud by prohlížeč
  odmítl i toto odemčení (přísná politika), `safePlay` selhání spolkne a zvuk prohry
  nezazní (kosmetika, ne pád). K ověření uchem na reálném prohlížeči.

## Poznámka k infrastruktuře testů
Přidán `packages/web/test/setup.ts` (+ `test.setupFiles` v `vite.config.ts`): jsdom
neimplementuje `HTMLMediaElement.play()` a zapleveloval výstup hláškou „Not implemented".
Shim ho v testech nahradí no-opem – čistě testové prostředí, produkce se na něj nespoléhá
(má `safePlay`). Animační testy navíc dostaly injektovaný tichý player.
