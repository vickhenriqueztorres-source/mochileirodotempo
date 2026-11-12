import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('Gate G2 — Architecture: Strict Module Boundaries & Zero Playwright Leakage (§5, S-01)', () => {
  const srcRoot = path.resolve(process.cwd(), 'src');
  const allSrcFiles = listTsFiles(srcRoot);

  it('somente infrastructure/browser pode importar playwright ou playwright-core', () => {
    for (const file of allSrcFiles) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
      if (rel.startsWith('infrastructure/browser/')) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const hasPlaywrightImport =
        /from\s+['"]@?playwright/i.test(content) ||
        /require\s*\(\s*['"]@?playwright/i.test(content);
      expect(
        hasPlaywrightImport,
        `Arquivo '${rel}' fora de infrastructure/browser importou Playwright!`
      ).toBe(false);
    }
  });

  it('domain nunca importa modulos de infrastructure', () => {
    const domainFiles = listTsFiles(path.join(srcRoot, 'domain'));
    for (const file of domainFiles) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf-8');
      expect(
        /from\s+['"][^'"]*infrastructure\//.test(content),
        `Arquivo de dominio '${rel}' importou camada de infrastructure!`
      ).toBe(false);
    }
  });

  it('application e cli nunca importam flow-driver diretamente', () => {
    const appAndCliFiles = [
      ...listTsFiles(path.join(srcRoot, 'application')),
      ...listTsFiles(path.join(srcRoot, 'cli')),
    ];
    for (const file of appAndCliFiles) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf-8');
      expect(
        /flow-driver/.test(content),
        `Arquivo '${rel}' importou flow-driver diretamente!`
      ).toBe(false);
    }
  });

  it('contratos publicos fora de infrastructure/browser nao expoem Page, Locator, BrowserContext ou ElementHandle', () => {
    for (const file of allSrcFiles) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
      if (rel.startsWith('infrastructure/browser/')) continue;

      const content = fs
        .readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(
        /\b(BrowserContext|ElementHandle|FrameLocator)\b/.test(content),
        `Arquivo '${rel}' referencia tipos internos do Playwright!`
      ).toBe(false);
    }
  });
});
