# Americká dáma - Checkers

## What I'm building
Klient-server hra americké dámy (English draughts) v prohlížeči, nově pro dva lidské hráče proti sobě přes web. Do jedné společné místnosti hráči vstupují pod přezdívkou, vidí přítomné a výzvou se spárují do partie; víc partií běží současně. Server zůstává jedinou autoritou nad pravidly a stavem - nepřijme nelegální tah od žádného hráče. AI engine zůstává jako volitelný soupeř a jako režim Výuka, není ale těžištěm této verze (v3).

## Who it's for
Dva lidští hráči americké dámy hrající proti sobě přes web; okruh hráčů si zajišťuje autor. AI soupeř zůstává jako volitelný režim, ne hlavní cíl.

## Approach
- Autorita: server je jediný zdroj pravdy, validuje KAŽDÝ tah (hráče i enginu) sdílenou knihovnou rules. Klient i engine jsou nedůvěryhodní.
- Pravidla jednou: knihovna rules (čistý TS, nulové I/O), sdílená serverem, klientem i enginem. Páteří testů je perft 1-6 + fixtures.
- Multiplayer (nové těžiště): jedna společná místnost, vstup pod přezdívkou (bez účtů). Hráč vidí přítomné, klikem na přezdívku pošle výzvu; po přijetí začne partie. Víc partií běží současně a nezávisle.
- Real-time (nové): soupeřův tah se doručí okamžitě (WebSocket/SSE) místo dosavadního čistě REST dotazování; server rozešle stav jen zúčastněné dvojici.
- Stav partie v paměti serveru: po krátkém výpadku klienta se hráč vrátí do rozehrané partie (reconnection). Restart serveru partie maže - vědomě žádná disková perzistence stavu partie. Nečinná/opuštěná partie se po timeoutu uvolní.
- Orientace desky: každý hráč vidí desku ze své strany (dnešní volba barvy a otočení se zachovává).
- AI jako vedlejší kolej: engine (negamax + alfa-beta + transpoziční tabulky, opening book, 3-move ballot, režim Výuka) zůstává jako volitelný soupeř a nápověda; ověřuje se stejnou serverovou cestou. Není cílem v3.
- PDN archiv dokončených partií zůstává (jednosměrný zápis na disk, nenačítá se zpět).
- Endgame databáze a Rust engine jsou mimo v3 (podmíněné, jen kdyby se AI stala prioritou); rozhodnutí z fáze 65 platí jako záznam, proč se endgame DB teď nestaví.

## Non-goals
- Nepřidávej účty, registraci ani hesla - hráč se identifikuje jen přezdívkou.
- Nepřidávej žebříčky, rating ani automatický matchmaking napříč hráči - párování je jen výzvou v místnosti.
- Nepřidávej šachové hodiny / časový limit na tah v této verzi (jen timeout nečinnosti jako pojistka proti zamrznuté partii).
- Nepřidávej diváky / sledování cizí partie v této verzi.
- Nepřidávej chat mezi hráči v této verzi.
- Nepřidávej diskovou perzistenci stavu partie - partie žijí v paměti serveru (výjimka: jednosměrný PDN archiv dokončených partií).
- Nestav endgame databázi ani Rust engine v této verzi (podmíněné, jen pokud se AI vrátí jako priorita).
- Nepřidávej undo.
- Nepřidávej in-app procházení ani analýzu odehraných partií (rozbor z PDN ve vnějším nástroji).
- Nepřidávej mobilní appku, PWA ani offline režim.
- Neměň variantu dámy - zůstáváme u americké.

## Success criteria
- Dva hráči se připojí do místnosti pod přezdívkou, vzájemně se vyzvou a odehrají kompletní partii proti sobě; tah jednoho se objeví druhému v reálném čase.
- Server je autorita: nepřijme nelegální tah od žádného z hráčů (ani od enginu).
- Víc partií běží současně a nezávisle; stav se doručí jen správné dvojici.
- Po krátkém výpadku sítě hráč naváže do rozehrané partie (v paměti serveru); restart serveru partie vědomě maže.
- Nabídka remízy i vzdání jdou druhému člověku (ne "AI rozhodne"); po konci lze začít novou partii.
- Nečinná/opuštěná partie se po timeoutu uvolní, aby neblokovala soupeře.
- AI zůstává funkční jako volitelný soupeř + Výuka, ověřená stejnou serverovou cestou.
- Perft 1-6 sedí; všechny testy z pastí (GDD 2.7) zelené.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Real-time vrstva pro multiplayer přes WebSocket (nejspíš @fastify/websocket), server zůstává autoritou. Node 24 je vědomé rozhodnutí (fáze 11, nález 10-1): repo na něm běželo od začátku (.nvmrc, engines >=24, CI) a Node 24 je aktivní LTS. Engine je TS; Rust engine je pozdější PODMÍNĚNÝ krok (jen když by AI byla priorita a TS engine nestačil), jako nativní podproces za stejným protokolem - žádný WASM.
