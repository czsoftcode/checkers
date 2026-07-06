# Phase 42 — Drag & drop kamenů

## Intent
Přidat tažení kamenů (drag & drop) jako alternativu k dnešnímu klikacímu ovládání.
Chování: pointer down na vlastní pohyblivý kámen ho zvedne a zvětší; kámen následuje
kurzor/prst; puštění na legální pole tah provede; puštění jinam kámen animovaně vrátí
na výchozí pole a zmenší zpět. Při provedení tahu tažením zní jen zvuk dopadu (`land`),
NE zvuk rozjezdu (`move`). Klikací (tap) ovládání zůstává plně funkční.

Motivace: komfort UX. Mobil je nejistý (autor si vyzkouší v reálu), proto se tap
zachovává jako záloha.

## Key decisions
- **Vícenásobný skok podporuje OBA způsoby** (autorovo přání), sjednoceno přes
  „vyhodnocení až v místě puštění", bez sledování kudy prst jede:
  - Puštění na první přeskočené pole (meziskok) → potvrdí se jeden hop, kámen tam
    zůstane, sekvence pokračuje (dá se zvednout znovu nebo doťukat tapem). = hop po hopu.
  - Puštění rovnou na koncové pole celého braní → klient dohledá celý legální řetěz
    skoků z `from`, jehož FINÁLNÍ dopad == pole puštění a jehož `path` začíná aktuální
    předponou, a pošle ho celý. = souvislé tažení bez meziupuštění.
  - Puštění jinam → animovaný návrat + zmenšení.
  - Sebrané kameny u souvislého tažení mizí až při puštění (ne postupně cestou) —
    vědomý kompromis za jednoduchost a menší křehkost.
- **Zvednutí hned při pointer down**, bez prodlevy na přidržení. „Podržím" = držet
  během přesunu.
- **Tap zůstává**: pointer down+up na stejném poli bez pohybu (pod prahem) = dnešní
  klikací výběr/tah. Ovládání se přepíše na Pointer Events (myš i dotyk jednotně),
  aby se tap a drag nervaly; oddělený `click` listener v board-view se nahradí, ať
  se nespouští dvakrát. Musí zůstat: `player.unlock()` na uživatelské gesto,
  `null` při zásahu světlého pole / mimo desku.
- **Mobil**: kamenům `touch-action: none`, aby tažení nescrollovalo stránku (scroll
  půjde jen z prázdné plochy). Reálné chování ověří autor ručně.
- **Jeden drag = jeden hop** platí i nadále na úrovni potvrzování hopů; „souvislé
  tažení" je jen zkratka, kdy se při puštění doplní celá cesta najednou.

## Watch out for
- **NEJVĚTŠÍ RIZIKO — dvojitá animace + zvuk při potvrzení serverem.** Dnes se kámen
  během tahu vizuálně nehne, dokud tah nepotvrdí server; teprve `applyServerState`
  → `render` → `diffMove` → `startAnimation` ho rozanimuje (sklouznutí `from→to`)
  a přehraje zvuky `move` + `land`. U dragu už kámen přesune ruka, takže potvrzovací
  render NESMÍ přehrát sklouznutí ani `move`; má jen usadit kámen na cíl, nechat
  zmizet (fade) sebrané kameny a přehrát pouze `land` (nebo nic, když `land` zazněl
  už při puštění). Je potřeba EXPLICITNÍ signál z controlleru do board-view
  („tento update je potvrzení tahu, který uživatel provedl rukou → usadit natvrdo,
  bez sklouznutí, bez `move`"). NESPOLÉHAT na náhodu typu „mover element chybí, tak
  spadne do instant()" — to je křehké a checklist (tichý předpoklad) to zachytí.
- **Vizuální konzistence in-progress braní.** Dnes `advance()` při rozpracovaném
  víceskoku nechává kámen vizuálně na výchozím poli `from` a jen zvýrazňuje cestu.
  Pro drag „hop po hopu" musí kámen po puštění zůstat na posledním potvrzeném poli,
  jinak by po puštění „odletěl" zpět na start. To znamená sladit vykreslení
  rozpracované sekvence pro tap i drag (kámen na posledním dopadu, ne na `from`),
  aby se obě ovládání nechovala rozdílně. Zásah do dnešní accumulation logiky.
- **Rozlišení tap vs. drag** prahem pohybu (v px). Moc malý práh = omylem drag při
  ťuknutí (hlavně dotyk); moc velký = drobné tažení se bere jako tap. Zvolit rozumný
  práh a otestovat logiku.
- **Hit-testing pole pod prstem/kurzorem při puštění** (prst pole zakrývá) —
  `document.elementFromPoint` nebo výpočet z `getBoundingClientRect`. Deska je
  otočená o 180° (fáze 38), ale souřadnice se počítají z reálných rectů, takže to
  drží; přesto ověřit, že správné pole vychází i po otočení.
- **Nejednoznačné větvení** u „souvislého tažení": kdyby z `from` vedly na stejné
  koncové pole dva různé řetězce (jiná sebraná pole), je puštění na endpoint
  nejednoznačné. Vzácné; fallback: vzít jen první hop (chovat se jako hop po hopu).
- **Legalitu vždy ověřuje server.** Klientský výběr/řetěz je jen UX; drop resolver
  smí posílat jen to, co `rules`/`legalMoves` označí za legální. Nelegální drop se
  nikdy neposílá — jen vrátí kámen.
- **Testy**: jsdom nemá layout ani `PointerEvent`, plynulé tažení a hit-test podle
  rectů nejde plně otestovat automaticky. Pokrýt testy logiku (drop resolver: výběr,
  hop po hopu, dohledání celého řetězce k endpointu, nelegální drop → návrat, tap
  fallback, potlačení re-animace); samotný vizuál (zvednutí, plynulý pohyb, návrat,
  zmenšení) ověří autor ručně přes `verify`.
- **Zvuk při návratu**: neúspěšné puštění (kámen se vrací) NEMÁ přehrát `land` —
  nikam nedopadl. `land` jen při reálném provedení tahu tažením.
