# Changelog

Všechny podstatné změny projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

### Added

- Kostra monorepa: pnpm workspaces se čtyřmi balíčky (`@checkers/rules`,
  `@checkers/engine`, `@checkers/server`, `@checkers/web`).
- Sdílený přísný TypeScript základ (`tsconfig.base.json`, strict +
  `noUncheckedIndexedAccess`).
- Vitest se smoke testy ve všech balíčcích, ESLint 10 s typed lintingem.
- GitHub Actions CI: lint, typecheck a testy na Node 24 při každém pushi.
