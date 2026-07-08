# Tvar WS transportu: obálka s typem + socket per partie

## Decision
Push zpráva má tvar obálky `{ type: 'game-state', game: GameDto }` s diskriminátorem `type` (ne holý GameDto), a klient odebírá partii připojením na cestu `GET /games/:id/ws` (jedno spojení = jedna partie), ne jedním multiplexovaným socketem se `subscribe` zprávami. Obojí je vědomě přechodné pro první řez v3.

## Why
**Obálka vs. holý DTO:** dnes existuje jediný typ zprávy, takže obálka je teď redundantní. Přesto vyhrála, protože v3 přinese další typy (presence v místnosti, výzvy) - bez diskriminátoru `type` od začátku by je každá další fáze musela do kontraktu doříznout a rozbít už napojený klient. Cena je jedno pole navíc teď, výnos je stabilní kontrakt napříč v3.

**Socket per partie vs. multiplex:** multiplex (jeden socket, `subscribe { gameId }`) je blíž cílovému lobby modelu (jeden hráč, víc partií), ale nese víc mašinérie teď - směrování zpráv, správu více odběrů na spojení. Pro nejmenší hratelný řez (dvě připojení → jedna partie) je cesta per partie nejmenší krok a sedí ke stávajícím `/games/:id/...`. Vědomě se počítá s tím, že lobby fáze to nejspíš nahradí multiplexem - proto je `type` obálka důležitá: přežije tu výměnu transportu beze změny tvaru dat.
