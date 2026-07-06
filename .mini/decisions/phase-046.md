# Balloty se párují from+cíl proti legalMoves, ne přes parseMove

## Decision
playBallot každý půltah ballotu vyhledá jako právě jeden legální tah shodou from + poslední pole path proti legalMoves(pozice), místo aby PDN tokeny decku parsoval přes parseMove. Data ballotů jsou proto uložená jako celočíselné páry {from, to}, ne jako PDN řetězce.

## Why
Zvažovaná a zamítnutá varianta: brát PDN tokeny z decku doslova a hnát je přes parseMove. Selhává na 8 „cross" zahájeních (např. Double Cross 9-14 23-18 14x23), kde deck zapisuje braní pomlčkou (13-22), ne x. parseMove("13-22") by skončil RangeError (13 a 22 nesousedí → není to prostý tah). Párování from+cíl proti legalMoves je robustní: braní vyřeší samo (legalMoves vrací plný Move včetně captures a path), zároveň slouží jako brána legality a vrací reálné Move, které projdou i serverovou validací a advanceState. Cena: předpoklad „na from+cíl existuje právě 1 legální tah" — pro tenhle deck ověřeno (max 1 shoda přes všech 156×3 půltahů), při porušení funkce hlasitě hodí.
