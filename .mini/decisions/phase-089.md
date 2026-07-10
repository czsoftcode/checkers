# Itch gating: early-return do createItchEntry místo inline vypnutí room clienta

## Decision
V itch módu createLobby hned na začátku dělá early-return do samostatné funkce createItchEntry, která staví kompaktní vstup (pozadí, karta, nadpis, přepínač jazyka, "Hrát proti počítači" + "Hrát s člověkem" -> modal) a createRoomClient vůbec nevolá. PvP větev createLobby zůstala netknutá.

## Why
Alternativa - podmíněně vypnout createRoomClient uvnitř stávající 600řádkové createLobby (blíž doslovnému "surgical" z diskuse) - byla zamítnuta: room client je propletený desítkami closures (GameLink, výzvy, remíza, odveta) a jeho gating by znamenal room_client?. guardy skrz celou funkci -> vysoké riziko regrese živé PvP cesty kvůli buildu, který PvP ani nepoužívá. Early-return dává tvrdou jistotu, že v itch větvi room WS nemůže vzniknout (nevolá se factory), a nechává PvP kód beze změny. Cena: ~40 řádků duplikace chrome (pozadí + hlavička). Vizuálně to samostatná obrazovka není - vypadá jako lobby, jen bez formuláře přezdívky.
