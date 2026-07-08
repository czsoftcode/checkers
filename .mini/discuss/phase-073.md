# Phase 73 — Vzhled PvP herní obrazovky

## Intent
Překlopit PvP herní obrazovku (`game-screen.ts` + CSS `.game-screen`/`.game-card`)
do stejného rozvržení jako hra s AI (`app-shell.ts`):
- panel s ovládáním NAD deskou; vlevo TUČNÁ přezdívka soupeře, svislý oddělovač,
  pak „Zpět do místnosti" a místo pro budoucí tlačítka (vzdát/remíza později),
- zmizí nadpis „Partie" (h1) i řádek „Hraješ za … · soupeř …" (barva je jasná
  z vlastních kamenů dole),
- kdo je na tahu ukazuje REÁLNÝ kámen (`black.webp`/`white.webp`) na boku desky,
- náhodné pozadí `background_NN.webp`,
- celek se vejde do viewportu (deska ani tlačítka nepřetečou).

## Key decisions
- **Znovupoužít** třídy `.game`, `.panel`, `.board-row`, `.status-bar` a globální
  `--board-size` z AI obrazovky. NEpsát druhou sadu CSS ani druhý výpočet velikosti
  desky – jinak riziko rozjetí dvou čísel a přetečení. Staré třídy `.game-screen`,
  `.game-card`, `.game-title`, `.game-line`, `.game-back-btn` po přechodu odstranit
  (stanou se mrtvými).
- **Zarovnání vlevo nahoře** jako AI (ne dnešní vycentrování). Root prvek dostane
  třídu `.game` a sedí přímo v `body` (body je flex kontejner, `align-items:stretch`,
  `justify-content:flex-start`) – stejně jako AI shell.
- **Indikátor na tahu = SAMOTNÝ reálný kámen bez prstence** (ne AI kolečko
  `.turn-indicator .piece` s hnědým prstencem). Nový prvek/třídy, ne 1:1 kopie AI.
  Fáze počítá, že AI indikátor se sjednotí AŽ POTOM (mimo řez).
- **Čí je tah ukazuje POUZE kámen**, žádná textová hláška „Jsi na tahu / Na tahu je
  soupeř". Textový status řádek pod deskou proto nese už jen: výsledek
  (Vyhrál/Prohrál/Remíza), hlášku o ztrátě spojení a chybu odmítnutého tahu.
- **Fallback kamene:** primárně `<img>` s webp; když se webp nenačte, spadnout na
  PROSTÉ CSS kolečko ČERNÉ/BÍLÉ podle strany na tahu (žádná červená, žádný prstenec).
  Konzistentní s deskou (ta zapíná webp jen po ověřeném načtení – viz `piece-images.ts`
  / `image-preload.ts`).
- **Pozadí** vylosovat jednou při vzniku obrazovky přes `pickBackground(backgroundUrls,
  Math.random)` (uvnitř PvP obrazovky se „nová hra" neděje – nová partie = nová výzva =
  nová obrazovka), přes `<img class="page-bg">` (atribut `src`, ne inline styl – CSP).
- **Indikátor: měnit se má JEN vzhled kamene, ne obal.** Kontejner indikátoru
  persistuje, na změnu tahu se přepne jen `src` (webp) resp. barva CSS kolečka
  (fallback). Viditelný jen za běhu partie (`result === 'ongoing'`), skrytý před
  prvním stavem i po konci – mirror AI `updateTurnIndicator`.

## Watch out for
- **Přístupnost:** když „čí je tah" ukazuje jen kámen (žádný text), čtečka nemá jak
  stav zjistit. Přidat na indikátor neviditelný `aria-label` „Na tahu: ty / soupeř",
  ať se informace neztratí.
- **Dlouhá přezdívka soupeře** v panelu (šířka `--board-size`) může tlačit tlačítko
  nebo přetéct – `.controls` má `flex-wrap`, ale nick potřebuje `overflow-wrap` /
  `min-width:0`, ať se zalomí místo přetečení panelu.
- **Rezerva výšky** `--board-size` (`98vh − 7.5rem`) je vyladěná na výšku AI panelu.
  PvP panel (nick + jedna řada tlačítek) je podobný/nižší → vejde se; `.status-bar`
  s `flex:1` absorbuje slack. Až přibudou tlačítka (vzdát/remíza), výšku panelu znovu
  ověřit.
- **Testy `game-screen`/`pvp-controller`:** přechod nesmí rozbít stávající testy;
  přidání `pageBg` (Math.random) v jsdom je neškodné. Ověřit, že testy nesahají na
  odstraněné třídy/nadpis.
- **Mobil (`@media max-width:768px`):** znovupoužití `.board-row` dá indikátor pod
  desku a responzivní chování zdarma; nový bare-stone indikátor musí mít vlastní
  velikost (přes `--square`/`--piece-scale`) i mobilní odsazení (`margin-top`).
- **Vědomě mimo řez:** stejná úprava AI indikátoru (potom), vzdání/remíza (todo 40),
  odveta.
