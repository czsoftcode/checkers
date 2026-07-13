# Italská orientace: vizuální rotace renderu, ne změna enginu

## Decision
Italská deska se otáčí (tmavé pole vpravo dole, kameny na tmavých polích dle FID) zrcadlením pořadí SLOUPCŮ v board-view.ts – čistě vizuální posun pořadí appendu. data-square, parita, číslování, Zobrist i perft zůstávají na americkém souřadném systému. Obrázek desky ani parita enginu se nemění.

## Why
Zvažené a ZAMÍTNUTÉ alternativy:
- Jen prohodit asset bez rotace (původní rozhodnutí discuss fáze 117): stálo na chybném předpokladu, že oba obrázky desky mají stejnou paritu. Pixelové měření ukázalo opak (game_board tmavá pole na liché paritě, right_game_board na sudé) → engine kladl kameny na světlé dřevo. Špatně.
- Zrcadlit samotný obrázek right_game_board: kameny by padly na tmavé, ale roh vpravo dole by vyšel světlý → poruší FID (ultima casella in basso a destra nera).
- Změnit paritu/souřadnice enginu pro italskou: zakázáno projektovým non-goal (parita, číslování, Zobrist se nesmí lišit) – rozbilo by sdílené jádro a perft ostatních variant.

Zrcadlení sloupců v renderu je jediná cesta k FID orientaci (kameny na tmavém, tmavý roh vpravo dole) BEZ zásahu do enginu. Je to netriviální a náchylné ke zjednodušení zpět na pouhý asset-swap – proto ADR, aby rotace zůstala zachovaná.
