# Úvodní stav PvP partie: REST snapshot na klientovi, ne push serveru při připojení

## Decision
Klient si úvodní stav PvP partie vezme přes existující REST `GET /games/:id` a herní WS `/games/:id/ws` použije jen na živé aktualizace. Herní WS se nechává tak, jak je z fáze 66 — pushuje jen při ZMĚNĚ, při připojení mlčí. Race snapshot↔push řeší klient příznakem `liveApplied` (starší REST snapshot se zahodí, když už dorazil živý push).

## Why
Herní WS je aditivní push nad REST (fáze 66) a při připojení sám neposílá aktuální stav — bez úvodního stavu by první hráč na tahu neměl co táhnout. Nabízelo se rozšířit serverovou WS routu, aby při subscribe poslala aktuální stav (jeden ordered kanál, žádný race). Zamítnuto: fáze je vědomě klientský řez, změna chování WS by rozbila existující serverové WS testy (posílají push až po mutaci a spoléhají, že čerstvý odběratel do té doby nic nedostane) a rozšířila řez do serveru. REST cesta využívá kontrakt, který pro PvP už funguje (`GET /games/:id` vrací PvP DTO), a udrží fázi na klientovi. Cena: dva zdroje stavu (REST + WS) a nutnost hlídat jejich pořadí (`liveApplied`).
