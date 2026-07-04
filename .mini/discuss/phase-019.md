# Phase 19 — Orchestrace enginu: podproces + fronta

## Intent
Lepidlo mezi serverem (fáze 18, čistě člověk↔REST, in-memory store, žádný
podproces, žádný shutdown hook) a enginem (samostatný proces za JSON Lines,
`bestmove` s měkkým `timeMs`, tvrdý strop nechává na volajícím).

Fáze staví `EngineClient` v serveru: spustí engine jako podproces, mluví s ním
po řádcích (párování požadavek↔odpověď přes `id`), řadí `bestmove` do **sériové
fronty**, hlídá tvrdý timeout `timeMs+500`, při killu/pádu **restart + 1 retry
na `timeMs/2`**, uklidí procesy při startu i vypnutí. A endpoint/cesta, kterou se
tah enginu reálně dostane do partie — ověřený **stejnou cestou přes `rules`
(`findLegalMove`) jako tah člověka**, protože engine je nedůvěryhodný a server
zůstává jedinou autoritou.

Brána M4: kill enginu uprostřed přemýšlení → partie přežije, zotaví se (retry
uspěje) a pokračuje přes HTTP.

## Key decisions
- **Spouštění tahu enginu = polling model** (ne explicitní endpoint). `POST
  /games/:id/moves` aplikuje tah člověka, vrátí OKAMŽITĚ stav po tahu člověka a
  na pozadí (v sériové frontě, **nikdy synchronně v handleru**) spustí výpočet
  enginu. Klient tah enginu uvidí pollingem `GET /games/:id`. Sedí s M5/todo 20
  (optimistický tah + polling ~250 ms).
- **Barvy napevno pro v1:** člověk = černý (začíná), engine = bílý. Engine vždy
  jen odpovídá, nikdy netáhne první → žádná zvláštní logika při založení partie,
  žádná volba barvy.
- **Jeden sdílený proces enginu + jedna globální sériová fronta** přes všechny
  partie. Víc souběžných partií / paralelismus je M6 (todo 22), teď ne.
- **Úklid zombie přes pidfile:** při vypnutí SIGTERM/SIGINT → zabít engine; při
  startu přečíst pidfile a zabít osiřelý proces z minulého (spadlého) běhu.
  Reálné riziko: engine BĚHEM searche nečte stdin, takže po SIGKILL rodiče běží
  dál jako sirotek, dokud nedopočítá — EPIPE ho sám nezabije včas. Pidfile je
  procesní hygiena, ne perzistence partií (výjimka z „žádná perzistence").
- **Trvalé selhání enginu = partie přežije, server nespadne.** Když oba pokusy
  vyprší / engine spadne / vrátí NELEGÁLNÍ tah: tah enginu se nesplní, partie
  zůstane stát na tahu člověka, chyba se zaloguje a **vystaví ve stavu**. UI
  kolem toho řeší M5.
- **Nový stav `engineStatus: 'idle' | 'thinking' | 'error'`** v `GameDto`
  (rozšíření drátového kontraktu → fixují testy). Zdůvodnění TEĎ, ne pro
  budoucnost: bez něj není brána „pokračuje / zotaví se" přes HTTP pozorovatelná
  a trvalé selhání (bod výš) je pro klienta neviditelné.
- **Čas enginu drží server:** konstanta `ENGINE_TIME_MS` (návrh 1000 ms),
  přebíjitelná přes env; klient ji NEposílá. Tvrdý timeout = `ENGINE_TIME_MS +
  500`, retry na `ENGINE_TIME_MS / 2`.
- **Injektovatelný spawn příkaz** (cesta + argumenty) v `EngineClient`, aby test
  brány mohl ukázat na falešný pomalý/nereagující engine a spolehlivě spustit
  větev timeout → kill → restart → retry. Reálný engine se testuje zvlášť v
  happy path.

## Watch out for
- **`tsx` studený start (stovky ms).** Po killu retry na `ENGINE_TIME_MS/2`
  znamená, že část rozpočtu sežere restart procesu → reálný čas na search je
  kratší. Retry zachraňuje partii, ne kvalitu tahu. Zvážit warm proces a
  respawn jen jednou.
- **Nelegální tah od enginu je jiné selhání než timeout/pád.** Retry
  (`timeMs/2`) je pro pád/timeout; nelegální nebo protokolová chyba (engine
  odpoví, ale `findLegalMove` = undefined, nebo `error`/`no_legal_moves`) →
  rovnou `engineStatus: 'error'`, žádné zacyklení retry. Engine je nedůvěryhodný,
  jeho `move` se NIKDY neaplikuje bez `findLegalMove`.
- **Zdvojený tah člověka, než engine odpoví,** odmítne autorita sama (není černý
  na tahu → prázdný seznam legálních tahů → 409 illegal_move). Žádné zvláštní
  `if` navíc.
- **Po hard-killu žádné zpožděné řádky** ze starého procesu (roura se zavře),
  nový proces má čisté pípy → párování přes `id` se nezmate. Hard timeout VŽDY
  killuje, takže nevzniká nejednoznačnost „pozdní odpověď na starý id".
- **Server dnes nemá shutdown hook** — přidat SIGTERM/SIGINT → zavřít engine +
  smazat pidfile → `app.close()`. Bez toho by kill serveru nechal osiřelý engine.
- **Engine se ptá jen když `gameResultFromState === 'ongoing'`.** V pozici bez
  legálních tahů je partie u konce, `bestmove` by vrátil `no_legal_moves` — na to
  se engine vůbec nemá ptát.
- **Fronta drží stav i při chybě.** Když job selže/vyhodí, fronta se nesmí
  zaseknout (další partie musí jít dál) a nesmí zůstat polovičatý stav (proces
  bez pidfile, `engineStatus` viset na `thinking`).
- **Test brány musí mít zuby:** dočasné vypnutí kill/retry logiky musí shodit
  test (partie by po killu uvázla), ne jen „běží to".
