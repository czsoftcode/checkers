# Phase 45 — Úroveň Výuka: nápověda na desce

**Goal:** Přidat Výuku jako čtvrtou úroveň (server LEVELS + klientský GAME_LEVELS + přepínač v UI) a ve Výuce na tahu člověka načíst z /hint doporučený tah a zvýraznit ho na desce; rozehraný/zahraný tah, nová hra i začátek tahu enginu běžící nápovědu bezpečně zruší, aby se nezvýraznil tah do neplatné pozice.

## Steps
- [done] Server: úroveň Výuka (plná síla) + test
- [done] Web kontrakt: getHint + GAME_LEVELS + popisek
- [done] board-view: kanál zvýraznění nápovědy
- [done] controller: životní cyklus nápovědy (auto, single-flight)
- [done] Testy controlleru se zuby
- [done] Verifikace: testy, lint, typecheck, ruční e2e

## Auto-commit
- Phase 45: Úroveň Výuka: nápověda na desce

## Discussion
# Phase 45 — Úroveň Výuka: nápověda na desce

## Intent
Přidat Výuku jako čtvrtou úroveň v přepínači. Ve Výuce hraje engine soupeře **plnou
silou** (jako Profesionál) a k tomu se hráči na **každém jeho tahu sama** ukáže nápověda
(doporučený tah z endpointu `GET /games/:id/hint`, fáze 44), zvýrazněná na desce
(výchozí kámen + cíl). Nápověda se načte přes **stejnou single-flight cestu** jako ostatní
dotazy: deska ~1 s počká (busy), pak nápovědu ukáže a teprve pak smí hráč táhnout.

## Key decisions
- **Soupeř ve Výuce = plná síla.** `STRENGTH_BY_LEVEL['education'] = undefined` (stejné
  jako `professional`). Rozdíl oproti Profesionálovi je POUZE klientský: ukazují se
  nápovědy. Zdůvodnění: nápověda vždy ukáže správný tah (držíš-li se jí, hraješ optimálně
  → remíza; odchýlíš-li se, engine chybu potrestá → učení). V `levels.ts` to potřebuje
  komentář, proč dvě úrovně mají shodnou sílu soupeře.
- **Auto-zobrazení, žádné tlačítko.** Nápověda se ukáže sama, jakmile je na tahu člověk.
- **Blokující (single-flight), ne paralelní.** Nápověda jde přes `runRequest` (busy).
  DŮSLEDEK: hráč nemůže táhnout, dokud nápověda počítá → „překryv nápovědy a tahu",
  kterého se autor bál, z velké části VŮBEC NEVZNIKNE (busy klik/tažení nepustí). Jediné
  rušení, které zbývá, je „Nová hra" během čekání → pokrývá stávající `disposed` guard.
  Cena: ~1 s pauza na začátku každého tahu člověka (u výuky spíš žádoucí – vidíš radu
  dřív, než táhneš). Vědomě odmítnuta paralelní varianta (plynulejší, ale vrací složité
  rušení běžícího requestu = víc kódu a chyb).
- **Časový rozpočet:** engine počítá do ~1 s (`DEFAULT_ENGINE_TIME_MS = 1000`, tvrdý strop
  +500 ms), takže „plná síla" ≈ ~1 s, ne mnoho sekund – proto je blokující varianta únosná.
- **Kontrakt:** endpoint `/hint` vrací `{ move: MoveDto }`. `ServerClient` dostane metodu
  `getHint(id): Promise<MoveDto>` s parse funkcí ověřující tvar (jako `parseDrawOffer`).
  Controller pozná Výuku z `game.level === 'education'` (úroveň nese GameDto ze serveru,
  žádné extra plumbing).

## Watch out for
- **Cross-module duplicita úrovní.** `education` přidat na OBĚ místa: server `LEVELS`
  (`levels.ts`) i web `GAME_LEVELS` (`server-client.ts`) + český popisek `Výuka` do
  `LEVEL_LABELS` v `app-shell.ts` (bez popisku shodí typecheck – je vynucený). `professional`
  MUSÍ zůstat první v `GAME_LEVELS` (první `<option>` = default nové hry = serverový
  `DEFAULT_LEVEL`). `education` dát dál v pořadí. `isGameDto` guard se rozšíří sám.
