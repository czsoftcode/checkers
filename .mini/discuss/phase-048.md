# Phase 48 — Klient: úroveň Mistrovství

## Intent
Zpřístupnit v prohlížeči úroveň Mistrovství (`championship`), kterou umí server od
fáze 47. Uživatel ji vybere ve stejném rozbalovátku jako ostatní úrovně; po založení
partie server vylosuje a nasadí třítahové zahájení a partie startuje s BÍLÝM (počítač)
na tahu → počítač táhne první. Klient to musí zvládnout: znát `championship` v
kontraktu, ukázat správný stav od začátku (počítač přemýšlí) a nepustit člověka k tahu,
dokud není na tahu. Rozsah je JEN klient (server hotový).

Zjištění z průzkumu: mechanika „počítač táhne první" už z velké části FUNGUJE díky
stávajícímu kódu — polling běží bezpodmínečně od startu (`setInterval`, controller.ts:196)
a `engineJustMoved(bílý→černý)` (controller.ts:81) platí i pro první tah, protože počáteční
pozice Mistrovství je bílý-na-tahu. `firstMoveMade` (app-shell.ts:344) se u Mistrovství
zamkne hned (počáteční stav není „černý+idle"). Indikátor tahu (app-shell.ts:380) ukáže
bílý kámen = počítač. Práce je proto malá + srovnat komentáře s neplatnými domněnkami.

## Key decisions
- **`GAME_LEVELS` (server-client.ts:32):** přidat `'championship'` na INDEX 1 (hned za
  `professional`). `professional` MUSÍ zůstat první — je to výchozí `<option>` a musí
  sedět na serverový `DEFAULT_LEVEL='professional'` (jinak se úvodní auto-partie a
  serverový default rozejdou). Přidání hodnoty zároveň spraví `isGameDto` (dnes by DTO
  s `level:'championship'` ODMÍTL jako neplatný tvar, server-client.ts:281) i typ `GameLevel`
  i naplnění `<select>` (app-shell.ts:131).
- **`LEVEL_LABELS` (app-shell.ts:28):** `championship: 'Mistrovství'`. Typ
  `Record<GameLevel,string>` doplnění vynutí (bez popisku spadne typecheck).
- **`ballotIndex` na web NEPŘIDÁVAT.** Klient nic z něj nezobrazuje (jméno zahájení je
  mimo rozsah — openings nemají v repu ověřená jména, fáze 46) a `isGameDto` cizí pole
  ignoruje, takže wire s `ballotIndex` navíc nic nerozbije. Přidat až kdyby UI chtělo
  ukázat, které zahájení padlo.
- **Úvodní auto-hra po reloadu: nechat beze změny.** `startNewGame()` čte
  `levelSelect.value`, ten je z localStorage (app-shell.ts:142), takže vrátíš-li se
  k Mistrovství, appka po reloadu rovnou založí Mistrovství partii (počítač přemýšlí a
  táhne první). Konzistentní s ostatními úrovněmi (i beginner se takhle pamatuje) →
  žádný extra kód, jen srovnat komentář „napoprvé Profesionál", který platí jen pro
  případ bez uložené volby.
- **Pořadí v menu:** Profesionál, Mistrovství, Pokročilý, Začátečník, Výuka.

## Watch out for
- **Neplatné domněnky v komentářích — srovnat s realitou (ne jen kód, i komentář):**
  - controller.ts:11-12 („člověk hraje černé, táhne se jen na tahu člověka") a okolí
    `engineJustMoved` — u Mistrovství táhne PRVNÍ bílý/engine. Interakce „jen na tahu
    člověka" pořád platí, ale premisa „táhne první člověk" ne.
  - app-shell.ts:342-343 (latch `firstMoveMade`): komentář tvrdí „člověk je černý a
    táhne první, takže dřív než jeho tahem se sem nedostane nic než výchozí stav". U
    Mistrovství je počáteční stav bílý+thinking → latch se zamkne HNED. Kód je správně
    (select se zamkne), ale odůvodnění je nepravdivé — přepsat, ať zahrnuje bílý-první.
- **Mechaniku „počítač táhne první" NEROZBÍT.** Stojí na: (a) polling běží od startu
  bezpodmínečně; (b) `engineJustMoved(bílý→černý)` platí z počáteční bílý-na-tahu pozice.
  Zub testu: controller inicializovat DTO s `turn:'white', engineStatus:'thinking'`, fake
  klient na `getGame` vrátí stav po tahu enginu (`turn:'black'`) → první poll ho aplikuje,
  `onState` ohlásí přechod na černého (engine táhl první). Kdyby se polling nespouštěl
  na startu nebo `engineJustMoved` selhal z bílé pozice, test padne.
- **AI pauza (AI_MOVE_PAUSE_MS) u prvního tahu:** `humanMoveAnimEndAt` je na startu 0 →
  `elapsed` obrovský → žádná pauza navíc. Serverová minimální doba přemýšlení (~1 s,
  fáze 30) stejně dá enginu čas, takže první tah „neproblikne". Není co řešit, jen vědět.
- **`change` na select u čerstvé partie:** vybrání Mistrovství na nerozehrané partii
  (firstMoveMade=false) spustí `startNewGame()` → založí championship (čte
  `levelSelect.value`). Zamýšlené chování, netřeba měnit.
- **Testy se zuby (kromě controller testu výše):**
  - server-client: `isGameDto` PŘIJME DTO s `level:'championship'` (před fází by odmítl).
  - app-shell: `<select>` obsahuje „Mistrovství"; jeho výběr (change) volá
    `createGame('championship')`; po startu championship je `levelSelect.disabled` (latch).
    Testovat proti reálnému app-shellu/DOM (jsdom), ne mlocku.
- **Zpětná kompatibilita:** ostatní úrovně beze změny — `professional` první = výchozí,
  tok „černý táhne první" nedotčen; auto-úvodní hra bez uložené volby = Profesionál.
- **Ruční e2e (mimo automat):** s REÁLNÝM enginem v prohlížeči vybrat Mistrovství →
  počítač po ballotu opravdu odehraje legální tah bílého do limitu, deska/indikátor
  ukazují „počítač na tahu" od začátku. Tuhle fázi teprve zpřístupní klikání, takže
  přenesený verify z fáze 47 se dá konečně odklikat.
