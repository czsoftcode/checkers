# Phase 71 — Klient: výzva a start hry

## Intent
Čistě KLIENTSKÝ řez nad hotovým serverem (fáze 68/70). Rozšířit `room-client.ts` a
`lobby.ts`/`main.ts` tak, aby v místnosti šlo:
- klikem na přezdívku poslat výzvu,
- vyzvanému ukázat příchozí výzvu a nechat ho přijmout/odmítnout,
- korektně zpracovat 4 serverové zprávy výzev,
- po `challenge-accepted` u OBOU klientů přejít na herní obrazovku (placeholder).

PvP deska a posílání tahů jsou VĚDOMĚ mimo řez = todo 47. Ověření: unit test
room-klienta s fake WS (vzor fáze 69) + ruční průchod dvou prohlížečů.

### Hotový serverový kontrakt (fáze 68/70) — klient na něj sedí ručně (web nezávisí na balíčku server)
Klient → server (po `/room/ws`):
- `{type:'challenge', targetId}`
- `{type:'accept', challengeId}`
- `{type:'reject', challengeId}`

Server → klient:
- `{type:'challenged', challenge:{id, challengerId, challengerNick}}` — jen VYZVANÉMU
- `{type:'challenge-accepted', gameId, color:'black'|'white', opponentId}` — OBĚMA
- `{type:'challenge-rejected', challengedId}` — jen VYZYVATELI
- `{type:'challenge-cancelled', challengeId}` — protějšku zaniklé (vedlejší/odchod) výzvy
- Chyby výzev tečou přes existující `{type:'error', message}` (busy, sebe-výzva, dvojitá/křížová,
  „výzva už neplatí", „vyzvaný není v místnosti"). Klient je jen zobrazí, logiku drží server.

Barvy: vyzyvatel = černá (táhne první), vyzvaný = bílá. Deterministické.

## Key decisions
- **Herní obrazovka = PLACEHOLDER.** Po přijetí ukázat jen „Partie začala / hraješ za černé|bílé /
  soupeř <nick> / (deska přijde v todo 47)" + tlačítko „Zpět do místnosti". ŽÁDNÁ deska, ani read-only
  (držet řez ostrý, neprotáhnout sem todo 47). Barvu a gameId klient zná z `challenge-accepted`;
  nick soupeře si dohledá z rosteru přes `opponentId` (session id, ne nick) — fallback „soupeř",
  kdyby v rosteru nebyl.

- **Room WS MUSÍ přežít přechod lobby→hra (NEkopírovat sólo vzor!).** Fáze 70 posílá PvP tahy PO
  ROOM WS (autorita z `me.id`). Kdyby přechod room-client `dispose`nul (jako dnes sólo v `main.ts`),
  zabije to session id → hráč nemůže táhnout, `players.black/white` binding padne a `removePlayer`
  navíc zruší `busy` a pošle soupeři `left`. Proto: vlastnictví room-clientu ZVEDNOUT do `main.ts`
  (nebo jinak zajistit, že přežije), přechod lobby↔hra je jen výměna VIEW nad TÝMŽ živým socketem,
  ne teardown WS. „Zpět do místnosti" z placeholderu = jen přepnutí view, ne zavření WS (hráč
  zůstává `busy` na serveru, to je pro tento řez OK — konec/uvolnění partie je todo 40).
  - Pozor: sólo cesta („Hrát proti počítači") room WS DÁL zavírá (fáze 69) — to zůstává. Mění se
    jen chování při přechodu do PvP hry.

- **Vyzyvatel drží MAX 1 odchozí výzvu (klientské omezení).** Server nikdy neposílá vyzyvateli id
  jeho odchozí výzvy, takže `challenge-cancelled{challengeId}` neumí vyzyvatel spárovat s cílem.
  Řešení bez zásahu do serveru: dokud čekáš na odpověď na výzvu, UI nedovolí vyzvat dalšího →
  jakýkoli příchozí `challenge-cancelled` (nebo `challenge-rejected`) jednoznačně vyčistí tu jedinou
  odchozí. Cena: nejde vyzvat víc lidí najednou (server to umí, klient to vědomě omezí).
  - Vyčištění odchozí „čekám na odpověď": na `challenge-rejected{challengedId}` (namapuj přes
    challengedId; s max-1 stejně jednoznačné), na `challenge-cancelled` (protějšek odešel) a při
    přechodu do hry (`challenge-accepted`).

