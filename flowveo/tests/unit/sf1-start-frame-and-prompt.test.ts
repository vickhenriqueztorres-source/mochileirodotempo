import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildFlowMotionPromptFromStartFrame,
  FLOW_CONTINUITY_ANCHOR_POV,
} from '../../src/domain/media/flow-motion-prompt.js';
import { StartFrameValidator } from '../../src/domain/media/start-frame-validator.js';
import { ConfigValidationError, PolicyDeniedError } from '../../src/shared/errors.js';

function makeMinimalValidPngHeaderBuffer(width: number, height: number, extraPayload = ''): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  const padding = Buffer.alloc(128, `start-frame-payload-${extraPayload}`);
  return Buffer.concat([signature, ihdrLen, ihdrType, ihdrData, padding]);
}

describe('Subetapa SF-1 — StartFrameValidator & FlowMotionPrompt (Unit, Security, Chaos, Zero-Reuse)', () => {
  it('valida PNG 16:9 (1920x1080) e 9:16 (1080x1920) reais e calcula SHA-256 unico', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sf1-'));
    try {
      const p16x9 = path.join(tmpDir, 'p01_pov_16x9.png');
      const p9x16 = path.join(tmpDir, 'p02_pov_9x16.png');
      fs.writeFileSync(p16x9, makeMinimalValidPngHeaderBuffer(1920, 1080, 'scene-1'));
      fs.writeFileSync(p9x16, makeMinimalValidPngHeaderBuffer(1080, 1920, 'scene-2'));

      const usedHashes = new Set<string>();
      const validator = new StartFrameValidator({
        allowedBaseDir: tmpDir,
        isSha256AlreadyUsed: (sha) => usedHashes.has(sha),
      });

      const res169 = validator.validateStartFrame({
        relativeOrFilePath: 'p01_pov_16x9.png',
        expectedAspectRatio: '16:9',
        enforceUniqueSha256: true,
      });
      expect(res169.format).toBe('png');
      expect(res169.width).toBe(1920);
      expect(res169.height).toBe(1080);
      expect(res169.aspectRatio).toBe('16:9');
      expect(res169.sha256).toHaveLength(64);
      usedHashes.add(res169.sha256);

      // Politica Zero-Reuso: tentar reutilizar o mesmo Start Frame deve falhar com PolicyDeniedError
      expect(() =>
        validator.validateStartFrame({
          relativeOrFilePath: 'p01_pov_16x9.png',
          expectedAspectRatio: '16:9',
          enforceUniqueSha256: true,
        })
      ).toThrow(PolicyDeniedError);

      const res916 = validator.validateStartFrame({
        relativeOrFilePath: 'p02_pov_9x16.png',
        expectedAspectRatio: '9:16',
        enforceUniqueSha256: true,
      });
      expect(res916.aspectRatio).toBe('9:16');
      expect(res916.width).toBe(1080);
      expect(res916.height).toBe(1920);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('bloqueia tentativas de Path Traversal, caminhos absolutos, magic bytes falsos e proporcoes trocadas', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sf1-sec-'));
    try {
      const validator = new StartFrameValidator({ allowedBaseDir: tmpDir });

      for (const badPath of [
        '../../Windows/System32/cmd.exe',
        '../escape.png',
        'C:\\Windows\\win.ini',
        '/etc/passwd',
        'sub/../../secret.png',
      ]) {
        expect(() =>
          validator.validateStartFrame({
            relativeOrFilePath: badPath,
            expectedAspectRatio: '16:9',
          })
        ).toThrow(PolicyDeniedError);
      }

      // Arquivo .txt disfarcado de .png
      const fakePng = path.join(tmpDir, 'fake.png');
      fs.writeFileSync(fakePng, 'this is plain text pretending to be a png image with more than 64 bytes of data');
      expect(() =>
        validator.validateStartFrame({
          relativeOrFilePath: 'fake.png',
          expectedAspectRatio: '16:9',
        })
      ).toThrow(ConfigValidationError);

      // Imagem quadrada 1024x1024 rejeitada quando se exige 16:9
      const sqPng = path.join(tmpDir, 'square.png');
      fs.writeFileSync(sqPng, makeMinimalValidPngHeaderBuffer(1024, 1024, 'sq'));
      expect(() =>
        validator.validateStartFrame({
          relativeOrFilePath: 'square.png',
          expectedAspectRatio: '16:9',
        })
      ).toThrow(/Exigido 16:9 ou 9:16/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('higieniza termos sensiveis e injeta ancora de continuidade POV no prompt de movimento do Flow', () => {
    const built = buildFlowMotionPromptFromStartFrame({
      rawMotionPrompt:
        'First-person POV 24mm camera moves forward as the monster strikes the stone wall with blood and horror',
    });

    expect(built.sanitizedReplacementsApplied).toBeGreaterThanOrEqual(4);
    expect(built.promptText).not.toMatch(/\b(monster|strikes|blood|horror)\b/i);
    expect(built.promptText).toContain('colossal figure');
    expect(built.promptText).toContain('dark soot');
    expect(built.promptText).toContain(FLOW_CONTINUITY_ANCHOR_POV);
    expect(built.promptDigestSha256).toHaveLength(64);
  });
});
