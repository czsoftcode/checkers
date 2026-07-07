# Phase 54 — Klient: dvě kola v Mistrovství

**Goal:** Po dohraném 1. kole na úrovni Mistrovství klient uloží ballotIndex partie do LocalStorage a automaticky spustí 2. kolo se stejným zahájením a otočenou barvou (střídání barvy už z fáze 52); po 2. kole se stav zápasu vynuluje a další partii musí člověk vyvolat tlačítkem Nová hra. Zahrnuje i plumbing: přidat ballotIndex do klientského GameDto + isGameDto validaci + rozšířit createGame, aby index posílal do POST /games (server ho od fáze 53 přijímá). UX rozhodnutí (kdy spustit 2. kolo vůči výsledkovému modalu, reload uprostřed zápasu, vzdání/Nová hra uprostřed, zámek úrovně championship mezi koly) se doladí v discuss.

## Steps
- [done] Plumbing: ballotIndex v GameDto + createGame
- [done] Stav zápasu + barvy podle kola v startNewGame
- [done] Terminální handler: owed 2. kolo, rozlišení vzdání, championship mimo flip
- [done] Auto-start 2. kola po zavření modalu
- [done] Testy se zuby + ověření unhappy path

## Auto-commit
- Phase 54: Klient: dvě kola v Mistrovství

## Discussion
# Phase 54 — Klient: dvě kola v Mistrovství

## Intent
Nad samostatnými partiemi postavit „zápas" na úrovni Mistrovství: 1. kolo se hraje s losovaným
ballotem, po jeho dohrání se AUTOMATICKY spustí 2. kolo se STEJNÝM zahájením a otočenou barvou; po
2. kole zápas končí a další partii vyvolá člověk tlačítkem „Nová hra". Vše žije v klientovi
(`app-shell.ts`); server od fáze 53 umí přijmout fixní `ballotIndex` v `POST /games`.

Plumbing (prerekvizita): klientský `GameDto` (server-client.ts) dnes nese jen `ballotMoves`, NE
`ballotIndex`. Přidat `ballotIndex?: number`, doplnit `isGameDto` validaci (číslo/undefined; přítomná
neplatná hodnota = drift → odmítnout, stejný vzor jako u humanColor), a rozšířit `createGame(level,
humanColor, ballotIndex?)` + jeho HTTP impl (request body), ať index posílá.