- **Příchozí výzvy = SEZNAM VŠECH.** Hráč může mít víc příchozích výzev naráz (B i C ho vyzvou;
  server busy nastaví až přijetím). Ukázat všechny, každou zvlášť přijmout/odmítnout. Držet je podle
  `challenge.id`. Po přijetí jedné server pošle `challenge-cancelled{challengeId}` na ostatní →
  z listu je odeber podle id (vyzvaná strana id má z `challenged`, mapování funguje).

## Watch out for
- **Rozšíření `room-client.ts`:** dnes `handleMessage` cizí typy TIŠE ignoruje (`default: return`).
  Doplnit case pro `challenged` / `challenge-accepted` / `challenge-rejected` / `challenge-cancelled`
  + nové odesílací metody `challenge/accept/reject`. KAŽDÁ příchozí zpráva se tvarově ověří PŘED
  přístupem k polím (vzor `isRoomPlayer`): chybí id/gameId/color, špatný typ, `JSON.parse('null')`
  → ignorovat/nespadnout, ne protéct undefined do UI.
- **`challenge-accepted` musí zpracovat OBA** (vyzyvatel i vyzvaný) — oba přejdou do hry. Klient
  nesmí předpokládat, že přijímá jen vyzvaný.
- **`opponentId` je session id, ne nick** — dohledat nick z rosteru; poč. s tím, že tam nemusí být.
- **Cross/double výzva je ošetřená SERVEREM** (hasPendingBetween → error). Klient jen zobrazí
  `error`. Díky max-1-odchozí navíc na klientu nevznikne A→B, když už A→B čeká. A→B odchozí +
  B→A příchozí nemůže nastat (server B→A odmítne). Klient nemusí duplikovat serverovou logiku.
- **Přijmout příchozí, když mám odchozí:** povolené. Přijetí spáruje mě a server zruší mou odchozí
  (protějšek dostane cancelled); můj přechod do hry přijde přes `challenge-accepted`, odchozí stav
  jen zahodit. Neblokovat accept kvůli max-1-odchozí (to omezuje jen VYTVÁŘENÍ druhé odchozí).
- **CSP (globální pravidlo):** žádné inline styly/skripty — banner výzvy i placeholder stylovat
  třídami v `styles.css`.
- **Úklid při dispose/přepnutí:** listenery na tlačítka výzev odregistrovat; room-client se ale
  NEdisposuje při přechodu do hry (viz výše) — dispose až při reálném odchodu z appky/sóla.
- **Unhappy path k projití v self-kontrole:** výzva na hráče, co mezitím odešel (`error` „není
  v místnosti"), přijetí zaniklé výzvy (`error` „výzva už neplatí" → banner zmizí, nespadnout),
  odmítnutí, soupeř odešel během čekání (cancelled → vyčistit odchozí i příchozí), víc příchozích
  a přijetí jedné (ostatní zmizí přes cancelled), tvarově vadná/neúplná challenge zpráva.
- **Test má mít zuby (fake WS, vzor fáze 69):** ověřit odchozí JSON (`challenge/accept/reject`
  se správnými poli `targetId`/`challengeId`), že `challenged` naplní seznam příchozích, že
  `challenge-accepted` spustí přechod se správnou barvou+gameId, že `challenge-rejected` i
  `challenge-cancelled` vyčistí odchozí, že přijetí jedné příchozí a cancelled ostatní odebere
  z listu, a tvarová obrana proti rozbité zprávě.
