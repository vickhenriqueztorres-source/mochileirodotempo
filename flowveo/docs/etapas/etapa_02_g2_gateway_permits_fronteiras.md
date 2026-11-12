# Subetapa 02 (Gate G2) — Fronteiras Arquiteturais, Policy Engine, Permit Store e Safety Gateway

- **Gate:** `G2` — *Mutações sem permissão válida são impossíveis pelas APIs públicas*
- **Requisitos atendidos:** `OBJ-02`, `A-16`, `A-17`, `A-18`, `BC-04`, `BC-06`, `S-01`, `S-02`, `S-03`, `S-04` | Arquitetura §5, §6, §9, §10

---

## 1. Objetivo
Implementar a espinha dorsal de segurança *Fail-Closed*: separação estrita entre leitura (`FlowReader`), planejamento (`ActionPlanner`), autorização (`SafetyGateway` + `PolicyEngine` + `PermitStore`) e execução (`AuthorizedExecutor`). Garantir que toda mutação exija um `ExecutionPermit` persistido no SQLite, vinculado a `controllerEpoch`, `sessionEpoch`, `pageId`, `projectContextId`, `accountContextId`, `registryVersion`, `policyVersion`, digest de parâmetros e TTL monotônico, consumido atomicamente uma única vez (`ISSUED -> CLAIMED -> FINISHED`).

---

## 2. Passo a Passo de Implementação

### Passo 2.1 — Contratos e Classificação de Ações (`src/domain/actions/`, `src/flow/contracts.ts`)
- Definir modos de operação: `observe`, `bootstrap`, `explore`, `validate`, `dry-run`, `prepare`, `execute`, `reconcile`.
- Definir categorias estritas de ação (`ActionKind`): `READ`, `OPEN_UI`, `CONFIGURE`, `FILL`, `UPLOAD`, `SUBMIT`, `DOWNLOAD`, `LIFECYCLE`.
- Qualquer `ActionKind` fora do enum ou desconhecida é rejeitada imediatamente.
- Definir as 4 interfaces sem handles do Playwright: `FlowReader`, `ActionPlanner`, `SafetyGateway`, `AuthorizedExecutor`.

### Passo 2.2 — Policy Engine (`src/safety/policy-engine.ts`)
- Matriz de decisão *Fail-Closed* cruzando `OperationMode` x `ActionKind` x `releasePhase` (`A`, `B`, `C`) x status de validação da transição (`candidate`, `validated`, `invalidated`).
- Regra `A-18`: Na Release A, qualquer plano com `actionKind === 'SUBMIT'` é negado incondicionalmente, mesmo se `executionEnabled: true`.
- Em `observe` e `dry-run`, toda mutação de trabalho (`OPEN_UI`, `CONFIGURE`, `FILL`, `UPLOAD`, `SUBMIT`, `DOWNLOAD`) é negada e gera evento `action.denied`.

### Passo 2.3 — Permit Store e Janela de Corrida (`src/safety/permit-store.ts`)
- Persistência em `action_plans` e `execution_permits`.
- Cada permissão inclui: `permitId`, `nonce` único, `controllerEpoch`, `sessionEpoch`, `pageId`, `jobId`, `attemptId`, `submissionIntentId`, `actionKind`, `targetControlId`, `transitionId`, `paramsDigest`, `projectContextId`, `accountContextId`, `registryVersion`, `policyVersion`, `observedConfigDigest`, `observedRevision`, `issuedAt`, `expiresAt`, `monotonicIssuedAtNs`, `monotonicExpiresAtNs` e status (`ISSUED`, `CLAIMED`, `FINISHED`, `REVOKED`, `EXPIRED`).
- Transição atômica `claimPermit(permitId, currentContext)`:
  - Verifica se status === `ISSUED`.
  - Verifica relógio de parede (`Date.now() <= expiresAt`) **e** relógio monotônico (`process.hrtime.bigint() <= monotonicExpiresAtNs`) — protege contra adulteração de relógio do sistema.
  - Compara `controllerEpoch`, `sessionEpoch`, `pageId`, `projectContextId`, `accountContextId`, `registryVersion`, `policyVersion` e `observedConfigDigest`. Qualquer divergência revoga a permissão (`REVOKED`).
  - Atualiza atomicamente para `CLAIMED` (`UPDATE execution_permits SET status='CLAIMED' WHERE permit_id=? AND status='ISSUED'`). Se `changes !== 1`, lança `PermitAlreadyConsumedOrInvalidError`.
- No startup/restart, `revokeAllInFlightPermitsOnStartup()` invalida todas as permissões `ISSUED` e sinaliza quaisquer permissões `CLAIMED` interrompidas para reconciliação.

### Passo 2.4 — Safety Gateway e Authorized Executor (`src/safety/safety-gateway.ts`, `src/infrastructure/browser/authorized-executor.ts`)
- `SafetyGateway.authorize(plan)` valida plano, modo, contexto, mapa e política, grava o plano imutável e emite o `ExecutionPermit`.
- `AuthorizedExecutor.execute(permitId)` recebe **apenas** `permitId` (nunca recebe novo alvo ou payload por fora — Arquitetura §9), busca o plano imutável no banco, relê as invariantes críticas do `FlowDriver` antes da mutação (`S-03`), consome a permissão (`CLAIMED`), executa na fila serial e grava o outcome (`FINISHED`).

---

## 3. Baterias Obrigatórias de Teste (Gate G2)

1. **Testes Arquiteturais (`tests/architecture/g2-boundaries.test.ts`)**:
   - Scanner estático de AST/imports de todo `src/`:
     - Nenhum arquivo fora de `src/infrastructure/browser/` pode importar `playwright` ou `playwright-core`.
     - `src/domain/` não pode importar nada de `src/infrastructure/`.
     - `flow-driver.ts` não pode ser importado por `src/application/` ou `src/cli/`.
     - Nenhuma assinatura exportada fora de `src/infrastructure/browser/` contém `Page`, `Locator`, `BrowserContext` ou `ElementHandle`.
2. **Testes de Segurança (`tests/security/g2-permit-and-policy.test.ts`)**:
   - Tentativa de executar `OPEN_UI`, `FILL` ou `SUBMIT` em `observe` ou `dry-run` → bloqueado com evento `action.denied`.
   - Tentativa de reutilizar um `permitId` já `CLAIMED` ou `FINISHED` → bloqueado.
   - Mudança de `projectContextId`, `model`, `controllerEpoch`, `sessionEpoch`, `policyVersion` ou `registryVersion` entre `authorize()` e `execute()` → permissão revogada antes do clique (`S-03`).
3. **Testes de Caos (`tests/chaos/g2-clock-skew-and-crash.test.ts`)**:
   - Adulteração de relógio de parede para o passado enquanto o relógio monotônico avançou além do TTL → permissão expira corretamente.
   - Simulação de crash do processo imediatamente após `CLAIMED` → no reinício, a permissão não pode ser reutilizada e o evento de incerteza fica auditável.
4. **Testes de Estresse (`tests/stress/g2-concurrent-permit-claim.test.ts`)**:
   - 100 chamadas paralelas tentando executar o mesmo `permitId` simultaneamente → exatamente **1** transição `ISSUED -> CLAIMED` ocorre e **99** são rejeitadas deterministicamente.
