import type { ActionKind } from '../actions/action-types.js';
import type { OperationMode, ReleasePhase } from '../../shared/config-schema.js';

/**
 * Matriz estrita de permissoes por Modo de Operacao (Arquitetura §6).
 * Qualquer acao fora da lista permitida para o modo e bloqueada (Fail-Closed).
 */
export const MODE_ALLOWED_ACTIONS: Readonly<Record<OperationMode, ReadonlySet<ActionKind>>> = {
  observe: new Set<ActionKind>(['READ']),
  bootstrap: new Set<ActionKind>(['READ', 'OPEN_UI', 'CONFIGURE', 'FILL', 'UPLOAD']),
  explore: new Set<ActionKind>(['READ', 'OPEN_UI', 'CONFIGURE', 'FILL', 'UPLOAD']),
  validate: new Set<ActionKind>(['READ', 'OPEN_UI', 'CONFIGURE', 'FILL']),
  'dry-run': new Set<ActionKind>(['READ']),
  prepare: new Set<ActionKind>(['READ', 'OPEN_UI', 'CONFIGURE', 'FILL', 'UPLOAD']),
  execute: new Set<ActionKind>([
    'READ',
    'OPEN_UI',
    'CONFIGURE',
    'FILL',
    'UPLOAD',
    'SUBMIT',
    'DOWNLOAD',
  ]),
  reconcile: new Set<ActionKind>(['READ', 'DOWNLOAD']),
};

export function isActionAllowedInRelease(action: ActionKind, releasePhase: ReleasePhase): boolean {
  // Regra A-18: Na Release A, SUBMIT nunca e permitido por nenhum caminho
  if (releasePhase === 'A' && action === 'SUBMIT') {
    return false;
  }
  return true;
}
