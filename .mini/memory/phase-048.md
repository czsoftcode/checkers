# Phase 48 — Klient: úroveň Mistrovství

**Goal:** Web klient nabídne ve výběru obtížnosti úroveň Mistrovství (český popisek, professional zůstává výchozí), pošle championship na server a korektně zvládne partii, kde po vylosovaném zahájení táhne první počítač (bílý): kontrakt GAME_LEVELS/isGameDto zná championship, oznamovací box i deska ukazují správný stav od začátku (počítač přemýšlí) a člověk nezasáhne, dokud není na tahu. Mimo rozsah: zobrazení jména zahájení, volba barvy, zotavení z error.

## Steps
- [done] championship do kontraktu + popisek Mistrovství
- [done] Srovnat komentáře s realitou bílý táhne první
- [done] Test controlleru: počítač táhne první od bílé pozice
- [done] Testy kontraktu a skořápky (championship)
- [done] Verifikace + nezávislý self-review

## Auto-commit
- Phase 48: Klient: úroveň Mistrovství

## Discussion
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

## Run report
---
phase: 48
verdict: done
steps:
  - title: "championship do kontraktu + popisek Mistrovství"
    status: done
  - title: "Srovnat komentáře s realitou bílý táhne první"
    status: done
  - title: "Test controlleru: počítač táhne první od bílé pozice"
    status: done
  - title: "Testy kontraktu a skořápky (championship)"
    status: done
  - title: "Verifikace + nezávislý self-review"
    status: done
verify:
  - title: "Reálný engine v prohlížeči: po výběru Mistrovství počítač táhne první"
    detail: "S běžícím serverem + reálným enginem vybrat v UI „Mistrovství" → deska ukáže vylosované zahájení, indikátor svítí bíle (počítač na tahu), počítač do limitu odehraje legální tah bílého a pak je na tahu člověk. V automatu ověřeno jen fake klientem (jsdom); reálné napojení engine↔server↔UI se automaticky netestuje. Tohle je zároveň přenesený verify z fáze 47, teď konečně klikatelný."
---

# Phase 48 — report z auto session

## Co je hotové
Úroveň Mistrovství (`championship`) je zpřístupněná v prohlížeči:
- **`server-client.ts`:** `'championship'` přidáno do `GAME_LEVELS` na index 1 (hned
  za `professional`, ten zůstává první = výchozí soupeř dle serverového
  `DEFAULT_LEVEL`). Tím se automaticky opravil i `isGameDto` (dřív by DTO s
  `level:'championship'` ODMÍTL jako neplatný tvar) i typ `GameLevel`.
- **`app-shell.ts`:** `LEVEL_LABELS.championship = 'Mistrovství'` (typ
  `Record<GameLevel,string>` doplnění vynutil). `<select>` se plní z `GAME_LEVELS`,
  Mistrovství je tedy v nabídce automaticky.
- **Komentáře srovnané s realitou:** controller.ts (hlavička + `engineJustMoved`) a
  app-shell.ts (latch `firstMoveMade`) měly premisu „člověk je černý a táhne první",
  která u Mistrovství neplatí (engine/bílý táhne první). Přepsáno; chování beze změny.

Mechanika „počítač táhne první" NEvyžadovala nový produkční kód: polling běží od
založení bezpodmínečně, takže první tah enginu z popballotové (bílý-na-tahu) pozice se
načte a zanimuje stejně jako každý jiný. `firstMoveMade` se u Mistrovství zamkne hned
(počáteční stav ≠ černý+idle) → přepínač úrovně se u rozehrané Mistrovství partie
korektně zamkne.

## Testy (zuby)
- `controller-championship.test.ts` (nový): (1) z počáteční bílé pozice první poll
  aplikuje tah enginu bez jediného tahu člověka (`turns`: white→black) — zub na
  „polling se z bílé spustí"; (2) na tahu bílého člověk nemůže táhnout (`postMove`
  se nezavolá) — autorita barvy na klientu.
- `server-client.test.ts`: `isGameDto`/`createGame` PŘIJME DTO s `level:'championship'`
  (před fází by odmítl — zub).
- `app-shell.test.ts`: `<select>` obsahuje „Mistrovství" a `professional` zůstává
  první; výběr Mistrovství (change) volá `createGame('championship')` a po startu se
  přepínač zamkne (latch u bílý-na-tahu startu).
- Celá web sada zelená: 201/201 (5 nových). Lint + typecheck napříč repem čisté.

## Nezávislý self-review (čerstvý kontext)
Sub-agent proběhl mutačně (rozbil produkční kód, spustil testy, vrátil zpět).
**Žádný blokující nález.** Ověřil zuby: odebrání championship z `GAME_LEVELS` shodí
3 testy; gate pollingu na tah člověka shodí controller test; obejití latche shodí
app-shell zámek. Kontrakt web↔server sedí (obě strany mají championship, professional
první, `isGameDto` ignoruje `ballotIndex` z wire). Autorita barvy blokuje klik i
tažení mimo tah člověka.

Nález nízké závažnosti a jak jsem s ním naložil:
- **Komentář mého testu přeceňoval zuby** — tvrdil, že padne „kdyby `engineJustMoved`
  selhal z bílé pozice", ale empiricky ne (`engineJustMoved` řídí jen rozmýšlecí pauzu
  AI, ne aplikaci stavu). **Opraveno** — komentář teď říká pravdu (test hlídá jen
  „polling se z bílé spustí"; detekci pauzy hlídá `controller-ai-pause.test`). Navíc
  opraven zastaralý komentář o pořadí úrovní v `app-shell.ts` (nezmiňoval Mistrovství
  ani Výuku).

## Vědomě mimo rozsah
- **Jméno vylosovaného zahájení** se nezobrazuje (openings nemají v repu ověřená jména
  — fáze 46). `ballotIndex` proto na web stranu vědomě nepřidán.
- **Volba barvy** (člověk vždy černý) a **zotavení z `error`** (backlog [28]) — jiné fáze.
- Úvodní auto-hra po reloadu ctí zapamatovanou úroveň i pro Mistrovství (konzistentní),
  vědomě beze změny.
