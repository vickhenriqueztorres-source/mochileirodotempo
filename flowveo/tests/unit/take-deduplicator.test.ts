import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoRepeatedTakesInTimeline,
  assertUniqueDownloadedTake,
  writeVerifiedConcatList,
} from '../../src/domain/media/take-deduplicator.js';

describe('take-deduplicator (Bloqueio Raiz contra Takes Repetidos)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowveo-dedup-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('aprova lista de takes 100% unicos por caminho e SHA-256', () => {
    const t1 = path.join(tmpDir, 'take_01.mp4');
    const t2 = path.join(tmpDir, 'take_02.mp4');
    const t3 = path.join(tmpDir, 'take_03.mp4');
    fs.writeFileSync(t1, 'video-payload-01');
    fs.writeFileSync(t2, 'video-payload-02');
    fs.writeFileSync(t3, 'video-payload-03');

    const concatOut = path.join(tmpDir, 'concat_list.txt');
    const res = writeVerifiedConcatList([t1, t2, t3], concatOut);
    expect(res.uniqueCount).toBe(3);
    expect(fs.existsSync(concatOut)).toBe(true);
  });

  it('bloqueia imediatamente quando um take do meio do video e repetido no inicio (Cold Open)', () => {
    const t1 = path.join(tmpDir, 'take_01.mp4');
    const t31 = path.join(tmpDir, 'take_31.mp4');
    const t43 = path.join(tmpDir, 'take_43.mp4');
    fs.writeFileSync(t1, 'video-payload-01');
    fs.writeFileSync(t31, 'video-payload-31');
    fs.writeFileSync(t43, 'video-payload-43');

    expect(() =>
      assertNoRepeatedTakesInTimeline([t31, t43, t1, t31, t43])
    ).toThrow(/BLOQUEIO DE TAKE REPETIDO NA TIMELINE/);
  });

  it('bloqueia quando dois takes com nomes diferentes possuem o mesmo conteudo binario SHA-256', () => {
    const t1 = path.join(tmpDir, 'take_01.mp4');
    const t2 = path.join(tmpDir, 'take_02.mp4');
    fs.writeFileSync(t1, 'mesmo-video-card-do-flow');
    fs.writeFileSync(t2, 'mesmo-video-card-do-flow');

    expect(() => assertNoRepeatedTakesInTimeline([t1, t2])).toThrow(
      /BLOQUEIO DE CONTEUDO DUPLICADO NA TIMELINE/
    );
  });

  it('rejeita e apaga no ato um download duplicado do Google Flow (assertUniqueDownloadedTake)', () => {
    const existing = path.join(tmpDir, 'take_01.mp4');
    const candidate = path.join(tmpDir, 'raw_flow_download.mp4');
    fs.writeFileSync(existing, 'bytes-do-card-1');
    fs.writeFileSync(candidate, 'bytes-do-card-1');

    expect(() =>
      assertUniqueDownloadedTake({
        candidatePath: candidate,
        targetTakeNumber: 2,
        takesDir: tmpDir,
      })
    ).toThrow(/BLOQUEIO DE TAKE REPETIDO NO DOWNLOAD/);
    expect(fs.existsSync(candidate)).toBe(false);
  });
});
