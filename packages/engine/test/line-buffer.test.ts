import { describe, expect, it } from 'vitest';

import { LineBuffer } from '../src/line-buffer.js';

describe('LineBuffer', () => {
  it('vrátí kompletní řádek ukončený \\n', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it('drží řádek rozseknutý doprostřed, dokud nepřijde zbytek', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"type":"he')).toEqual([]);
    expect(buffer.push('llo"}\n')).toEqual(['{"type":"hello"}']);
  });

  it('vrátí víc řádků z jednoho chunku najednou', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('prvni\ndruhy\ntreti\n')).toEqual(['prvni', 'druhy', 'treti']);
  });

  it('kombinace: chunk dokončí starý řádek a načne nový', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('pul')).toEqual([]);
    expect(buffer.push('ka\ncely\nzacatek')).toEqual(['pulka', 'cely']);
    expect(buffer.push('\n')).toEqual(['zacatek']);
  });

  it('ostříhá \\r u CRLF konců řádků', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('prvni\r\ndruhy\r\n')).toEqual(['prvni', 'druhy']);
  });

  it('zvládne CRLF rozseknuté mezi chunky (\\r na konci prvního)', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('radek\r')).toEqual([]);
    expect(buffer.push('\ndalsi\r\n')).toEqual(['radek', 'dalsi']);
  });

  it('přeskakuje prázdné a whitespace-only řádky', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('\n\n  \n\t\r\nplny\n')).toEqual(['plny']);
  });

  it('flush vydá nedokončený zbytek při EOF bez \\n', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('posledni bez newline')).toEqual([]);
    expect(buffer.flush()).toBe('posledni bez newline');
  });

  it('flush vrací null, když zbytek není nebo je jen whitespace', () => {
    const empty = new LineBuffer();
    expect(empty.flush()).toBeNull();

    const whitespace = new LineBuffer();
    expect(whitespace.push('  ')).toEqual([]);
    expect(whitespace.flush()).toBeNull();
  });

  it('flush buffer vyprázdní – druhé volání už nic nevrací', () => {
    const buffer = new LineBuffer();
    buffer.push('zbytek');
    expect(buffer.flush()).toBe('zbytek');
    expect(buffer.flush()).toBeNull();
  });
});
