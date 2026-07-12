# Phase 108 — Lobby: jedna vstupní stránka s místnostmi

## Intent
Sloučit úvod a předsíň PvP lobby do JEDNÉ stránky (podle 2. snímku uživatele): nahoře „Jsi přihlášen jako
X" + přepínač jazyka, pod tím rovnou živý akordeon 4 místností (obsazenost + Vstoupit), dole „Hrát proti
počítači" (picker + tlačítko). Zrušit tlačítko „Vstoupit do místnosti", oddělený `entry` vs `joined`
pohled a tlačítko „Odpojit". Reverzuje form-first z fáze 106 (autor to v praxi shledal nepřehledným:
newcomer viděl prázdné pole na nick + neprůhledné „Vstoupit do místnosti" a netušil, kam kliknout pro hru
proti člověku). KLIENT-ONLY — `connect`/`enter`/předsíň ze serveru (fáze 105) už existují, jen se jinak
naaranžují.

## Key decisions
- **Zadání přezdívky = MODAL, ne inline input (REVIZE goalu — uživatel).** Goal fáze říká „input přezdívky
  místo Jsi tu jako X"; DISKUZE to nahradila modalem. Na stránce ZŮSTANE „Jsi přihlášen jako X" (jako 2.
  snímek). Přezdívka se zadává v modalu:
  - **První načtení** (žádná přezdívka v LocalStorage) → vyskočí modal pro nick. Po uložení: `connect{nick}`
    → počty se rozsvítí, stránka ukáže „Jsi přihlášen jako X".
  - **Další načtení** → nick z LocalStorage → AUTO `connect{nick}` rovnou, bez modalu, předsíň s živými počty.
  - Výhoda proti inline inputu: přezdívku máme VŽDY dřív než předsíň → odpadá „počty před nickem" (placeholder,
    tichý connect na blur, timing). `connect` je jedna jasná událost (uložení modalu). NESAHÁ na server.
- **Změna přezdívky = reotevřít modal.** Klik na „Jsi přihlášen jako X" (nebo odkaz „změnit přezdívku")
  otevře nick modal znovu. Nahrazuje „Odpojit" (to na jediné vstupní stránce nedávalo smysl). Uložení
  nového nicku = odpojit starou identitu + `connect` nové (zpět do předsíně). V rozehrané partii nedostupné.
- **Obsazená přezdívka (`nick-taken`) se řeší V MODALU.** `connect` vrátí `nick-taken` (i při auto-connectu
  z LocalStorage — např. dvě záložky se stejným nickem) → modal zůstane/znovu se otevře s návrhem, uživatel
  zvolí jiný. Modal je jediné místo pro validaci nicku (prázdný/dlouhý/obsazený).
- **Přepínač jazyka i DO modalu (nebo modal nesmí překrýt langSelect).** První ne-český návštěvník má modal
  přes celou stránku → langSelect vedle nadpisu je pod overlayem → musí být dosažitelný i z modalu.
  Přepínač jazyka jinak zůstává vedle nadpisu (dnešní chování).
- **Nadpis do množného čísla:** `lobby.title` „Herní místnost" → „Herní místnosti" (cs), „Game room" →
  „Game rooms" (en). i18n parita.
- **Akordeon je JEDINÝ pohled po připojení** (žádný switch mezi entry/joined). MOJE lobby (po `enter`) =
  „Vyzvat", ostatní „Vstoupit" (`enter` z předsíně / `switch-lobby` z členství — logika z fáze 106).
  „Hrát proti počítači" (AIvP `soloBtn` + picker) zůstává dole beze změny.

## Watch out for
- **Jazyk shodí spojení jen dočasně.** `langSelect` → `onLocaleChange` = rebuild celé lobby (dispose WS).
  Nová stránka se MUSÍ auto-`connect`nout uloženým nickem → spojení se obnoví, předsíň s živými počty se
  vrátí. Bez toho by přepnutí jazyka vyhodilo hráče z předsíně natrvalo.
- **Auto-connect po načtení je nové chování** (dnes form-first connectne až na submit). Edge: dvě záložky se
  stejným uloženým nickem → druhá dostane `nick-taken` → vyskočí modal (viz výš). Popsat/otestovat.
- **Modal má fokus/klávesnici/Esc jako výzva-modal z 106** — reuse `.modal-overlay`/`.modal-dialog`, CSP-safe,
  žádné inline styly. Ale: nick modal se NESMÍ dát zavřít bez zadání nicku při PRVNÍM načtení (jinak uvázneš
  na stránce bez identity a počty se nenačtou). Reotevřený (změna nicku) modal zavřít lze (Storno = nechat
  starý nick).
- **AIvP a itch varianta lobby se nesmí rozbít** — změna je jen PvP předsíň. `soloBtn`/picker a druhá
  `createLobby` (itch, ~ř. 891) beze změny.
- **Goal vs realita:** uložený cíl 108 zmiňuje „input přezdívky" — nahrazeno modalem (titulek sedí dál).
  Pokud se má formálně opravit i text cíle, přes `/mini:undo` + `/mini:next`; jinak platí tyto poznámky.
- **Sub-agent review PŘED reportem** (sahá na connect/identity tok klienta + auto-connect), viz CLAUDE.md.
