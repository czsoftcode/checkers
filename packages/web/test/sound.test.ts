// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createSoundPlayer } from '../src/sound.js';
import type { SoundNode } from '../src/sound.js';
// Stejná URL, jakou modul mapuje na událost 'move'. Kdyby se mapa v sound.ts
// rozbila (jiný/žádný zdroj), asserty na `src` níže padnou – test má zuby.
import moveUrl from '../src/assets/pohyb_kamene.mp3?url';
import landUrl from '../src/assets/dopad_kamene.mp3?url';
import winUrl from '../src/assets/vitezne_fanfary.mp3?url';
import lossUrl from '../src/assets/zvuk_prohry.mp3?url';
import drawUrl from '../src/assets/zvuk_remizy.mp3?url';

/** Fake audio uzel: zaznamená hlasitost a počet přehrání, `play` je konfigurovatelné. */
class FakeNode implements SoundNode {
  volume = 1;
  playCalls = 0;
  constructor(
    public readonly src: string,
    private readonly result: Promise<void> | void = undefined,
  ) {}
  play(): Promise<void> | void {
    this.playCalls++;
    return this.result;
  }
}

/** Továrna, která si pamatuje všechny vytvořené uzly. */
function recordingFactory(result: () => Promise<void> | void = () => undefined): {
  factory: (src: string) => SoundNode;
  created: FakeNode[];
} {
  const created: FakeNode[] = [];
  const factory = (src: string): SoundNode => {
    const node = new FakeNode(src, result());
    created.push(node);
    return node;
  };
  return { factory, created };
}

describe('createSoundPlayer', () => {
  it('bez Audio (audioFactory null) je play i unlock bezpečný no-op', () => {
    const player = createSoundPlayer(null);
    // Nesmí spadnout ani se pokusit cokoli přehrát.
    expect(() => {
      player.unlock();
      player.play('move');
    }).not.toThrow();
  });

  it("play('move') sáhne na správný zdroj a přehraje ho", () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.play('move');

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(moveUrl);
    expect(created[0]?.playCalls).toBe(1);
  });

  it("play('land') sáhne na zvuk dopadu (jiný zdroj než 'move')", () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.play('land');

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(landUrl);
    expect(created[0]?.playCalls).toBe(1);
    // Pojistka, že rozjezd a dopad nejsou omylem tentýž soubor.
    expect(landUrl).not.toBe(moveUrl);
  });

  it('konec partie: win, loss a draw míří na svoje zdroje (a jsou různé)', () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.play('win');
    player.play('loss');
    player.play('draw');

    expect(created[0]?.src).toBe(winUrl);
    expect(created[1]?.src).toBe(lossUrl);
    expect(created[2]?.src).toBe(drawUrl);
    // Pět různých zvuků – žádné dva event nesdílejí omylem soubor.
    expect(new Set([moveUrl, landUrl, winUrl, lossUrl, drawUrl]).size).toBe(5);
  });

  it("play('draw') sáhne na zvuk remízy a přehraje ho", () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.play('draw');

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(drawUrl);
    expect(created[0]?.playCalls).toBe(1);
  });

  it('každé přehrání vytvoří NOVÝ uzel (překrývání rychlých dopadů)', () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.play('move');
    player.play('move');
    player.play('move');

    // Tři samostatné uzly, ne jeden recyklovaný – rychlý řetěz se nezařízne.
    expect(created).toHaveLength(3);
    expect(new Set(created).size).toBe(3);
    for (const node of created) {
      expect(node.playCalls).toBe(1);
    }
  });

  it('unlock probudí audio ztlumeně a jen JEDNOU (idempotence)', () => {
    const { factory, created } = recordingFactory();
    const player = createSoundPlayer(factory);

    player.unlock();
    player.unlock();
    player.unlock();

    expect(created).toHaveLength(1);
    expect(created[0]?.volume).toBe(0); // probuzení je neslyšné
    expect(created[0]?.playCalls).toBe(1);
  });

  it('zamítnutý autoplay (odmítnutý příslib) neshodí přehrávač', async () => {
    // play() vrací zamítnutý příslib jako prohlížeč při blokovaném autoplay.
    const rejected = (): Promise<void> => Promise.reject(new Error('autoplay blocked'));
    const { factory } = recordingFactory(rejected);
    const player = createSoundPlayer(factory);

    expect(() => {
      player.play('move');
    }).not.toThrow();
    // Nech případné mikroúlohy doběhnout – nesmí vzniknout neošetřené zamítnutí.
    await Promise.resolve();
  });

  it('synchronní výjimka z play() (jsdom „Not implemented") se spolkne', () => {
    const throwing = (): SoundNode => ({
      volume: 1,
      play: () => {
        throw new Error('Not implemented: HTMLMediaElement.prototype.play');
      },
    });
    const player = createSoundPlayer(throwing);
    expect(() => {
      player.play('move');
    }).not.toThrow();
  });
});