- **Nezanořit hint request do single-flightu.** Nápověda se spouští při přechodu na tah
  člověka, jenže ten se detekuje uvnitř `applyServerState`, které běží UVNITŘ `runRequest`
  (poll/postMove). Spustit další `runRequest` synchronně by rozbilo bookkeeping `busy`/
  `inflight`. Fetch nápovědy proto odpojit (microtask / až po doběhnutí běžícího requestu).
- **Nefetchovat nápovědu na každý poll.** Poll běží à 250 ms a volá `applyServerState` se
  stejnou pozicí. Bez pojistky by se hint spouštěl znovu a znovu (a blokoval desku každých
  250 ms). Hlídat: fetchni jen když pro tenhle tah nápovědu ještě nemáš a zrovna se
  nefetchuje. Vlajnu vyčistit při změně tahu / odeslání tahu / dispose.
- **Kdy nápovědu ukázat / schovat / zahodit.** Ukázat: `level==='education'` &&
  `turn===HUMAN_COLOR` && `ongoing` && `selection===null` (rozehraný vlastní výběr má
  přednost, hint se schová). Zahodit `hintMove`: při odeslání tahu, přechodu na tah enginu,
  dispose. Výběr hint jen dočasně skryje (po zrušení výběru se zase ukáže z cache).
- **Zvýraznění je nový kanál v board-view.** `RenderState` nemá pole pro hint; přidat ho
  (např. `hint?: { from, path }`) + vlastní CSS třídu + vykreslení v `applyHighlights`.
  Vizuálně ODLIŠIT od výběru hráče (jiná barva/šipka), ať to nevypadá, že už kámen vybral.
  Musí respektovat otočení desky (člověk dole) – board-view orientaci už řeší, ověřit.
- **Graceful degradace při selhání.** `getHint` může vrátit `ServerError` (503
  `engine_unavailable` při timeoutu/pádu, síť). Pak nápovědu prostě neukázat, desku
  odblokovat (busy uvolní `runRequest` finally) a nechat hrát bez rady. Nikdy nezaseknout.
- **Latence se sčítá.** Po tahu enginu je už pauza ~600 ms (`AI_MOVE_PAUSE_MS`), pak ~1 s
  hint → člověk čeká ~1,6 s, než smí táhnout. Na první tah partie (člověk černý začíná) se
  čeká ~1 s hned na startu. Únosné, ale ověřit, že to nepůsobí jako „zaseklá" deska.
- **Rozsah.** Fáze sahá na server (levels), web kontrakt (server-client), board-view i
  nejcitlivější soubor (controller). Je to horní hranice jedné fáze; kdyby `plan` viděl
  >3 dny, odříznout board-view zvýraznění nebo controller logiku do zvláštní fáze.
- **Testy se zuby:** server – `education`→`undefined` v mapě sil; web – `getHint` parse
  (dobrý tvar × rozbité tělo → ServerError); controller – nápověda se ve Výuce načte a
  zvýrazní na tahu člověka, MIMO Výuku se nenačte, při dispose/změně tahu se zahodí,
  při chybě `/hint` se degraduje bez zaseknutí. Netestovat jen mock – ověřit reálnou cestu.

## Run report
---
phase: 45
verdict: done
steps:
  - title: "Server: úroveň Výuka (plná síla) + test"
    status: done
  - title: "Web kontrakt: getHint + GAME_LEVELS + popisek"
    status: done
  - title: "board-view: kanál zvýraznění nápovědy"
    status: done
  - title: "controller: životní cyklus nápovědy (auto, single-flight)"
    status: done
  - title: "Testy controlleru se zuby"
    status: done
  - title: "Verifikace: testy, lint, typecheck, ruční e2e"
    status: done
---

# Phase 45 — report z auto session

