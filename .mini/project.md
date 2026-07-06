# Americká dáma - Checkers

## What I'm building
Klient-server hra americké dámy (English draughts) v prohlížeči: člověk vs. AI engine. Server je jediná autorita nad pravidly a stavem partie; engine je vyměnitelný proces za stabilním protokolem. Vedle soutěžní hry stojí samostatný režim Výuka, kde engine hráči na vyžádání radí tahy; do běžící soutěžní partie se nezapíná. Verze v2 cílí na jediné: prolomit remízovost proti špičkovému hráči.

## Who it's for
Silný hráč americké dámy (autorův tchán), hrající na vysoké úrovni.

## Approach
- Referenční architektura: dama_klient_server_architektura.svg (prohlížeč - REST - server - stdio - engine; rules sdílí všechny; diagram platí pro TS engine).
- Autorita: server je jediný zdroj pravdy, validuje každý tah včetně tahů enginu. Engine je nedůvěryhodný; jeho výstup se ověřuje stejnou cestou jako tah hráče.
- Pravidla jednou: samostatná knihovna rules (čistý TS, nulové I/O), sdílená serverem (validace), klientem (zvýraznění tahů) i TS enginem. Páteří testů je perft 1-6 + fixtures.
- Engine jako oddělený proces za JSON Lines protokolem (stdin/stdout). Negamax + alfa-beta + iterativní prohlubování. Poziční evaluace (mobilita, dvojitý roh, zadní řada), transpoziční tabulky a Zobrist jsou už v produkci (fáze 16-17).
- Kalibrace síly: engine má silnému hráči VZDOROVAT - vynutit remízu v dobrých pozicích a trestat chyby, ne "vždy vyhrát" (americká dáma je při bezchybné hře remíza).
- v2 = prolomit remízovost třemi konkrétními pákami síly (nic jiného "silnějším enginem" nemyslíme):
  - 3-move ballot / vynucené zahájení (úroveň Mistrovství): server vylosuje z kurátorovaného decku a nasadí ho jako povinné zahájení. Čistá vrstva v rules je hotová (fáze 46); los a nasazení patří do serverové fáze.
  - Opening book pro soutěžní hru: engine hraje známá zahájení z knihy místo vlastního hledání.
  - Endgame databáze: read-only lookup tabulka koncovek. NENÍ to perzistence stavu partie (ta zůstává v paměti serveru) - je to statická znalostní data. Nejtěžší kus v2; rozsah (počet kamenů, velikost, generovaná vs. externí data) se rozhodne v konkrétní fázi.
- Volba barvy: člověk si zvolí, zda hraje bílé nebo černé; AI dostane druhou barvu a deska se orientuje podle člověka.
- Režim Výuka (samostatný, mimo soutěžní hru): engine hráči na vyžádání ukáže doporučený tah stejnou autoritativní cestou serveru; nezapíná se uprostřed soutěžní partie, takže kalibrace "vzdorovat" zůstává čistá.
- Archiv partií (server): dokončené partie server zapíše na disk jako <id>.pdn (adresář přes CHECKERS_PDN_DIR, výchozí .pdn/ v rootu repa). Jednosměrné best-effort pro rozbor ve vnějším nástroji - zpět do hry se nenačítá, server zůstává autoritou.
- Milníky v závazném pořadí: M0 kostra repa - M1 knihovna pravidel - M2 CLI hra - M3 TS engine - M4 server - M5 web klient - M6 hardening + případný Rust engine. v2 (ballot, opening book, endgame DB, volba barvy) navazuje po M6.

## Non-goals
- Nepřidávej undo v této verzi.
- Nepřidávej in-app procházení ani analýzu odehraných partií v této verzi. (Rozbor se dělá z exportovaného PDN ve vnějším nástroji.)
- Nepřidávej multiplayer, účty, žebříčky ani matchmaking v této verzi. (Vědomě otevřený směr do budoucna - autoritativní server ho neblokuje, ale teď se nestaví.)
- Nepřidávej DB perzistenci stavu partie - partie žijí v paměti serveru. Výjimky, které tohle pravidlo NEPORUŠUJÍ: jednosměrný PDN archiv dokončených partií (zápis na disk, nenačítá se zpět) a read-only endgame databáze (statická lookup data, ne stav partie).
- Nepřidávej mobilní appku, PWA ani offline režim.
- Neměň variantu dámy (frízská, mezinárodní, ruská, turecká) - zůstáváme u americké.

## Success criteria
- Člověk odehraje v prohlížeči kompletní partii proti enginu; engine táhne do limitu; server nepřijme žádný nelegální tah (ani od enginu); pád enginu partii neshodí.
- Hráč si před partií zvolí barvu; AI hraje druhou a deska je orientovaná podle člověka.
- Na úrovni Mistrovství server vylosuje 3-move ballot a nasadí ho jako vynucené zahájení; každý nasazený ballot je legální ověřenou serverovou cestou.
- Engine v soutěžní hře používá opening book a v koncovkách endgame databázi; proti silné hře vzdoruje (remízuje dobré pozice, trestá chyby) a nikdy nepřekročí tvrdý timeout.
- V režimu Výuka dostane hráč doporučený tah ověřený stejnou serverovou cestou; v soutěžní partii se žádná nápověda neobjeví.
- Perft 1-6 sedí proti nezávislému zdroji; všechny testy z pastí (GDD 2.7) zelené.
- TS a (případný) Rust engine jsou prohoditelné konfigurací serveru, přibité stejným perftem a fixtures.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Node 24 je vědomé rozhodnutí (fáze 11, nález 10-1): repo na něm běželo od začátku (.nvmrc, engines >=24, CI) a Node 24 je aktivní LTS; dokument se srovnal s realitou místo downgrade. Engine se píše nejdřív v TS; Rust engine je pozdější PODMÍNĚNÝ krok (jen když TS engine nedosáhne na cíl síly), jako nativní podproces za stejným protokolem - žádný WASM.
