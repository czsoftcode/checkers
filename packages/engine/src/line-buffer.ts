/**
 * Řádkový buffer nad streamem chunků.
 *
 * `data` event stdin NEgarantuje zarovnání na řádky: chunk může nést půlku
 * řádku i tři řádky najednou. Buffer skládá chunky a emituje jen kompletní
 * řádky; nedokončený zbytek drží do dalšího chunku (nebo do `flush()` při
 * EOF). Čistá třída bez I/O.
 *
 * Předpoklad: chunky jsou stringy (volající použije `setEncoding('utf8')`,
 * který korektně řeší vícebajtové znaky rozseknuté mezi chunky – tady se to
 * znovu neřeší).
 */
export class LineBuffer {
  private rest = '';

  /**
   * Přidá chunk a vrátí kompletní řádky, které tím vznikly (bez `\n`,
   * s ostříhaným `\r` – funguje pro LF i CRLF). Prázdné a whitespace-only
   * řádky se zahazují.
   */
  push(chunk: string): string[] {
    this.rest += chunk;
    const parts = this.rest.split('\n');
    // split vrací vždy aspoň jeden prvek; poslední je nedokončený zbytek
    this.rest = parts.pop() ?? '';
    return parts.map(stripTrailingCr).filter((line) => line.trim() !== '');
  }

  /**
   * Vydá nedokončený zbytek po konci streamu (EOF bez závěrečného `\n`),
   * nebo `null`, když žádný smysluplný zbytek není. Buffer se vyprázdní.
   */
  flush(): string | null {
    const line = stripTrailingCr(this.rest);
    this.rest = '';
    return line.trim() === '' ? null : line;
  }
}

function stripTrailingCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