## Co je hotové
Výuka jako čtvrtá úroveň, end-to-end:
- **Server** (`levels.ts`): `education` → `STRENGTH_BY_LEVEL undefined` (soupeř plnou
  silou jako Profesionál; rozdíl Výuky je jen klientský). Reálně ověřeno curl-em na
  čerstvém serveru: `POST /games {level:education}` → 201, `GET /hint` → 200 s tahem.
- **Web kontrakt** (`server-client.ts`): `education` v `GAME_LEVELS`, volitelná metoda
  `getHint` + `parseHint`/`isMoveDto` (ověření tvaru), popisek „Výuka" v `app-shell.ts`.
- **board-view**: nové pole `RenderState.hint = { from, to }`, třídy `hint-from`
  (přerušovaný modrý rámeček) a `hint-to` (modrý prstenec), CSS proměnná `--hint`.
- **controller**: ve Výuce se na tahu člověka přes single-flight `runRequest` načte
  nápověda a zvýrazní. `tickLoop` (poll → hint) brání zanoření `runRequest`;
  `hintRequested` brání opakovanému fetchi každým pollem; hint se zahodí při odeslání
  tahu, změně tahu, konci partie i dispose; chyba `/hint` degraduje bez zaseknutí.

Testy: web 196 (+ nové `controller-hint.test.ts`, hint testy v `board-view`/`server-client`),
server 113. Lint + typecheck napříč repem čisté.

## Nález ze self-review (opraveno v rámci fáze)
Před reportem jsem pustil nezávislého sub-agenta (čerstvý kontext) na souběh a kontrakty.
Našel **reálný bug**: nápověda **zůstala svítit na skončené partii** po vzdání / přijaté
remíze ve Výuce. `maybeRequestHint` gate-oval fetch na `lastResult==='ongoing'`, ale
`currentHint()` (rozhoduje o VYKRESLENÍ) `lastResult` nekontroloval, a reset v
`applyServerState` běží jen při ZMĚNĚ TAHU – jenže vzdání/remíza mění výsledek beze
změny tahu (strana zůstává černá). Scénář: ve Výuce svítí rada, člověk klikne Vzdát →
deska skončí, ale rada dál svítí.

Oprava: do `currentHint()` přidán guard `lastResult !== 'ongoing'` (jediné místo, kde se
o zobrazení rozhoduje → pokryje i budoucí terminální cesty). Přidán regresní test
„vzdání ve Výuce nápovědu zhasne" – ověřeno, že má zuby (bez guardu padne).

Druhý (menší) nález: test odeslání tahu neměl plné zuby – reset v `submitMove` maskoval
reset při změně tahu, takže test procházel i s rozbitým `submitMove`. Přidán SYNCHRONNÍ
assert hned po kliknutí (před odpovědí serveru) → nyní chytí i regresi v `submitMove`
(ověřeno breaknutím). Ostatní souběhové body sub-agent potvrdil jako ošetřené
(zanoření runRequest, guard po awaitu, degradace chyby, čekání resign/remízy na inflight).

## Reálné rozhodnutí k zápisu (ADR)
`getHint` jsem dal na `ServerClient` jako **volitelnou** (property s arrow-typem), ne
povinnou metodu. Zvážená a zamítnutá alternativa: povinná metoda by vynutila stub ve
~24 fake klientech napříč 7 testy (režimy bez nápovědy) – to je ceremonie navíc. Volitelná
+ gate na `education` v controlleru + jediný reálný klient (`createHttpClient`) ji vždy
implementuje (kryje test). Property-arrow místo metody i kvůli `unbound-method` lintu
(controller si ji ukládá do lokálu kvůli zúžení optional). → zvaž `/mini:decision` před
`/mini:done`, ať je „proč" zaznamenané.

## Vizuál a tok ověřeny uživatelem
Prohlížečový e2e jsem sám nespustil (Vite proxy míří natvrdo na port 3000 s uživatelovým
běžícím dev stackem, cizí procesy jsem nezabíjel). Funkční řetězec je pokrytý testy
s reálným controllerem/board-view + server curl. Vizuál nápovědy, pocit z ~1,6s pauzy
a celý tok Výuky v prohlížeči OVĚŘIL uživatel (2026-07-06) → verify body vyřešeny.
