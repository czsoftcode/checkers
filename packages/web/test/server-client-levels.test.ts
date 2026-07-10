import { describe, expect, it } from 'vitest';

import { LEVELS } from '@checkers/ai';
import { GAME_LEVELS } from '../src/server-client.js';

/**
 * Zub proti driftu úrovní mezi `@checkers/ai` (JEDINÝ zdroj pravdy o množině
 * úrovní) a webovým `GAME_LEVELS` (táž množina, ale v UI pořadí
 * professional-first). Test hlídá, že jde o PERMUTACI – stejnou množinu, jen
 * jinak seřazenou. Přidání/odebrání úrovně na jedné straně (nebo překlep) tady
 * padne, ne tiše: server by pak neznámou úroveň odmítl 400 a UI by nabídlo
 * úroveň, kterou engine neumí.
 *
 * `satisfies readonly GameLevel[]` v server-client.ts pokrývá jen jeden směr
 * (každý web-side prvek je platná úroveň); tenhle test dorovnává druhý (žádná
 * úroveň z `@checkers/ai` v webovém seznamu nechybí) i unikátnost obou stran.
 */
describe('GAME_LEVELS vs @checkers/ai LEVELS', () => {
  it('je permutací (stejná množina, jiné pořadí)', () => {
    expect([...GAME_LEVELS].sort()).toEqual([...LEVELS].sort());
  });

  it('web pořadí je ZÁMĚRNĚ jiné než @checkers/ai (professional-first vs championship-first)', () => {
    // Ne rovnost pořadí: UI default (první prvek) musí být professional, kdežto
    // @checkers/ai řadí championship-first. Kdyby se pořadí srovnalo, byl by to
    // signál, že někdo omylem převzal AI pořadí a rozbil UI default.
    expect(GAME_LEVELS[0]).toBe('professional');
    expect([...GAME_LEVELS]).not.toEqual([...LEVELS]);
  });

  it('žádná strana nemá duplicitu', () => {
    expect(new Set(GAME_LEVELS).size).toBe(GAME_LEVELS.length);
    expect(new Set(LEVELS).size).toBe(LEVELS.length);
  });
});
