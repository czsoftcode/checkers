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
