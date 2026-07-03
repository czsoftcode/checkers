/**
 * Loader sdílených fixtures (fixtures/*.json) – viz fixtures/README.md.
 * Validace je přísná a hlučná: poškozená fixture musí test SHODIT, ne se
 * tiše přeskočit – fixtures jsou kontrakt i pro budoucí Rust engine.
 * Žije v test/, knihovna sama zůstává bez I/O.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Cell, Color, Position } from '../../src/index.js';

export interface Fixture {
  readonly name: string;
  readonly description: string;
  /** Surový 32znakový řetězec desky – kvůli testu konzistence kódování. */
  readonly board: string;
  readonly turn: Color;
  readonly expectedMoves: readonly string[];
  readonly perft?: readonly number[];
  readonly position: Position;
  /** Název souboru – kvůli srozumitelným chybám testů. */
  readonly file: string;
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

const CELL_BY_CODE: Readonly<Record<string, Cell>> = {
  '.': null,
  m: { color: 'black', kind: 'man' },
  k: { color: 'black', kind: 'king' },
  M: { color: 'white', kind: 'man' },
  K: { color: 'white', kind: 'king' },
};

/** Dekóduje 32znakový řetězec desky; cokoli mimo formát je Error. */
export function decodeBoard(board: string, file: string): readonly Cell[] {
  if (board.length !== 32) {
    throw new Error(`${file}: board má ${String(board.length)} znaků místo 32`);
  }
  return [...board].map((code, i) => {
    const cell = CELL_BY_CODE[code];
    if (cell === undefined) {
      throw new Error(`${file}: neznámý znak „${code}" na poli ${String(i + 1)}`);
    }
    return cell;
  });
}

/** Zvaliduje surový JSON objekt fixture; cokoli mimo formát je Error. */
export function parseFixture(raw: unknown, file: string): Fixture {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: fixture není objekt`);
  }
  const data = raw as Record<string, unknown>;
  // Neznámý klíč = pravděpodobný překlep (např. "pertf") – nepovinné pole
  // by se tiše přestalo kontrolovat, proto tvrdá chyba.
  const KNOWN_KEYS = ['name', 'description', 'board', 'turn', 'expectedMoves', 'perft'];
  const unknown = Object.keys(data).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${file}: neznámé klíče: ${unknown.join(', ')}`);
  }
  const { name, description, board, turn, expectedMoves, perft } = data;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${file}: chybí name`);
  }
  if (typeof description !== 'string' || description === '') {
    throw new Error(`${file}: chybí description`);
  }
  if (typeof board !== 'string') {
    throw new Error(`${file}: chybí board`);
  }
  if (turn !== 'black' && turn !== 'white') {
    throw new Error(`${file}: turn musí být black nebo white, ne ${String(turn)}`);
  }
  if (!Array.isArray(expectedMoves) || expectedMoves.some((m) => typeof m !== 'string')) {
    throw new Error(`${file}: expectedMoves musí být pole řetězců`);
  }
  if (perft !== undefined) {
    if (
      !Array.isArray(perft) ||
      perft.length === 0 ||
      perft.some((n) => !Number.isInteger(n) || (n as number) < 0)
    ) {
      throw new Error(`${file}: perft musí být neprázdné pole nezáporných celých čísel`);
    }
  }
  return {
    name,
    description,
    board,
    turn,
    expectedMoves: expectedMoves as string[],
    ...(perft !== undefined ? { perft: perft as number[] } : {}),
    position: { board: decodeBoard(board, file), turn },
    file,
  };
}

/** Načte a zvaliduje VŠECHNY fixtures/*.json; prázdný adresář je Error. */
export function loadFixtures(): readonly Fixture[] {
  const files = readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`V ${FIXTURES_DIR} nejsou žádné *.json fixtures`);
  }
  return files.map((file) => {
    const text = readFileSync(join(FIXTURES_DIR, file), 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file}: nevalidní JSON`, { cause: error });
    }
    return parseFixture(raw, file);
  });
}
