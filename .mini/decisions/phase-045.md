# getHint jako volitelná metoda na ServerClient

## Decision
Metoda getHint je na kontraktu ServerClient VOLITELNÁ (getHint?: (id) => Promise<MoveDto>, property s arrow-typem), na rozdíl od ostatních metod (createGame, postMove, …), které jsou povinné. Controller ji volá jen ve Výuce (level==='education') a předtím si ověří, že existuje.

## Why
Povinná metoda by vynutila stub getHint ve ~24 fake klientech napříč 7 testovacími soubory – v testech režimů, které nápovědu vůbec nepoužívají. To je ceremonie navíc bez užitku. Volitelná varianta: controller nápovědu stejně gate-uje na úroveň Výuka, jediný reálný klient (createHttpClient) ji vždy implementuje a hlídá to server-client.test (guard hintOf), takže reálný kontrakt se neoslabí. Property s arrow-typem (ne metoda) navíc kvůli ESLint unbound-method: controller si getHint ukládá do lokální proměnné kvůli zúžení optional typu.
