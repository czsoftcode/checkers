# Phase 8 — Remízová pravidla a terminace

## Intent
Knihovna rules dostane vrstvu „stav partie" nad rámec jedné pozice, aby uměla detekovat remízy a garantovat terminaci každé partie. Dvě remízová pravidla:
- **80 půltahů bez pokroku:** 80 půltahů po sobě bez braní a bez tahu mužem (hýbou se jen dámy) = remíza. Čítač `pliesWithoutProgress` žije napříč tahy.
- **Trojí opakování:** stejné rozestavění + stejná strana na tahu potřetí = remíza. Potřebuje historii pozic.

Vznikne `GameState` (pozice + čítač + historie klíčů), funkce pro posun stavu po tahu a detekce výsledku vracející i `draw`. Stávající `gameResult(position)` zůstává (pozičně nikdy `draw` nevrátí); stavová varianta je nadstavba. Server a engine později staví na téhle vrstvě.

## Key decisions
- **Prohra má přednost před remízou** (rozhodl uživatel): když strana na tahu nemá legální tah a zároveň platí remízová podmínka (čítač 80 / opakování), platí prohra. Pořadí kontrol: nejdřív bez-tahu prohra, pak remízy.
- **Remíza se vyhlašuje automaticky a hned** – žádné „na žádost hráče". Jinak není garance terminace (random vs random v todo 11). Vědomý trade-off: hráč nedostane volbu hrát dál.
- **80 půltahů = pevná konstanta** v knihovně (odpovídá 40 tahům na stranu z oficiálních pravidel), žádná konfigurace.
- **Klíč pozice = deterministická textová serializace** (rozestavění všech 32 polí + strana na tahu). Žádný hash – bez rizika kolizí. V americké dámě pozice + strana na tahu plně určuje legální tahy (nic jako rošáda/en passant), klíč je tedy kompletní.
- **Historie opakování se čistí při pokroku:** po braní nebo tahu mužem se dřívější pozice už nikdy nemůže vrátit (kámen zmizel / muž jde jen vpřed), historie se zahazuje → zůstává krátká. Optimalizaci musí přibít test.
- **Reset čítače:** braní NEBO tah mužem (proměna je tah mužem, taky resetuje). Tah dámou bez braní čítač inkrementuje.
- GameState je immutable stejně jako Position (konzistence s applyMove, který vrací novou pozici).

## Watch out for
- `GameResult` typ se rozšíří o `'draw'` – zkontrolovat dopady na existující konzumenty typu (zatím jen testy).
- Trojí opakování počítá i první výskyt pozice (výchozí stav = 1. výskyt); pozice po posledním tahu musí být do historie započtena dřív, než se výsledek vyhodnotí.
- Test na to, že opakování „přes" braní/tah mužem se NEpočítá (historie vyčištěná).
- Reálné opakování nastává jen tahy dam – testovací pozice stavět s dámami.
- Garance terminace: test se seedovaným náhodným playoutem (random vs random) – každá partie musí skončit v omezeném počtu půltahů (hrubá mez: nejhorší případ desítky tisíc půltahů nehrozí, mez řádově tisíce).
