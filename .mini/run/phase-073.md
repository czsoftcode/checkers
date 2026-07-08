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
