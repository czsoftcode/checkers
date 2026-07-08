---
phase: 75
verdict: done
steps:
  - title: "Optimistický render rozdělaného skoku v renderState"
    status: done
  - title: "Hop-po-hopu tažení + míchání s klikáním"
    status: done
  - title: "Tvrdý zámek do dokončení skoku"
    status: done
  - title: "Přepsat kontrakt/komentáře + zvýraznění dokonči skok"
    status: done
  - title: "Testy: obrácené případy + nové"
    status: done
  - title: "Ověření + nezávislý adversarial self-review"
    status: done
verify:
  - title: "Optika a plynulost rozdělaného skoku v reálném prohlížeči (myš)"
    detail: "Testy běží v jsdom (bez WAAPI/layoutu). Ověř okem: hop-po-hopu tažení i klikání – kámen zůstane na mezidopadu, sebrané zmizí, zvýrazní se povinný další dopad; míchání tažení+klik v jednom skoku; po dokončení se kámen jen usadí (žádné druhé sklouznutí)."
  - title: "Vizuální výzva 'dokonči skok' čitelná dost, ať to nevypadá zamrzle"
    detail: "Rozhodli jsme se NEpřidávat text do stavu, jen zvýraznit povinné další dopady (třída .target) + kámen na dopadu (.selected) + trasa (.path). Posuď, jestli to hráči dost jasně říká 'skoč dál', nebo to chce víc (např. pulz cíle) – to by byla další fáze."
  - title: "Klikací víceskok: poslední dopad se ukáže až po serveru (parita s AI)"
    detail: "Při DOKONČENÍ víceskoku klikáním kámen zůstane opticky na předposledním dopadu a na koncové pole 'doskočí' až s potvrzeným stavem ze serveru. Shodné s hrou proti AI (záměr), ale v PvP s vyšší latencí to může být víc vidět. Posuď, jestli vadí."
---

# Phase 75 — report z auto session

## Co se udělalo
Vícenásobný skok na PvP desce teď jde skládat HOP-PO-HOPU tažením i klikáním (parita s hrou proti AI). Kámen jde pustit/ťuknout i na mezidopad, tam ZŮSTANE a čeká na další skok; rozdělaný skok se ukazuje opticky shodně u obou způsobů (`effectivePosition`: kámen na dopadu, sebrané schované). Tažení a klikání jde v jednom skoku míchat.

Jádro je přenesení hotového vzoru z `controller.ts` (hra proti AI) do `pvp-controller.ts`: `lastHopOf`, `effectivePosition` (+ import `capturesForPrefix`), `onDrop` s `{ kind: 'hop' }`, pokračování tažení z posledního dopadu (`canDrag`/`onDragStart`), klikací hop přes `view.settle` a `settleNext` pro víceskok. `board-view` se neměnil (`hop`/`settle` už uměl).

Klíčový PvP rozdíl proti AI: žádný polling. Proto místo pollingu TVRDÝ ZÁMEK – jakmile hráč potvrdí první meziskok (`selection.path.length > 0`), deska je zamčená do dokončení: klik mimo povinný dopad se ignoruje (žádné zrušení), přetáhnout jde jen kámen na posledním dopadu. Únik ze zámku: dokončení, odmítnutí serverem (`showError`), nebo ztráta spojení (`setConnectionLost`) – oba srovnají desku zpět přes `view.settle` (vrátí i optimisticky sebrané kameny).

Přepsal jsem hlavičkový doc-komentář `pvp-controller.ts`: dřív stavěl na „deska se NEhýbe optimisticky", teď se během skládání skoku opticky hýbe (zdůvodnění: dokud se skok neodešle, server o něm neví → optika je lokální a plně vratná přes settle).

## Ověření
- `pnpm -r typecheck` zelené, `pnpm lint` (eslint) zelené.
- Testy: web 363 (z toho pvp-controller 33 – přidal jsem 10 nových + upravil 2 obrácené), rules/engine/cli/server beze změny a zelené.
- Dva testy obrátily chování (dřív padaly happy-path předpoklady): „dopad na MEZIpole" (dřív návrat → teď hop, kámen zůstane) a „při tažení svítí KONCOVÉ pole" (dřív endpoints → teď bezprostřední dopad).
- Nové testy s zuby na unhappy path: ztráta spojení / showError uprostřed skoku (obnova sebraných), neúspěšné odeslání dokončeného víceskoku, tvrdý zámek (stray klik nic nezruší a skok jde dokončit), míchání gest obou směrů.

## Adversarial (nezávislý sub-agent, čerstvý kontext)
Prošel scénáře: drop mimo/nelegál uprostřed skoku, loss/showError uprostřed, `applyState` uprostřed skoku, proměna man→king na konci řetězu, `sendMove=false` po optických hopech, míchání gest. Verdikt: žádný tvrdý dosažitelný stav-korupční nález; invariant drží. Ověřil i, že proměna vždy ukončuje tah (generátor pravidel), takže `effectivePosition` nikdy nezobrazí muže „za proměnou".

Jeden bod z review jsem ROVNOU OPRAVIL: `sendMove` se volalo bez `try/catch`, a `socket.send` může ve vzácném závodě stavu spojení vyhodit – výjimka by propadla z `onDrop`, deska by nespustila `finishDrag` (tažený kámen zůstane zvednutý, vstup odemčený, bez hlášky). Přidal jsem `trySend` s úzkým catch jen kolem `sendMove` (nemaskuje logiku controlleru), který výjimku bere jako „neodesláno" a jede stejnou vratnou cestou jako `false` + regresní test.

## Mimo řez (vědomě)
Vzdání/remíza (todo 40), reconnection (todo 42). „Vědomé zrušení skoku" jsme se rozhodli NEdělat (tvrdý zámek) – kdyby při hraní vadilo (uvíznutí ve vědomě špatně zvolené větvi), je to kandidát na pozdější todo.
