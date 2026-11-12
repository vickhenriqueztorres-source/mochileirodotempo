# Subetapa 07 (Gate G7) — Domínio de Jobs, Submission Ledger, Budget Guard Persistente e Reducers

- **Gate:** `G7` — *Ledger transacional, reserva persistente de limites e máquinas de estado passam em todos os crash tests locais*
- **Requisitos atendidos:** `OBJ-03`, `OBJ-04`, `BC-01`, `BC-05`, `BC-07`, `BC-09`, `BC-10`, `BC-11`, `BC-12`, `S-05` | Arquitetura §11, §12, §13, §16

---

## 1. Objetivo
Construir o modelo de domínio completo (`Job`, `JobAttempt`, `SubmissionIntent`, `RemoteSubmission`, `RemoteResult`, `Artifact`, `CompletionPolicy`), os reducers puros e auditáveis das 4 máquinas de estado independentes (Arquitetura §12), o `BudgetGuard` de limites persistentes que sobrevivem a reinícios e mantêm reservas quando o envio cai em `UNKNOWN`, e o `SubmissionLedger` transacional onde falha de banco antes do clique garante zero envio, e queda após `DISPATCHING` garante transição para `UNKNOWN` sem reenvio automático.

---

## 2. Passo a Passo de Implementação

### Passo 7.1 — Domínio e Cardinalidade (`src/domain/jobs/`, `src/domain/submissions/`, `src/domain/results/`)
- `Job`: `jobId` (UUID v4), `payloadVersion`, `prompt`, `promptDigest`, `model`, `aspectRatio`, `requestedOutputs` (explícito), `completionPolicy` (`minVerifiedOutputs`, `allowPartial`, `technicalRequirements`), `phase` (`PREFLIGHT..DONE`), `status` (`QUEUED..CANCELLED_LOCAL`), `pauseReason` (`AUTH | POLICY | UI_DRIFT | UNKNOWN_STATE | CONTROLLER_LOST | USER`).
- Regra `BC-01`: O texto do prompt nunca é usado como ID; dois jobs distintos podem ter o mesmo prompt e são rastreados separadamente.
- Cardinalidade `1 Job -> 0..N JobAttempts`, `1 Job -> 0..1 SubmissionIntent` (política inicial: uma única intenção de geração por job, sem regeneração automática — Arquitetura §11).

### Passo 7.2 — Máquinas de Estado e Reducers Determinísticos (`src/execution/state-reducers.ts`)
- Implementar transições estritas com validação de evidência:
  - `SubmissionIntent`:
    - `PLANNED -> RESERVED -> DISPATCHING -> CONFIRMED`
    - `DISPATCHING -> UNKNOWN -> RECONCILING -> CONFIRMED | NEEDS_REVIEW`
    - `PLANNED | RESERVED -> ABORTED` (proibido transitar de `DISPATCHING` ou `UNKNOWN` para `ABORTED` sem evidência provada de não-envio!).
  - `RemoteResult`: `OBSERVED`, `PROCESSING`, `READY`, `FAILED_REMOTE`, `UNKNOWN`.
    - Regra `BC-12`: permite avanço direto `OBSERVED -> READY` na retomada ao encontrar o resultado pronto na interface, sem inventar estados intermediários fictícios (`PROCESSING`).

### Passo 7.3 — Budget Guard Persistente (`src/safety/budget-guard.ts`)
- Controla separadamente no SQLite (`budget_reservations` e `usage_counters`):
  - `maxSubmissionsPerRun`, `maxSubmissionsPerWindow` (janela temporal persistida), `maxSubmissionsPerAccount`, `maxSubmissionsPerProject`.
  - `maxRequestedOutputsPerRun`, `maxActiveJobs`, espaço mínimo em disco e volume máximo de downloads (`S-05`).
- `reserveBudget(intentId, job)`: grava reserva durável **antes** de emitir permissão de `SUBMIT`.
- Se a intenção entrar em `UNKNOWN`, a reserva permanece **ativa e bloqueada** (`status: 'HELD_UNKNOWN'`) através de quantos reinícios ocorrerem (`BC-09`), até reconciliação explícita pelo operador. Jamais libera orçamento por timeout.

### Passo 7.4 — Submission Ledger (`src/execution/submission-ledger.ts`)
- Implementa os passos de banco do protocolo da Seção 13:
  1. `createIntentAndReserveBudget()` (em transação única: cria `SubmissionIntent(RESERVED)`, grava `BudgetReservation(RESERVED)` e evento).
  2. `markDispatchingBeforeClick()` (em transação confirmada **antes** da chamada ao navegador: muda para `DISPATCHING`).
  3. `confirmSubmission()` ou `markUnknownOnFailure()`.
- No startup, qualquer intenção encontrada em `DISPATCHING` (por crash ou `kill -9` durante o clique) é imediatamente convertida para `UNKNOWN` e o Job vai para `PAUSED (UNKNOWN_STATE)` exigindo reconciliação.

---

## 3. Baterias Obrigatórias de Teste (Gate G7)

1. **Testes Unitários (`tests/unit/g7-state-reducers-and-completion.test.ts`)**:
   - Proibição de transição `DISPATCHING -> ABORTED` ou `UNKNOWN -> PLANNED`.
   - Transição direta para `READY` na retomada sem `PROCESSING` fictício (`BC-12`).
   - Avaliação de `CompletionPolicy`: job que pediu 4 saídas e obteve 2 verificadas e 2 falhas remotas termina em `PARTIAL` (nunca `COMPLETED`).
2. **Testes de Segurança (`tests/security/g7-budget-survival-and-no-resubmit.test.ts`)**:
   - Reinício completo do banco/aplicação após atingir `maxSubmissionsPerRun: 1` ou com 1 intenção em `UNKNOWN` → nova tentativa de envio é bloqueada pelo `BudgetGuard` (`BC-09`).
3. **Testes de Caos (`tests/chaos/g7-submission-boundary-crashes.test.ts`)**:
   - Injeção de falha/crash em cada uma das 5 fronteiras do protocolo de envio:
     1. Falha no commit de `RESERVED` → **0 cliques** disparados.
     2. Crash entre `RESERVED` e `DISPATCHING` → abortado com segurança antes do clique.
     3. Crash exatamente após gravar `DISPATCHING` (antes do retorno do clique) → no startup vira `UNKNOWN`, mantém reserva de orçamento e **jamais reenvia**.
     4. Timeout do Playwright durante o clique de envio → vira `UNKNOWN`, zero retry de clique.
     5. Falha ao gravar `CONFIRMED` após o clique → cai para `UNKNOWN` para reconciliação segura.
4. **Testes de Estresse (`tests/stress/g7-concurrent-budget-reservations.test.ts`)**:
   - 50 jobs tentando reservar simultaneamente um orçamento com limite restante de `3` submissões → exatamente `3` reservas são aprovadas e `47` são negadas atomicamente no SQLite.
