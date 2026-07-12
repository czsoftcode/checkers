---
phase: 108
verdict: done
steps:
  - title: "i18n: mnozny nadpis, modal, zmenit prezdivku (cs/en)"
    status: done
  - title: "Nick modal + auto-connect z LocalStorage"
    status: done
  - title: "Jedna stranka: predsin jako jediny pohled"
    status: done
  - title: "Prepnuti jazyka prezije spojeni"
    status: done
verify:
  - title: "Vizuál jedné vstupní stránky (2. snímek): nadpis, modal, akordeon, sólo"
    detail: "Ověřeno strukturálně + testy (628 zelených). Neověřeno okem: jak stránka vypadá v reálném layoutu (modal přezdívky přes celý viewport, tlačítko „Jsi přihlášen jako X / Přihlásit se ke hře s lidmi\" nad akordeonem, přepínač jazyka v modalu). Projdi hlavně na mobilu."
  - title: "Tok první návštěvy vs. návrat (auto-connect)"
    detail: "První návštěva (prázdný LocalStorage) → modal; zadání nicku → připojení. Návrat (uložený nick) → auto-connect bez modalu. Změna nicku klikem na „Jsi přihlášen jako X\". Nedá se ověřit bez reálného serveru/prohlížeče – projdi ručně."
  - title: "REVIZE goalu: modal místo inline inputu + zavíratelnost modalu"
    detail: "Goal 108 psal „input přezdívky místo Jsi tu jako X\"; diskuze to nahradila MODALEM (viz .mini/discuss/phase-108.md). Navíc: diskuze chtěla modal při prvním načtení NEzavíratelný, ale to by zavřelo cestu k „Hrát proti počítači\" (past pro solo-hráče). Rozhodl jsem modal udělat ZAVÍRATELNÝ + přidat trvalé tlačítko „Přihlásit se ke hře s lidmi\". Zvaž, jestli to sedí; pokud chceš zaznamenat proč, /mini:decision."
---

# Fáze 108 — report z auto session

## Co se udělalo
Sloučení úvodu a předsíně PvP lobby do JEDNÉ stránky (reverz form-first z fáze 106). Velký refaktor `createLobby` v `packages/web/src/lobby.ts`, klient-only (server ze 105 beze změny).

1. **i18n:** nadpis do množného (`lobby.title` „Herní místnosti"/„Game rooms"), nové klíče pro modal přezdívky (`nickModalTitle/Aria/SaveBtn/CancelBtn`, `changeNick`, `signIn`), „Jsi tu jako" → „Jsi přihlášen jako". Zrušené `lobby.joinBtn`/`lobby.disconnectBtn`.
2. **Modal přezdívky + auto-connect:** identita se zadává v modalu (reuse `.modal-overlay`/`.modal-dialog`, CSP-safe). Uložený nick v LocalStorage → AUTO-connect bez modalu; jinak modal. Obsazená přezdívka (nick-taken) i chyba nicku před připojením → do modalu. Přepínač jazyka je i v modalu (dosažitelný přes overlay).
3. **Jedna stránka:** zrušen `entry` formulář, tlačítko „Vstoupit do místnosti" i „Odpojit", oddělený connected pohled. „Jsi přihlášen jako X" je tlačítko → reotevře modal (změna nicku = odpojit starou + connect novou). Akordeon 4 místností je jediný pohled.
4. **Jazyk přežije spojení:** přepínač jazyka je vidět vždy; rebuild (`main.ts:showLobby`) se uloženým nickem sám auto-connectne, takže přepnutí jazyka nevyhodí z předsíně natrvalo.

## Odchylka od diskuze (rozhodl jsem sám, viz verify výše)
Diskuze chtěla modal při prvním načtení **NEzavíratelný** (brána identity). Nezávislý sub-agent (viz níže) správně upozornil, že to je PAST pro solo-hráče: nezavíratelný celoobrazovkový overlay překryje „Hrát proti počítači", takže nový hráč, který chce jen hrát proti AI, je nucen vymyslet PvP přezdívku. To přímo porušuje „solo se nesmí rozbít". **Řešení:** modal je zavíratelný (Zrušit/Esc/klik mimo), a nad akordeonem je VŽDY tlačítko „Přihlásit se ke hře s lidmi" (bez nicku) / „Jsi přihlášen jako X" (s nickem) jako cesta zpět k PvP. „Vstoupit" v nepřipojeném stavu neposílá naslepo `enter`, ale otevře modal přihlášení.

## Kontroly (mechanicky ověřeno)
- `pnpm typecheck` čistý, `pnpm lint` čistý, `pnpm -F @checkers/web build` OK.
- Testy: **629 passed**. `lobby.test.ts` kompletně přepsán na nový tok (brána identity, změna nicku, auto-connect, reconnect, akordeon, výzvy, herní most). `lobby-i18n.test.ts` a `i18n.test.ts` doladěny na nové texty.

## Nezávislý self-review (fáze sahá na connect/identity tok)
Pustil jsem sub-agenta s čerstvým kontextem. Našel 5 nálezů; opravil jsem je:
- **HIGH – sólo nedostupné za nezavíratelným modalem** → modal zavíratelný + „Přihlásit se" (viz výše).
- **MED-HIGH – onLobbies zavíral i dobrovolný modal změny nicku** (presence-broadcast uprostřed psaní) → `closeNickModal` z `onLobbies`/`onJoined` odstraněn (modal zavírá jen optimisticky `submitNick`); test se zuby.
- **LOW – test sóla neměl zuby / chybějící pokrytí** → přidány testy (sólo po zavření modalu, „Vstoupit" bez připojení, modal změny přežije snímek, chyba connectu při změně nicku).
- **LOW – zastaralý komentář v main.ts** → opraven.
- **LOW – chyba connectu při změně nicku zasekla „Připojuji…"** → routing chyby přepnut z `connectedOnce` (lifetime) na `connected` (živé spojení); test se zuby.

Po opravách pustil DRUHÉ kolo review (nezávislý agent, čerstvý kontext). Potvrdil opravy 1/2/4/5 a našel dvě nové drobnosti, obě opraveny:
- **LOW – po Esc/Zrušit na NEZDAŘENÉM connectu (nick-taken/chyba) zůstal lživý label „Jsi přihlášen jako X" + zaseklé „Připojuji…"** (vzniklo tím, že modal je nově vždy zavíratelný). Přidán `dismissNickModal`: uživatelské zavření bez připojení zahodí půlotevřený socket a vrátí čistý nepřihlášený stav (label „Přihlásit se…", hláška pryč). Test se zuby.
- **VERY LOW – modal změny nicku otevřený přesně při přijetí výzvy** by se přenesl do hry a zpět. `onChallengeAccepted` teď modal zavře.

Třetí kolo už jsem nepouštěl (změny byly malé a cílené, kryté testy).

## Pro člověka
Mechanicky ověřitelné ověřeno. Zbývá vizuál + ruční projití toku (viz `verify`). A rozvaha nad odchylkou od diskuze (zavíratelný modal + „Přihlásit se") – případně `/mini:decision`.
