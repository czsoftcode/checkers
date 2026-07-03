# Mobilita v evaluaci přes legalMoves, ne přes prosté tahy

## Decision
`evaluateV2` počítá mobilitu jako rozdíl počtu legálních tahů obou stran přes veřejné `legalMoves` z rules. Nepočítá "čistou" mobilitu prostých tahů a nesahá na interní generátor.

## Why
Zvažovaná alternativa: exportovat `generateSimpleMoves` z rules a počítat mobilitu jen z prostých tahů (přesnější metrika). Zamítnuto – rules ten generátor záměrně skrývá (komentář v `index.ts`: napojení na něj by tiše nabízelo nelegální tahy, protože ignoruje povinnost braní). Držet se sankcionovaného `legalMoves` tu hranici respektuje. Cena kompromisu: má-li soupeř povinné braní, počítají se skokové sekvence místo prostých tahů → známý defekt znaménka (term "odmění" pozici, kde mi visí kámen, protože soupeř je nucen brát). Přijato vědomě (označeno v `evaluate.ts` jako známý defekt): v klidném listu, odkud search evaluaci volá, se strany na tahu netýká, a čistota kontraktu rules má přednost před přesností pomocného termu. Je to zároveň jeden z kandidátů na příčinu, proč v2 v bráně neprokázala převahu.
