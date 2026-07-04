# Phase 21 — UI vícenásobného skoku

## Intent
Rozšířit klientskou desku tak, aby hráč postupným klikáním doklikal celý
vícenásobný skok, zvolil větev (když z mezidopadu vede víc pokračování), a po
dokončení sekvence se tah lokálně provede přes `applyMove` z rules a deska se
překreslí. Prostý tah (path délky 1) vypadne ze stejného mechanismu.

Dnešní stav: `selection.targetsFor` vrací jen první dopad (`path[0]`) každého
tahu; `controller` drží jen jeden `selected: Square` a neměnnou `position`.
Doklikávání sekvence bylo výslovně odloženo sem (komentář v selection.ts).

Rozsah je čistě klientský: bez serveru a bez enginu (to je todo 20).

## Key decisions
Uživatel na dotazy během diskuse neodpověděl (byl pryč od klávesnice). Zvoleny
bezpečnější/jednodušší varianty jako výchozí směr — u `plan`/`do` je lze změnit,
pokud si je uživatel rozmyslí:

1. **Zpětná vazba během skoku:** kámen zůstane vizuálně na výchozím poli; zvýrazní
   se dosavadní cesta (mezidopady) + další možné dopady. Nic se neaplikuje ani
   nemaže z desky, dokud není tah kompletní. Drží invariant „jediný zdroj pravdy
   = rules" a nevzniká riziko, že by render duplikoval logiku braní.
2. **Vynucený jediný dopad:** klik na každý dopad zvlášť, i když je jen jedna
   možnost. Deska se nikdy nehýbe sama; předvídatelné.
3. **Po dokončení tahu:** hot-seat — `applyMove` otočí tah na druhou barvu a
   `selectableAt` pak pustí jen její kameny, takže hráč klika za obě strany.
   Vědomý placeholder do todo 20 (napojení enginu/serveru). Umožní protáhnout
   víc tahů za sebou a otestovat řetězení už teď.
4. **Zrušení rozpracovaného skoku:** jen úplný reset (klik na vybraný kámen nebo
   mimo zvýrazněná pole zahodí celou předponu). Žádný krok zpět po jednom dopadu.

## Watch out for
- **Detekce dokončení patří rules, ne klientu.** V americké dámě je každý skokový
  řetězec maximální (musí se skákat, dokud lze). Klient NESMÍ sám počítat „už
  není kam skočit" — jen filtruje výstup `legalMoves` na tahy, jejichž `path`
  začíná naklikanou předponou. Dokončení = předpona se rovná `path` právě jednoho
  z těch tahů. Zdroj legality zůstává výhradně rules.
- **Model výběru = předpona cesty, ne jeden Square.** `controller` musí přejít z
  `selected: Square | null` na stav (from + naklikaná předpona landing polí).
  `position` už nesmí být `const` — po tahu se mění (`let position`).
- **Nová funkce místo/vedle `targetsFor`:** potřeba je „další dopady pro danou
  předponu" = pro každý matching move square na indexu `path[prefix.length]`.
  Zvážit nahrazení `targetsFor` obecnější variantou (prázdná předpona = dnešní
  chování prvních dopadů), ať se logika nedělí na dvě.
- **Větvení se stejným prvním dopadem:** dva různé maximální tahy mohou sdílet
  prefix a rozejít se později — model musí nabízet oba směry na dalším kroku, ne
  spadnout do prvního. Klíčovat na Move objekty z legalMoves, ne rekonstruovat
  path/captures na klientu.
- **Konec hry / terminální pozice po tahu** (žádné legalMoves pro stranu na tahu)
  je mimo rozsah — deska prostě nepustí žádný výběr. Zobrazení výsledku řeší
  todo 20. Neošetřovat tady, jen se kvůli tomu nezaseknout (deska nesmí spadnout).
- **Bez inline stylů/scriptů (CSP):** nové zvýraznění (cesta, dopady) přes CSS
  třídy ve styles.css, ne inline. board-view už používá classList (`selected`,
  `target`) — přidat třídu pro „cestu skoku".
- **Unhappy path k pokrytí:** klik mimo zvýrazněná pole uprostřed sekvence, klik
  na kámen soupeře, opakovaný klik na vybraný kámen, dokončení skoku s proměnou
  (applyMove řeší proměnu i render kingů — jen ověřit, že překreslení sedí).
