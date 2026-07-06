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
