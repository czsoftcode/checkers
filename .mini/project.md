# Americká dáma - Checkers

## What I'm building
Klient-server hra americké dámy (English draughts) v prohlížeči: člověk vs. AI engine. Server je jediná autorita nad pravidly a stavem partie; engine je vyměnitelný proces za stabilním protokolem.

## Who it's for
Silný hráč americké dámy (autorův tchán), hrající na vysoké úrovni.

## Approach
- Referenční architektura: dama_klient_server_architektura.svg (prohlížeč - REST - server - stdio - engine; rules sdílí všechny; diagram platí pro TS engine).
- Autorita: server je jediný zdroj pravdy, validuje každý tah včetně tahů enginu. Engine je nedůvěryhodný; jeho výstup se ověřuje stejnou cestou jako tah hráče.
- Pravidla jednou: samostatná knihovna rules (čistý TS, nulové I/O), sdílená serverem (validace), klientem (zvýraznění tahů) i TS enginem. Páteří testů je perft 1-6 + fixtures.
- Engine jako oddělený proces za JSON Lines protokolem (stdin/stdout). Negamax + alfa-beta + iterativní prohlubování. Nejdřív TS (sdílí rules = jeden zdroj); případný pozdější Rust engine má vlastní generátor pravidel přibitý stejným perftem + fixtures (řízená duplicita).
- Kalibrace síly (i): engine má silnému hráči VZDOROVAT - vynutit remízu v dobrých pozicích a trestat chyby, ne "vždy vyhrát" (americká dáma je při bezchybné hře remíza). Kvůli tomu se do v1 tahá silnější poziční evaluace (mobilita, dvojitý roh, zadní řada) a transpoziční tabulky + Zobrist - v GDD řazené do v2/M6.
- Archiv partií (klient, M5): dokončené partie se ukládají do LocalStorage v PDN; tlačítko Export je stáhne najednou jako jeden .pdn soubor pro rozbor ve vnějším nástroji. Klientské pohodlí, ne zdroj pravdy - server zůstává autoritou, zpět do hry se nenačítá.
- Milníky v závazném pořadí: M0 kostra repa - M1 knihovna pravidel (těžiště) - M2 CLI hra - M3 TS engine - M4 server - M5 web klient - M6 hardening + případný Rust engine.

## Non-goals
- Nepřidávej multiplayer, účty, žebříčky ani matchmaking v této verzi. (Vědomě otevřený směr do budoucna - autoritativní server ho neblokuje, ale teď se nestaví.)
- Nepřidávej perzistenci do databáze - partie žijí v paměti serveru. Klientský PDN archiv v LocalStorage + export je jediná výjimka (jednosměrná, nenačítá se zpět).
- Nepřidávej endgame databázi v této verzi. (Kandidát do v2. Bez ní engine profíka v koncovkách neudrží; vědomé odložení, ne opomenutí.)
- Nepřidávej opening book, undo ani in-app procházení/analýzu partií (v2). Nápověda tahů od enginu taky ne.
- Nepřidávej mobilní appku, PWA ani offline režim.
- Nepřidávej 3-move ballot / vynucené zahájení v této verzi. (Kandidát do v2 - nejlevnější způsob, jak prolomit remízovost proti špičkovému hráči.)
- Neměň variantu dámy (frízská, mezinárodní, ruská, turecká) - zůstáváme u americké.

## Success criteria
- Člověk odehraje v prohlížeči kompletní partii proti enginu; engine táhne do limitu; server nepřijme žádný nelegální tah (ani od enginu); pád enginu partii neshodí.
- Perft 1-6 sedí proti nezávislému zdroji; všechny testy z pastí (GDD 2.7) zelené.
- Engine dle kalibrace (i): proti silné hře vzdoruje (remízuje dobré pozice, trestá chyby) a nikdy nepřekročí tvrdý timeout.
- TS a (případný) Rust engine jsou prohoditelné konfigurací serveru, přibité stejným perftem a fixtures.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Node 24 je vědomé rozhodnutí (fáze 11, nález 10-1): repo na něm běželo od začátku (.nvmrc, engines >=24, CI) a Node 24 je aktivní LTS; dokument se srovnal s realitou místo downgrade. Engine se píše nejdřív v TS; Rust engine je pozdější PODMÍNĚNÝ krok (jen když TS engine nedosáhne na cíl síly), jako nativní podproces za stejným protokolem - žádný WASM.
