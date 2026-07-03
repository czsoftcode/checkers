---
phase: 6
verdict: done
steps:
  - title: "applyMove: prostý tah a jednoduchý skok"
    status: done
  - title: "applyMove: vícenásobný a kruhový skok"
    status: done
  - title: "Strukturální validace se zuby"
    status: done
  - title: "Proměna - golden testy"
    status: done
  - title: "Export, konzistence s generátorem, zelený workspace"
    status: done
---

# Phase 6 — report from the auto session

## Co vzniklo
- `packages/rules/src/apply.ts` – `applyMove(position, move)`: přehraje tah krok po kroku nad kopií desky (imutabilní – vstup netknutý i při chybě), kámen skončí na konci path, brané kameny zmizí, na tah jde soupeř. Exportováno z indexu balíčku.
- Strukturální validace s geometrií: kromě dohodnutých kontrol (kámen strany na tahu na from, volné dopady, soupeř na braných polích, captures bez duplicit) se kontroluje i geometrie kroků – prostý tah jen na souseda (žádný teleport), skok jen po skokové čáře s braným polem PŘESNĚ mezi. Nad rámec plánu, ale pořád O(délka tahu) – chrání integritu desky, ne legalitu.
- Proměna: muž končící na zadní řadě soupeře (černý 29-32, bílý 1-4) se stává dámou; dáma zůstává dámou. Past GDD 2.7 end-to-end: 21x30 přes 25 s bílým na 26 – generátor tah ukončí na 30 (dáma z 30 by 26 brát mohla), applyMove vrátí černou DÁMU na 30, bílý 26 přežije, na tahu bílý.
- Test konzistence: každý tah z legalMoves na 4 scénářích (výchozí, větvení, kruh dámy, proměna skokem) projde applyMove bez výjimky.
- Celkem 182 testů v rules, workspace zelený (typecheck, testy, lint).

## Nezávislý self-review (sub-agent, čerstvý kontext)
Recenzent přepočítal všechny fixtures (proměna 26→30, 6→1, 21x30 přes 25, trojskok, kruh dámy – vše sedí) a paritním argumentem potvrdil, že průběžné odebírání braných kamenů nemůže odmítnout legální tah (brané pole nikdy není dopad). Ověřil úvahou zuby testů (prohození řad proměny, neuvolněný origin, chybějící kontrola dopadu – všechno by testy shodilo) a zkoušel strukturální podvody (teleport, špatné brané pole, míchání skoku s krokem, path [from] – vše chyceno). Žádný kritický ani střední nález. Nízké nálezy, všechny hned ošetřené:
- Rejection testy neověřovaly chybovou zprávu → přidán test na konkrétní hlášku (dopad mimo desku).
- Kontrakt „tah muže vzad strukturálně projde" nebyl přibitý testem → přidán test s komentářem, že jeho pád = vědomé přehodnocení kontraktu.
- Imutabilita nebyla testovaná na chybové větvi → přidán test (neúspěšná aplikace nechá vstup netknutý).
- Docstring doplněn o explicitní příklad, proč MUSÍ každý externí tah projít bránou legalMoves („pokračování po proměně" projde strukturou a vyrobí muže místo dámy – pravidlová, ne datová korupce).
- Chybová zpráva pro díru v desce zpřesněna.

## Unhappy path
Odmítnuté vstupy (vše RangeError + test): prázdná path, prostý tah s více dopady, nesedící počty captures/path, obsazený dopad, teleport, špatné brané pole, dopad mimo desku, tah z prázdného/soupeřova pole, braní prázdného/vlastního kamene, duplicitní captures. Vstupní pozice zůstává netknutá i při výjimce uprostřed přehrávání (mutuje se jen lokální kopie).

## Poznámka
Vědomá hranice: applyMove NEHLÍDÁ povinnost braní ani směr muže – server (M4) musí validovat členstvím v legalMoves. Je to zdokumentované v kódu, přibité testem a zapsané v poznámkách diskuse (ADR-úroveň rozhodnutí už je zachycená tam, samostatné ADR nenavrhuji).
