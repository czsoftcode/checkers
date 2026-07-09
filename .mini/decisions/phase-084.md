# Přepínač jazyka: rebuild lobby, ne překreslení textů na místě

## Decision
Přepnutí jazyka v lobby postaví celé lobby znovu (onLocaleChange → showLobby → dispose + createLobby), místo aby obnovilo texty ve stávajícím DOM. Přepínač je proto zpřístupněný jen v entry view a handler před rebuildem zachrání rozepsanou přezdívku.

## Why
Texty lobby se skládají přes t() jednorázově při stavbě obrazovky (vzor z fází 81–83). Alternativa „překreslit texty na místě“ by vyžadovala ručně evidovat a po přepnutí obnovit každý t() řetězec (nadpis, aria/placeholder, tlačítka, hlášky, texty výzev) — víc kódu a plochy pro chybu, kterou by prozradil až chybějící překlad za běhu. Rebuild je jednodušší a konzistentní se zbytkem klienta; jeho cena je ztráta stavu obrazovky, kterou řešíme dvěma pojistkami: přepínač akční jen v entry (jinde by rebuild vyhodil hráče z rozjeté místnosti / zavřel room WS) a uložení rozepsaného nicku, aby ho překreslení nesmázlo.