## Key decisions
- **1 — 2. kolo se spustí PO ZAVŘENÍ výsledkového modalu 1. kola.** Ne hned na terminálním stavu (to
  by přebilo modal „Vyhráli jste"). Hook: v cestě zavření modalu (modalCloseBtn / backdrop / Esc), když
  je „owed" 2. kolo, spustit `startNewGame`. Modal overlay stejně blokuje tlačítka pod ním, takže
  zavření modalu je jediná interakce → pak naskočí 2. kolo.
- **2 — Stav zápasu je JEN V PAMĚTI (JS proměnné v closure), NE v LocalStorage.** PŘEPISUJE znění cíle
  fáze („uloží ballotIndex do LocalStorage"). Reload (F5) uprostřed zápasu → stav se ztratí → appka
  založí čerstvé 1. kolo (nový losovaný ballot). Konzistentní s dneškem (reload i teď zahodí rozehranou
  partii, server ji drží v paměti a klient ji nenačítá). LocalStorage zůstává JEN pro střídání barvy
  (`checkers.nextColor`, fáze 52) — beze změny.
- **3 — Vzdání 1. kola ZRUŠÍ zápas (žádné 2. kolo).** POZOR na past: vzdání a regulérní prohra mají
  IDENTICKÝ výsledek (`black/white-wins` = člověk prohrál), server je nerozliší. Klient proto MUSÍ držet
  příznak „tento konec přišel vzdáním" (nastavit v obsluze `Vzdávám` / `yesBtn` → `controller.resign()`),
  a v terminální cestě: vzdání → zruš zápas (žádné owed 2. kolo); regulérní konec (výhra/prohra/remíza
  bez vzdání) → owed 2. kolo. Bez toho by prohrané 1. kolo spadlo do „zrušit" místo „hrát 2. kolo".
- **4 — Úroveň zamčená na Mistrovství po celý zápas.** Během zápasu (1. kolo start → 2. kolo konec /
  zrušení) drž `levelSelect` na `championship` a disabled. Technicky nutné: fixní `ballotIndex` mimo
  championship server odmítne 400 (fáze 53). Dnes je select po konci partie ENABLED (over=true) → mezi
  koly by šlo přepnout; owed-2.-kolo to musí přebít (select zamčený, dokud zápas běží). POZOR i na 2. kolo:
  člověk je bílý → táhne PRVNÍ → počáteční stav je „člověk na tahu" → `firstMoveMade` zůstane false a
  dnešní logika by select odemkla. Během `playingRoundTwo` proto select drž zamčený + championship
  BEZ ohledu na firstMoveMade. (V 1. kole je člověk černý → engine táhne první → firstMoveMade se
  latchne hned, takže tam se select zamkne sám jako dnes.)

- **5 — Barvy jsou FIXNÍ podle kola u Mistrovství (NE volná alternace fáze 52).** 1. kolo člověk ČERNÝ,
  2. kolo BÍLÝ; každý zápas Mistrovství začíná černou. Nezávislé na `nextColor`.
  - Důsledek ballotu: po něm je na tahu bílý. Takže 1. kolo (člověk černý) → ENGINE táhne první (= dnešní
    default Mistrovství); 2. kolo (člověk bílý) → ČLOVĚK táhne první. Člověk tedy „začíná" 2. kolo, ne 1.
  - Proč fixně a ne přes `nextColor`: „každý zápas začíná černou" nejde zaručit alternací, když hráč
    prokládá jiné úrovně (parita sdíleného `checkers.nextColor` se rozjede → zápas by začal bílou). Pin
    per kolo = deterministické a čistě řeší i zrušení vzdáním (příští zápas zase černá).
  - Championship se z alternace VYJME: `startNewGame` pro championship pošle humanColor podle kola
    (round 1 → 'black', round 2 → 'white'), NEčte `nextColor`. A terminální překlopení `nextColor`
    (fáze 52) se pro championship NEPROVEDE (jinak by rozhodilo paritu ostatních úrovní). Alternace
    `nextColor` zůstává beze změny pro NE-Mistrovství úrovně.

## Watch out for
- **Barvy u Mistrovství NEjdou z `nextColor` — jsou round-based (viz rozhodnutí 5).** `startNewGame`
  pro championship pošle 'black' (1. kolo) / 'white' (2. kolo) podle stavu zápasu, ne z alternace. Pro
  ostatní úrovně `nextColor` beze změny. Fáze 52 flip v render() obal podmínkou „jen když level !==
  championship".
- **Stavový automat (návrh pro plan):** dvě proměnné v closure, např. `matchBallotIndex: number | null`
  (owed 2. kolo, když ≠ null) a `playingRoundTwo: boolean` (aktuální partie je 2. kolo). startNewGame:
  když `matchBallotIndex ≠ null` → to je 2. kolo (pošli ten index + humanColor='white', nastav
  `playingRoundTwo=true`, index vynuluj = spotřebován); championship jinak → 1. kolo (žádný index,
  humanColor='black', `playingRoundTwo=false`). Terminální handler (reálný výsledek, ne error):
  championship AND NOT `playingRoundTwo` AND NOT vzdáno → `matchBallotIndex = game.ballotIndex` (owed) →
  auto-start na zavření modalu. Když `playingRoundTwo` nebo vzdáno → nic (zápas končí / zrušen).
- **`game.ballotIndex` u 1. kola je vždy číslo** (championship losuje, server ho posílá od fáze 47).
  Defenzivně: kdyby přišel null/undefined (drift), zápas gracefully NErozjížděj do 2. kola (chová se
  jako jednotlivá partie), ne spadni.
- **Error (pád enginu) NENÍ dohrané kolo** — stejně jako u střídání barvy (gate `result !== 'ongoing'`
  vylučuje `key === 'error'`). Owed 2. kolo se na erroru nenastavuje.
- **Non-championship a jednotlivé partie beze změny.** `ballotIndex` se nikdy neposílá mimo Mistrovství;
  Profesionál/Pokročilý/Začátečník/Výuka se chovají přesně jako dnes (jedna partie, střídání barvy).
- **Auto-start vs. ostatní volání closeModal.** closeModal volá i `startNewGame` (reset) a klávesa Esc.
  Auto-start 2. kola napojit tak, aby vystřelil JEN na uživatelské zavření modalu s owed 2. kolem, ne
  rekurzivně z resetu uvnitř startNewGame.
- **Testy se zuby (server-independent, fake klient):** (a) 1. kolo championship (člověk 'black') dohráno
  výhrou/prohrou/remízou → po zavření modalu auto spustí 2. kolo se STEJNÝM ballotIndex a člověkem
  'white'; (b) 2. kolo dohráno → žádné 3. kolo, „Nová hra" potřebuje klik; (c) vzdání 1. kola → žádné
  2. kolo (a pozor: výsledek je stejný jako prohra → test musí ověřit, že rozlišení jede přes příznak
  vzdání, ne přes result); (d) non-championship → žádný zápas, žádný ballotIndex v požadavku, `nextColor`
  alternace beze změny; (e) každý championship zápas začíná 'black' i po prokládané ne-championship hře
  (parita ostatních úrovní nerozhodí round-1 barvu); (f) plumbing: createGame posílá ballotIndex do body
  jen když je zadán, isGameDto přijme číslo i chybějící pole a odmítne nesmysl. Zub: kdyby auto-start
  poslal jiný/žádný index nebo špatnou barvu, test padne (fake klient zaznamená argumenty createGame).

## Run report
---
phase: 54
verdict: done
steps:
  - title: "Plumbing: ballotIndex v GameDto + createGame"
    status: done
  - title: "Stav zápasu + barvy podle kola v startNewGame"
    status: done
  - title: "Terminální handler: owed 2. kolo, rozlišení vzdání, championship mimo flip"
    status: done
  - title: "Auto-start 2. kola po zavření modalu"
    status: done
  - title: "Testy se zuby + ověření unhappy path"
    status: done
verify:
  - title: "Odehrát reálný zápas 2 kol v prohlížeči (Mistrovství)"
    detail: "Testy jsou server-independent (fake klient). Ověřeno mechanicky: argumenty createGame, barvy, auto-start, zámek úrovně. Lidským okem stojí za kontrolu skutečný průběh proti běžícímu serveru+enginu: 1. kolo (člověk černý, engine otevírá) → výsledkový modal → po zavření 2. kolo se STEJNÝM zahájením a člověkem bílým (člověk táhne první) → po 2. kole stop, další partie až na Nová hra. A že animace ballotu 2. kola i zvuky sedí."
---

# Phase 54 — report z auto session

## Co je hotové
Klient staví nad partiemi „zápas 2 kol" na úrovni Mistrovství. Vše ověřeno mechanicky (typecheck všech balíčků, 919 testů napříč repem zelených, lint čistý).

**Plumbing (`server-client.ts`):** `GameDto` má nové `ballotIndex?: number | null`; `isGameDto` ho validuje (nezáporné celé / null / chybějící OK, jiné = drift → odmítne); `createGame(level, humanColor, ballotIndex?)` posílá index do těla POST /games JEN když je zadán (0 se pošle korektně — podmínka `=== undefined`, ne truthy).

**Stavový automat + barvy (`app-shell.ts`):** stav zápasu jen v paměti (`matchBallotIndex`, `playingRoundTwo`, `currentIsChampionship`, `currentBallotIndex`, `resignedThisGame`). Barvy u Mistrovství FIXNÍ podle kola (1. kolo černá = engine otevírá, 2. kolo bílá = člověk táhne první), nezávisle na alternaci `nextColor` (ta zůstává jen pro ostatní úrovně). 2. kolo se spustí AUTO po zavření výsledkového modalu 1. kola (`closeModalByUser`). Vzdání 1. kola zápas zruší. Úroveň zamčená na Mistrovství po celý zápas (i ve 2. kole, kde firstMoveMade sám neuzamkne).

## Nezávislý self-review — 1 potvrzený nález OPRAVEN + 2 okrajové
Sub-agent (čerstvý kontext) našel **reálnou tichou chybu na unhappy path**:

- **Nález 1 (CONFIRMED, opraveno):** `resignedThisGame` se nastavoval optimisticky při kliknutí na Vzdávám, ale `controller.resign()` byl fire-and-forget `void`. Když vzdání selže (síť → `resync` vrátí partii na ongoing) a hráč 1. kolo pak dohraje REGULÉRNĚ, příznak zůstal viset → regulérní konec se vyhodnotil jako vzdání a zápas se omylem zrušil (2. kolo nenaskočilo). **Oprava:** `resign()` přijímá volitelný callback s výsledkem (`didResign`); app-shell příznak sundá, když vzdání neproběhlo. Zvolil jsem callback místo `Promise<boolean>` návratu záměrně — return by u existujících `controller.resign();` v ~6 controller testech vyvolal lint `no-floating-promises` (zbytečný churn). Přidán cílený test se zuby (selhané vzdání → callback(false) → regulérní konec spustí 2. kolo); ověřeno, že bez opravy padá.
- **Nález 2 (okrajové, opraveno):** `refreshControls()` běžel v `render()` PŘED nastavením `matchBallotIndex` v terminální větvi → mezi koly byl za otevřeným modalem výběr úrovně krátce odemčený (klávesnicí dosažitelný). Přesunut na konec `render()`.
- **Nález 3 (okrajové, opraveno):** selhání `createGame` 2. kola nechávalo `playingRoundTwo=true` (viselý zámek úrovně). `catch` v `startNewGame` teď stav zápasu vyčistí.

Sub-agent potvrdil bez nálezu: plumbing ballotIndex (0/NaN/Infinity/null/chybějící správně), barvy (championship nikdy nesahá na nextColor, 1. kolo vždy černá), žádná rekurze/dvojí 2. kolo, error nespouští kolo, disposed guard proti zombie controlleru.

## Testy se zuby (ověřeno reálným rozbitím)
Cílené breaky → padne správný test, po revertu zelené: (a) championship bere barvu z alternace → „začíná ČERNOU" padne; (b) ignorace příznaku vzdání → „vzdání zruší zápas" padne; (c) callback nesundá příznak → „selhané vzdání" padne. Pokryto: auto-start 2. kola (stejný index, bílá), žádné 3. kolo, vzdání ruší, non-championship beze změny, championship začíná černou i po prokládané hře, zámek úrovně ve 2. kole, dispose bez zombie, plumbing (createGame body, isGameDto drift).

## Mimo rozsah (dle discuss)
Reload zápas nedrží (jen v paměti — rozhodnutí discuss). Cíl fáze zmiňoval LocalStorage, ale rozhodnutí bylo in-memory (viz `.mini/discuss/phase-054.md`).
