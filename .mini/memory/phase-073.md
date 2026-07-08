# Phase 73 — Vzhled PvP herní obrazovky

**Goal:** Herní obrazovka partie dvou lidí dostane rozložení jako u hry s AI: ovládání (Zpět do místnosti + místo pro budoucí tlačítka) je nad deskou s TUČNOU přezdívkou soupeře vlevo oddělenou separátorem (bez řádku 'Hraješ za barvu' – barva je jasná z kamenů dole); kdo je na tahu ukazuje REÁLNÝ kámen black.webp/white.webp na boku desky (na změnu tahu se mění jen obrázek kamene, ne indikátor); na pozadí náhodný background_NN.webp; celek se VEJDE do viewportu, takže deska ani tlačítko nepřetékají pod okraj. Vědomě mimo řez: stejná úprava indikátoru u hry s AI (potom), vzdání/remíza (todo 40), odveta.

## Steps
- [done] Přestavba DOM a rozvržení game-screen.ts
- [done] Indikátor na tahu: reálný kámen + fallback
- [done] CSS pro PvP rozvržení a indikátor
- [done] Testy game-screen + ověření

## Auto-commit
- Phase 73: Vzhled PvP herní obrazovky

## Discussion
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

## Run report
---
phase: 73
verdict: done
steps:
  - title: "Přestavba DOM a rozvržení game-screen.ts"
    status: done
  - title: "Indikátor na tahu: reálný kámen + fallback"
    status: done
  - title: "CSS pro PvP rozvržení a indikátor"
    status: done
  - title: "Testy game-screen + ověření"
    status: done
verify:
  - title: "Vejde se celek do viewportu bez scrollu (desktop i mobil)?"
    detail: "Mechanicky ověřeno jen že se sdílí --board-size a třídy s AI obrazovkou (kde to platí). Skutečné 'deska ani tlačítko nepřetéká pod okraj' na různých výškách/šířkách a na <768px (indikátor pod deskou) musí potvrdit lidské oko v prohlížeči."
  - title: "Reálný kámen na boku desky a jeho výměna při změně tahu"
    detail: "Testy ověřují přepínání tříd .black/.white a zapnutí .pvp-turn--img přes fake Image. Že se black.webp/white.webp opravdu vykreslí (a je čitelný na náhodném pozadí) ověří člověk v běžícím klientovi."
  - title: "Náhodné pozadí background_NN.webp se ukáže"
    detail: "V testu je fetch/Image stubnutý; skutečné vykreslení pozadí přes .page-bg ověř v prohlížeči."
  - title: "Tučná přezdívka soupeře vlevo + oddělovač + tlačítko; dlouhá přezdívka se zalomí"
    detail: "V jsdom nejde číst computed style (tučnost, zalomení). Vizuál a chování dlouhé přezdívky (overflow-wrap/min-width:0) potvrď okem."
  - title: "Fallback kolečka je ČERNÉ/BÍLÉ (ne červené)"
    detail: "Fallback se v praxi spustí jen když webp selže (těžko vyvolatelné). Pokud chceš ověřit, dočasně přejmenuj black.webp/white.webp a zkontroluj, že indikátor ukáže černý/bílý disk, ne červený."
---

# Fáze 73 — report z auto session

## Co je hotové
PvP herní obrazovka (`game-screen.ts`) je překlopená do rozvržení sdíleného se hrou proti počítači:
- root `.game`, náhodné pozadí `.page-bg`, panel `.panel` s ovládáním nad deskou (tučná přezdívka soupeře vlevo `.pvp-opponent`, oddělovač `.controls-divider`, tlačítko „Zpět do místnosti"), deska v `.board-row`, stavový pruh `.status-bar` pod deskou;
- zrušen nadpis „Partie" i řádek „Hraješ za … · soupeř …";
- kdo je na tahu ukazuje **reálný kámen** na boku desky (`.pvp-turn` + `.pvp-turn-stone`); na změnu tahu se mění jen třída kamene, ne obal. Webp se zapíná třídou `.pvp-turn--img` až po ověřeném načtení obou obrázků (`preloadImages`), jinak platí CSS kolečko (černé/bílé — vědomě ne červené jako u desky);
- textová hláška „kdo je na tahu" je pryč; `.status-bar` nese už jen výsledek / ztrátu spojení / chybu tahu;
- mrtvé třídy `.game-screen`/`.game-card`/`.game-title`/`.game-line`/`.game-status`/`.game-error`/`.game-back-btn` odstraněny z CSS (žádná zbylá reference).

Sdílení `--board-size` a tříd s AI obrazovkou drží „vejde se do viewportu" na jednom místě (žádný druhý výpočet).

Mechanicky ověřeno: typecheck (celé repo), lint, `pnpm --filter @checkers/web test` (337 testů zelených, z toho nový `test/game-screen.test.ts`), produkční build (webp kameny i pozadí se zabalily).

## Na co jsem narazil (a opravil)
Nová testovací obrazovka odhalila **dvě reálné, dosud skryté chyby** na chybové cestě (`game-screen` neměl test, tak je nikdo nechytil):

1. **Chyba tahu se nikdy neukázala.** `pvp-controller.showError` volal `onError` (ukázat) a *pak* `emitStatus` → `renderStatus` začíná `hideMoveError()`, takže hlášku hned zase schoval. Opraveno prohozením pořadí: `emitStatus()` **před** `onError()`.

2. **Po ztrátě spojení mohla opožděná chyba tahu z (živého) room WS přepsat trvalou hlášku „Spojení se přerušilo, vrať se do místnosti"** a nechat desku zamčenou bez vysvětlení. Nález nezávislého sub-agenta (red-team). Opraveno guardem `if (disposed || connectionLost) return;` v `showError` + schováním indikátoru na tahu v `onClosed` (deska je mrtvá → nemá svítit „na tahu"). Obojí pokryto testy se zuby.

Nezávislý sub-agent (čerstvý kontext) potvrdil, že hlavní cesta oprav je správná, fallback kamene je dosažitelný v obou větvích a odstranění tříd nezanechalo reference.

## Poznámka
Přesunul jsem řádek v `pvp-controller.ts` (`showError`) — to je jiný soubor než jen `game-screen.ts`, ale byla to nutná oprava kontraktu onStatus/onError, který obrazovka reálně používá. Žádné rozhodnutí hodné ADR tu nepadlo (šlo o opravy bugů, ne o zvolený trade-off), takže `/mini:decision` podle mě netřeba.
