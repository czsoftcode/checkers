# Americká dáma – Checkers

Klient-server hra americké dámy (English draughts) v prohlížeči: člověk proti AI enginu.
Server je jediná autorita nad pravidly a stavem partie, engine běží jako oddělený
podproces za protokolem JSON Lines. Kód je rozdělený do pnpm workspace balíčků:

| Balíček | Co dělá |
| --- | --- |
| `@checkers/rules` | Čistá knihovna pravidel (generování a validace tahů, žádné I/O) |
| `@checkers/engine` | AI engine (negamax + alfa-beta), samostatný proces |
| `@checkers/server` | HTTP server (Fastify), autorita nad partií |
| `@checkers/web` | Webový klient (Vite + vanilla TS) |
| `@checkers/cli` | Hra v terminálu (bez serveru) |

## Požadavky

- **Node.js 24** (aktivní LTS). Verze je zafixovaná v `.nvmrc` a vynucená přes
  `engines: { node: ">=24" }`. Máš-li `nvm`, stačí v kořeni repa spustit `nvm use`.
- **pnpm 10.33.0** – vynucené polem `packageManager` v `package.json`. Nejjednodušší
  cesta je zapnout Corepack (součást Node): `corepack enable`, pak se správná verze
  pnpm použije sama.

## Instalace

V kořeni repa jednou nainstaluj závislosti celého workspace:

```bash
pnpm install
```

## Vývojové spuštění

Hra ve vývoji potřebuje **dva běžící procesy** – server a webový klient. Spusť je
každý ve vlastním terminálu.

**1. Server** (autorita + engine), naslouchá na portu `3000`:

```bash
pnpm --filter @checkers/server start
```

Server se spouští přes `tsx` (běží TypeScript přímo, bez build kroku) a na startu
si „zahřeje" engine podproces, aby první tah nezdržel studený start.

**2. Webový klient** (Vite dev server) na portu `5173`:

```bash
pnpm --filter @checkers/web dev
```

Pak otevři **<http://localhost:5173>** a hraj.

Klient volá API relativními cestami (`/games…`); Vite dev server je díky
`server.proxy` v `packages/web/vite.config.ts` přeposílá na server
(`http://127.0.0.1:3000`). Díky tomu není potřeba řešit CORS ani mít URL serveru
natvrdo v kódu. Pořadí startu nehraje roli, ale dokud neběží server, vrací API
volání chybu.

### Hra v terminálu (bez serveru)

Samostatné CLI **nepoužívá AI engine ani server** – závisí jen na
`@checkers/rules` a slouží k rychlému vyzkoušení pravidel v konzoli. Výchozí
příkaz odehraje ukázkovou partii dvou **náhodných** hráčů (random vs random):

```bash
pnpm --filter @checkers/cli start
```

Interaktivní režim – člověk zadává tahy v PDN proti **náhodnému** protihráči
(pořád ne proti enginu). Volby se předávají **bez `--`** (dvojité `--` pnpm
propustí do skriptu a `parseArgs` ho odmítne):

```bash
pnpm --filter @checkers/cli start --mode human            # člověk (černý) vs random
pnpm --filter @checkers/cli start --mode human --color white --seed 1
```

## Produkční web build

Webového klienta lze sestavit do statických souborů:

```bash
pnpm --filter @checkers/web build     # výstup do packages/web/dist/
pnpm --filter @checkers/web preview    # lokální náhled buildu na portu 4173
```

`vite preview` **dědí** `server.proxy` z `packages/web/vite.config.ts` (ve Vite 8
platí `preview.proxy ?? server.proxy`), takže i náhled přeposílá `/games` na
server (`http://127.0.0.1:3000`). Když tedy vedle preview běží server, hra přes
náhled funguje stejně jako ve vývoji; bez běžícího serveru vrací `/games`
odpověď `502` (proxy nemá kam přeposlat).

> **Pozor – hotová produkční verze v repu ale není.** Dvě věci chybí:
>
> 1. **Server nemá produkční build.** Spouští se pořád přes `tsx`
>    (`packages/server/src/main.ts`), tedy stejně jako ve vývoji. Žádný zabalený /
>    zkompilovaný artefakt se negeneruje.
> 2. **`vite preview` není produkční web server.** Je určený k lokálnímu náhledu
>    buildu, ne k nasazení. Pro reálné produkční nasazení by statický `dist/` měl
>    servírovat plnohodnotný web server / **reverzní proxy** (např. nginx / Caddy),
>    která zároveň cesty `/games…` směruje na běžící server. To v tomto repu zatím
>    připravené není.

## Proměnné prostředí

Chování serveru lze přebít proměnnými prostředí (výchozí hodnoty ověřené proti
`packages/server/src/main.ts`):

| Proměnná | Výchozí | Význam |
| --- | --- | --- |
| `PORT` | `3000` | Port, na kterém server naslouchá. |
| `ENGINE_TIME_MS` | `1000` | Kolik ms dostane engine na jeden tah. |
| `CHECKERS_PDN_DIR` | `.pdn/` (v kořeni repa) | Kam server archivuje dokončené partie jako `<id>.pdn`. Zadaná cesta se bere relativně ke cwd; absolutní cesta funguje taky. |

Příklad – server na jiném portu a s delším časem enginu:

```bash
PORT=8080 ENGINE_TIME_MS=2500 pnpm --filter @checkers/server start
```

## Testy a kontroly

Spouští se z kořene repa přes celý workspace:

```bash
pnpm test        # Vitest ve všech balíčcích (perft, fixtures, past-testy…)
pnpm lint        # ESLint nad celým repem
pnpm typecheck   # tsc --noEmit ve všech balíčcích
```
