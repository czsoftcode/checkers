---
phase: 25
verdict: done
steps:
  - title: "Protokol evaluate + handler enginu"
    status: done
  - title: "engine-client: evaluate() + EngineMover"
    status: done
  - title: "store.acceptDraw (dvojče resign)"
    status: done
  - title: "Endpoint POST /games/:id/offer-draw"
    status: done
  - title: "server-client + controller: offerDraw()"
    status: done
  - title: "app-shell: tlačítko + stav + CSS + self-review"
    status: done
verify:
  - title: "Tlačítko „Nabízím remízu" v reálném prohlížeči"
    detail: "Testy ověřily logiku (enable/disable, hlášky, zamčení během rozhodování) v jsdom, ne skutečné vykreslení. Ověř vizuálně: tlačítko je vidět, aktivní jen na tvém tahu a když počítač nepřemýšlí, po odmítnutí ukáže hlášku, po přijetí skončí partie remízou."
  - title: "Kalibrace prahu přijetí (herně)"
    detail: "Práh je DRAW_ACCEPT_MAX_WHITE_SCORE = 0 (přijme, když bílý nevede). Jestli to sedí (nerozdává vyhrané pozice, ale ve vyrovnaných remízuje) jde posoudit jen odehranými partiemi – konstanta je vědomě laditelná, doladění je mimo rozsah fáze."
---

# Phase 25 — report z auto session

Nabídka remízy hotová jako vertikální řez a celá zelená: lint + typecheck čisté,
testy 90 (server) / 74 (web) / 222 (engine) / 24 (cli) prošly.

## Co se povedlo
- **Struktura „vzdání s obrácenou logikou" vyšla.** `store.acceptDraw` je dvojče
  `resign` (stejný atomický check-and-set přes efektivní výsledek), endpoint kopíruje
  tvar `/resign` + archivaci „právě jednou". Málo nového kódu, hodně sdílené cesty.
- **Znaménko skóre má zuby na OBOU větvích.** Skóre ze searche je z pohledu strany
  na tahu; server ho na tahu černého obrací na pohled bílého. Ověřeno spuštěním na
  kopii: rozbití negace shodí testy (větev černého 3 testy, větev bílého 1 test).
- **Chybové cesty nevedou k tichému falešnému úspěchu.** Selhání enginu při
  vyhodnocení → 503 `engine_unavailable`, partie beze změny (ne přijetí ani odmítnutí).
  Pokřivené skóre z nedůvěryhodného enginu → `EngineProtocolError` na hranici procesu,
  bez retry. Bez enginu → 409 `draw_offer_unavailable`.

## Rozhodnutí padlá při implementaci (drobná, ne ADR)
- **Nová protokolová zpráva `evaluate`** místo přilepení `score` k `bestmove`
  (čistší záměr; PROTOCOL_VERSION 2→3, `warmup` hlídá). Sdílená validace `timeMs`
  vytažena do `validateTimeMs`, ať se kontrakt neduplikuje mezi bestmove/evaluate.
- **Endpoint synchronní**, verdikt v odpovědi `{ accepted, game }` – žádný „pending
  offer" stav v paměti. Klient (`server-client.parseDrawOffer`) tvar ověřuje.
- **Verdikt nabídky žije ve vlastním řádku `offer-msg`**, nezávisle na řádku stavu
  (ten řídí polling přes onState) – proud stavů z pollingu hlášku nepřepíše.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Bez vážné vady. Dva body dořešeny hned:
- **Netestovaná větev negace pro bílého na tahu** → přidán test se zuby (engine v
  `error`, bílý na tahu, skóre se neneguje). Ověřeno, že rozbití té větve test shodí.
- **Doc-drift v hlavičce fake-enginu** → hlavička srovnaná s realitou (evaluate,
  módy error/malformed, --score/--protocol).
Zbylé nálezy vědomě ponechány: guard `engine_busy` má TOCTOU okno, ale skutečnou
bezpečnost drží downstream (`acceptDraw` re-check + `runEngineMove` re-check po await),
takže ke korupci stavu nedojde – guard je jen UX pojistka.

## Známá omezení (vědomá)
- **Práh 0 vs poziční evaluace.** Engine dnes hraje s v1 evaluací (`evaluate`, materiál
  + zadní řada + postup), ne evaluateV2. I ta dává v remízových pozicích občas nenulové
  skóre → práh 0 může odmítnout i mrtvě remízovou koncovku. Konstanta je laditelná,
  doladění chce odehrané partie (viz verify).
- **Hláška „Počítač remízu odmítl" přetrvává** až do dalšího tahu/Nové hry (čistí se
  jen na přijetí a Nové hře). Kosmetika, ne defekt.
- **PDN nerozliší dohodnutou remízu od remízy z pravidel** (obojí `1/2-1/2`).
