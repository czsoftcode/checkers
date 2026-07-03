# Changelog

Všechny podstatné změny projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

## [0.1.0] - 2026-07-03

### Added

- Základ knihovny pravidel (`@checkers/rules`): typy partie (barva, kámen,
  pozice, tah s podporou vícenásobných skoků), standardní PDN číslování
  polí 1-32 s převodem na souřadnice a zpět a předpočítané tabulky
  sousedství a skoků (`NEIGHBORS`, `JUMPS`) pro 4 diagonální směry.
  Neplatné vstupy (pole mimo 1-32, světlé políčko, neplatný směr) vyhazují
  `RangeError`; vše kryté 92 testy s ručně spočítanými hodnotami.
- Kostra monorepa: pnpm workspaces se čtyřmi balíčky (`@checkers/rules`,
  `@checkers/engine`, `@checkers/server`, `@checkers/web`).
- Sdílený přísný TypeScript základ (`tsconfig.base.json`, strict +
  `noUncheckedIndexedAccess`).
- Vitest se smoke testy ve všech balíčcích, ESLint 10 s typed lintingem.
- GitHub Actions CI: lint, typecheck a testy na Node 24 při každém pushi.
