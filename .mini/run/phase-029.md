---
phase: 29
verdict: done
steps:
  - title: "Rozšířit sound.ts o událost draw"
    status: done
  - title: "Přehrát zvuk remízy na přechodu do remízy"
    status: done
  - title: "Otočit test remízy z beze zvuku na zní jednou"
    status: done
  - title: "Ověřit a zajistit zvuk prvního tahu AI"
    status: done
  - title: "Self-review nezávislým sub-agentem + CHANGELOG"
    status: done
verify:
  - title: "Poslechnout zvuk remízy v reálné hře"
    detail: "Dohraj partii do remízy (nabídni remízu, ať ji engine přijme, nebo doveď na 80 půltahů / trojí opakování) a ověř, že se přehraje zvuk_remizy.mp3 – jednou, až po dokončení animace posledního tahu. Testy ověřují, že se play('draw') zavolá, ne že prohlížeč skutečně vydá zvuk."
  - title: "Ověřit, že první tah AI je v prohlížeči slyšet"
    detail: "Zahraj první tah člověka (klik na desku) a poslouchej, jestli odpověď enginu zazní. Analýza i test říkají, že ano (klik člověka odemkne autoplay dřív, než engine potáhne), ale reálné odemčení audia jsdom neověří – to potvrdí jen ucho."
  - title: "Binární assety v pracovním stromu (mimo rozsah fáze)"
    detail: "git status ukazuje změněné zvuk_remizy.mp3, zvuk_prohry.mp3, vitezne_fanfary.mp3 a nový background_06.webp. Podle mtime jsi je vyměňoval souběžně během session, ne já. Fáze 29 se jich kódem nedotkla (závisí jen na existenci zvuk_remizy.mp3). Zkontroluj před commitem, že jsou to zamýšlené finální nahrávky."
---

# Phase 29 — report z auto session

## Co se udělalo

- **`sound.ts`**: přidána událost `draw` do typu `SoundEvent` a do mapy `SOURCES`
  (import `zvuk_remizy.mp3?url`). Mapa je `Record<SoundEvent, string>`, takže
  kompilátor vynutí zdroj pro každou variantu. Jednotkové testy v `sound.test.ts`
  ověřují, že `play('draw')` sáhne na URL remízy a že je to pátý různý zvuk.
- **`controller.ts`** (`applyServerState`): terminální výsledek se mapuje na zvuk
  přes `Record<Exclude<GameResult, 'ongoing'>, SoundEvent>` a pouští stejnou
  cestou jako win/loss (`scheduleEndSound` → návaznost na dokončení animace +
  prodleva, přehrání právě jednou na hraně `ongoing → terminál`).
- **Testy**: test „remíza je beze zvuku" otočen na „remíza přehraje zvuk remízy,
  jednou"; přidán `describe('zvuk tahu AI (dorazí pollem)')` se dvěma testy
  (tah enginu z pollu spustí zvuk / shodná pozice mlčí). Oba mají ověřené zuby.

## Zuby testů (ověřeno empiricky)

- Vyříznutí přehrání zvuku remízy (guard `event !== 'draw'`) shodí test remízy.
- Vypnutí `player.play('land')` ve snap větvi `board-view.ts` shodí test tahu AI.
- Sub-agent navíc nezávisle potvrdil zuby vlastním rozbitím/obnovením kódu.

## „První tah AI" – závěr: žádná chyba

Původní obava se nepotvrdila jako defekt. Člověk hraje černé a v anglické dámě
táhne černý první, takže engine nikdy netáhne dřív, než člověk klikne na desku a
tím přes `unlock()` odemkne autoplay. POST /moves vrací stav hned po tahu člověka,
tah enginu dorazí pollem – render tahu AI proto `board-view` ozvučí. Kód jsem
neměnil, jen doplnil chybějící test.

## Nezávislý self-review (čerstvý kontext) a co z něj vzešlo

Sub-agent nenašel kritickou chybu (přehrání „právě jednou" i AI-větev v pořádku),
ale trefil jeden oprávněný nález:

- **Neexhaustivní `else: 'draw'`** v controlleru – kdyby do `GameResult` přibyla
  pátá terminální hodnota, controller by pro ni tiše zahrál zvuk remízy, zatímco
  server/CLI (které používají `Record<Exclude<GameResult,'ongoing'>>`) by se
  hlasitě rozbily. **Opraveno**: controller teď používá stejný exhaustivní vzor →
  budoucí rozšíření typu spadne při kompilaci, ne potichu za běhu.

Dvě drobnosti sub-agenta jsem vyhodnotil jako nedělat teď:
- `safePlay` v `sound.ts` polyká i případný synchronní `TypeError` z `play()`.
  Rozsah `try` je úzký (jen `node.play()`) a `factory` je řízená, dnes nic reálného
  nemaskuje; riziko jen u budoucí custom factory. Ponecháno.
- CHANGELOG původně přeháněl („ověřeno, že tah AI se ozve“) – **zmírněno** na
  „test ověřuje, že se zavolá `play`; reálné odemčení audia neověří“.

## Stav kontroly

`tsc --noEmit` čistý, eslint čistý, celá web sada 116 testů zelená.

## Pozor (viz verify)

V pracovním stromu jsou souběžně vyměněné binární zvukové soubory a nový obrázek
pozadí – nedělal jsem je, ale objeví se v commitu. Před commitem zkontroluj, že
jsou zamýšlené.
