# Výsledek vzdání zpět do skořápky: callback, ne návratový Promise

## Decision
BoardController.resign() zůstává resign(onResolved?: (didResign: boolean) => void): void — výsledek vzdání („opravdu ukončilo partii?") jde zpět volitelným callbackem, ne návratovým Promise<boolean>. Skořápka podle něj sundá příznak resignedThisGame, když vzdání neproběhlo (síť selhala → resync na ongoing), aby se pozdější regulérní konec 1. kola nevyhodnotil jako vzdání a nezrušil zápas.

## Why
Idiomatičtější by byl návrat Promise<boolean>. Jenže ESLint běží s recommendedTypeChecked, kde je aktivní no-floating-promises, a resign() se na ~6 místech v controller testech volá jako controller.resign(); (fire-and-forget). Změna na návratový Promise by z nich udělala floating promises → buď void-prefix churn napříč cizími testy mimo záběr této fáze, nebo obalování. Callback dá skořápce přesně ten signál, který potřebuje (kdy sundat příznak), beze změny stávajících volání i tvaru void. Optimistické nastavení příznaku PŘED resign() zůstává nutné kvůli timingu: úspěšné vzdání vyvolá terminální onState ještě uvnitř resign(), takže příznak musí být nastavený dřív; callback slouží jen k jeho sundání na neúspěchu.
