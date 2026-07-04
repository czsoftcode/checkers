# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 22-1 · blocker · resolved
**Where:** packages/web/src/board-view.ts:73 renderPiece; packages/web/src/styles.css .piece
**Reviewed-at:** 0fd7b8f3c99a68ec7a4390dbd3559bfdf5ce883b
**Source:** verify
**Reason:** Opraveno v této fázi: renderPiece idempotentní (nerecykluje .piece) + .piece pointer-events:none. Pokryto testy (opakovaný update nerecykluje element, proměna man->king mění třídu beze změny elementu, odchod kamene odstraní). Čeká vizuální re-verify uživatelem v prohlížeči.
Klik na kámen se občas spolkne (polling recykluje DOM)

Symptom: klik na kámen občas nezareaguje; klik na prázdnou část políčka funguje vždy. Příčina: renderPiece při každém update() smaže a znovu vytvoří všechny .piece elementy; po napojení na server běží poll à 250 ms, takže se to děje pořád. Když poll spadne mezi mousedown a mouseup na kameni, .piece se vymění a prohlížeč klik spolkne. .square je stabilní, proto klik mimo kámen projde. Regrese fáze 22 (dřív se v hot-seatu překreslovalo jen při interakci). Oprava: (1) renderPiece idempotentní - kámen měnit/mazat jen při reálné změně obsahu pole, ne recyklovat beze změny (odstraní i blikání à 250 ms); (2) pojistka .piece { pointer-events: none } v styles.css, ať klik projde na stabilní .square. Test: přidat, že opakované update() se stejnou pozicí nevytvoří nový .piece element (zachová referenci).
