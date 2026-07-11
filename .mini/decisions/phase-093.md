# Ruleset seam jen tam, kde ho kód čte

## Decision
Ruleset se v balíčku rules protahuje volitelným parametrem jen do cesty braní (legalMoves, jumpMovesFrom, extendJumps), kde captureDirs reálně čte manCaptureBackward. simpleMovesFrom a generateSimpleMoves parametr NEDOSTALY, přestože je plán fáze jmenoval.

## Why
Uniformní protažení ruleset přes všechny stavební bloky (varianta z plánu) by na simpleMovesFrom/generateSimpleMoves vytvořilo mrtvý parametr - prostý tah muže na Ruleset dnes nezávisí a simpleMoveDirs ho nečte. Parametr s defaultem AMERICAN_RULESET na nepoužívající funkci je navíc tichá past: volající ve flying variantě by čekal efekt na prostý tah, který nenastane. Odmítnuto ve prospěch pravidla „seam jen tam, kde ho kód opravdu čte"; do simpleMoveDirs se ruleset vrátí až ve fázi B s klouzavým pohybem dámy (king: 'flying'), kde prostý tah dámy na variantě reálně závisí.
