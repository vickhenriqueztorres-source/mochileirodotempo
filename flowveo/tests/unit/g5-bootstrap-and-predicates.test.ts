import { describe, expect, it } from 'vitest';
import { LocatorSpecSchema, PredicateSpecSchema } from '../../src/mapping/passive-discovery.js';

describe('Gate G5 — Unit: LocatorSpec & PredicateSpec Runtime Schemas (§8.3, A-12)', () => {
  it('rejeita seletores que tentem usar :first, :nth, first() ou nth() para esconder duplicidade (A-12)', () => {
    expect(() =>
      LocatorSpecSchema.parse({
        strategy: 'css',
        containerId: 'composer',
        css: 'button.generate:first-child',
      })
    ).toThrow(/Proibido usar first\(\) ou nth\(\)/);

    expect(() =>
      LocatorSpecSchema.parse({
        strategy: 'css',
        containerId: 'composer',
        css: 'div.item >> nth(0)',
      })
    ).toThrow(/Proibido usar first\(\) ou nth\(\)/);
  });

  it('valida LocatorSpec e PredicateSpec tipados sem funcoes arbitrarias', () => {
    const loc = LocatorSpecSchema.parse({
      strategy: 'role_name',
      containerId: 'composer',
      role: 'button',
      name: 'Model Selector',
    });
    expect(loc.strategy).toBe('role_name');

    const pred = PredicateSpecSchema.parse({
      kind: 'menu_open_in_container',
      containerId: 'composer',
      targetControlId: 'ctrl_model_btn',
    });
    expect(pred.kind).toBe('menu_open_in_container');
  });
});
