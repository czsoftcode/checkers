# Phase 58 — Kniha: reálný komplex 11-15

**Goal:** Naplnit knihu zahájení ověřenými hlavními liniemi komplexu prvního tahu černého 11-15 (a hlavní odpovědi bílého) do rozumné hloubky (cca 6-10 půltahů), pro obě barvy enginu, s deterministickým výběrem. Zdroj = Richard Pask 'Complete Checkers' (volné PDF na bobnewell.net); data z něj vytáhne Claude, legalitu hlídá buildBook (nelegální tah = Error), zásah na klíčových pozicích ověřen testy proti reálným Position. Mimo rozsah: zrcadlová symetrie/transpozice, náhodný výběr pro variabilitu, ostatní první tahy (23-18, 22-18, 24-20...).

## Steps
- [done] Ověřit číslování a orientaci vůči Pask
- [done] Extrahovat hlavní linie komplexu 11-15 z Pask
- [done] Zakódovat linie do SEED_LINES
- [done] Aktualizovat kanárkový test z fáze 57
- [done] Testy: reálné pozice → knižní tah
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 58: Kniha: reálný komplex 11-15

## Run report
---
phase: 58
verdict: done
steps:
  - title: "Ověřit číslování a orientaci vůči Pask"
    status: done
  - title: "Extrahovat hlavní linie komplexu 11-15 z Pask"
    status: done
  - title: "Zakódovat linie do SEED_LINES"
    status: done
  - title: "Aktualizovat kanárkový test z fáze 57"
    status: done
  - title: "Testy: reálné pozice → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 58 — report z auto session

## Průběh: plán narazil, ale podařilo se

Plán počítal s extrakcí z Paskova PDF přímočaře. Realita byla horší a bylo
potřeba několik oklik:

1. **PDF nešlo přečíst** (WebFetch dostal binární FlateDecode). V systému nebyl
   `pdftotext` ani python – **poprosil jsem tě o instalaci `poppler-utils`**, což
   odemklo čistý převod (kniha je sázená v LaTeXu → text je „pravý").
2. **„Complete Checkers" je kniha 3-move, ne GAYP**, a míchá trunky, varianty i
   partie s chybami. Text nemá jasný strojový „nejlepší tah". Napsal jsem proto
   dočasný extraktor, který KAŽDOU 11-15 linii přehraje přes reálná pravidla a
   změří legální hloubku. Většina „linií" měla hloubku 1–3 (varianty s vypuštěným
   začátkem), ale **~17 se přehrálo čistě a hluboko od 1. tahu** – z nich jsem
   vybral 6 drawn-trunk linií hlavních odpovědí bílého (22-18, 23-19, 24-20,
   21-17, 23-18, 22-17), oříznul na 8 půltahů.
3. **Reálné linie obsahují braní hned v úvodu** (výměny 15x22 25x18…), což
   původní `buildBook` neuměl (jen prosté tahy). Rozšířil jsem párování na
   `from` + dopadové pole s požadavkem „právě 1 shoda" – **stejný kontrakt jako
   `playBallot` v rules** (cross-module konzistence). Řeší braní, překlepy
   (0 shod → Error) i nejednoznačnost (2 shody → Error).

## Co je hotové a ověřené (mechanicky, sám)

- `pnpm -w typecheck` čistý, `pnpm lint` čistý, **166 testů** zelených.
- Seed = 6 linií, každý z 48 půltahů ověřen legalitou přes rules (buildBook při
  načtení modulu; nelegální = Error).
- Kanárek z fáze 57 přepsán: žádný prázdný seznam + výchozí pozice = 1 kandidát +
  po 11-15 přesně 6 kandidátů (hlídá kolizi/duplicitu odpovědí bílého).
- Hloubkové testy proti reálným `Position`: Single Corner včetně braní 15x22 →
  25x18 → 12-16; engine=černý odpoví na Kelso; vypadnutí z knihy (24-19).
- **Zuby ověřeny dočasným rozbitím:** tvrdě (nelegální seed → buildBook shodí
  načtení), měkce (přeuspořádání linií rozbije výběr [0]; legální-ale-jiný tah
  12-16→8-11 projde buildBookem, ale chytí ho Single Corner i referenční test).

## Self-review nezávislým sub-agentem (čerstvý kontext)

Sub-agent stáhl/přečetl zdrojový text a **porovnal všech 48 půltahů proti Pask –
žádný transkripční nesoulad**. Zkřížil 6 linií s ověřenými balloty v
`rules/openings.ts` (existují tam jako #102, #13, #144, #139, #155, #123).
Potvrdil: orientace/číslování OK, všech 6 je trunk (ne chybová varianta).

Dva měkké nálezy:
- **(a) teeth gap** – obsahově byly testované jen linie 1 a 3; 2/4/5/6 chránilo
  jen „legální + 1 shoda". **Opravil jsem hned**: přidal referenční regresní
  zámek přehrávající všech 6 linií po celé délce (a ověřil jeho zuby).
- **(b)** linie 3/6 mají „ballotový" 3. půltah (viz `verify` výše) – funkčně
  neškodné, ne korektnostní chyba, nechal jsem být.

## Rozhodnutí, které možná chce ADR

Zdroj a přístup se během fáze zásadně změnil oproti plánu: místo „ručně opsat
GAYP linie z Pask" vznikl **poloautomatický pipeline (pdftotext → parser →
replay přes rules → výběr drawn-trunk linií)** a `buildBook` se rozšířil o braní.
To je vědomá volba proti alternativě „vzít 3-tahové balloty z rules/openings.ts
(3 půltahy, nulové riziko, ale mělké)". Zvážil jsem ji a zamítl kvůli hloubce.
Jestli to chceš zachytit, spusť před `/mini:done` příkaz `/mini:decision`.

## K lidské kontrole (nebrání zavření, ale stojí za oči)

Kvalita/vhodnost 6 zakódovaných linií pro silného hráče: jsou strojově ověřené
na legalitu a nezávisle zkontrolované proti zdroji (Pask), ale posoudit, jestli
jsou to opravdu vhodná zahájení pro tchána (ne jen legální remízy), umí líp
silný hráč. Linie 3 a 6 mají „ballotový" 3. půltah – v čistém GAYP by se možná
hrálo jinak. Doporučuju dát 6 linií (komentáře v opening-book.ts se zdrojovým
řádkem) tchánovi na oči.

## Pro člověka

- Na hru to má reálný, ale malý dopad: pokrytý je jen první tah 11-15 a 6
  odpovědí bílého do ~8 půltahů. Jakmile partie vybočí, engine počítá jako dřív.
- Deska/UI se nemění; ověřit v prohlížeči není co (čistě serverová data).
- Scratchpad: velké mezisoubory jsem uklidil; `pask_plain.txt` a `emit_out.txt`
  jsem nechal pro případnou pozdější fázi (další první tahy).
