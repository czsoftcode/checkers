/**
 * Inicializace Plausible analytiky (privacy-friendly, self-hosted na
 * plausible.softcode.cz).
 *
 * Samotný měřicí skript se načítá jako externí `<script async>` z `index.html`.
 * Tenhle modul jen připraví globální frontu `window.plausible`, aby se případné
 * události zaznamenané JEŠTĚ PŘED dotažením skriptu neztratily (skript frontu
 * `q` po načtení přehraje), a zavolá `plausible.init()`.
 *
 * Proč modul a ne inline `<script>`: projekt (i CSP) zakazuje inline skripty.
 * Import z `main.ts` skončí v hashovaném JS bundlu, ne v HTML. Chování je
 * shodné s oficiálním Plausible snippetem, jen bez inline bloku.
 */

/** Globální funkce Plausible i s frontou a `init` (oficiální tvar snippetu). */
interface PlausibleFn {
  (...args: unknown[]): void;
  /** Fronta volání do doby, než se dotáhne externí skript. */
  q?: unknown[][];
  /** Uložené volby z `init`. */
  o?: unknown;
  /** Nastaví volby; po načtení skriptu ho přepíše reálná implementace. */
  init?: (options?: unknown) => void;
}

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

// Idempotentní: když `window.plausible` už existuje (externí skript byl
// rychlejší), použije se on; jinak nasadíme frontovací stub.
const plausible: PlausibleFn =
  window.plausible ??
  function (...args: unknown[]): void {
    (plausible.q = plausible.q ?? []).push(args);
  };

plausible.init =
  plausible.init ??
  function (options?: unknown): void {
    plausible.o = options ?? {};
  };

window.plausible = plausible;
plausible.init();

export {};
