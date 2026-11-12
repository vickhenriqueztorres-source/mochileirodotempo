# Subetapa 10 (Gate G10) — Orquestrador de Lote Serial, Circuit Breaker Persistido, Documentação Operacional e Aceite Final (Release C)

- **Gate:** `G10` — *Execução serial de lote pequeno com circuit breaker e guardrails preservados entre reinícios; Documentação e Definition of Done 100% cumpridos*
- **Requisitos atendidos:** `OBJ-07`, `BC-17`, `BC-18` | Arquitetura §20, §22, §25, §26 | PRD §20, §21

---

## 1. Objetivo
Implementar o `JobOrchestrator` para execução estritamente serial de lotes pequenos (`maxConcurrentJobs: 1`), o **Circuit Breaker Persistido** no SQLite que abre após `N` falhas consecutivas e sobrevive a reinícios do processo, o tratamento de `CANCELLED_LOCAL` (que interrompe ações locais mas preserva o ledger e a reconciliação da possível geração remota — `BC-17`), a CLI completa de 18 comandos, os 4 documentos operacionais exigidos na árvore da Seção 4 (`SAFETY.md`, `MAPPING-PROTOCOL.md`, `STATE-MACHINES.md`, `RUNBOOK.md`) e a suíte integrada End-to-End das Releases A, B e C.

---

## 2. Passo a Passo de Implementação

### Passo 10.1 — Circuit Breaker Persistido (`src/safety/circuit-breaker.ts`)
- Mantém estado durável no SQLite (`CLOSED`, `OPEN`, `HALF_OPEN`) com contador de falhas consecutivas, motivo da abertura e timestamp.
- Abre automaticamente quando ocorrem `maxConsecutiveFailures` (ex.: 3 falhas seguidas de drift, timeout ou erro de pós-condição) ou imediatamente em falha crítica (`UNKNOWN_STATE`, `UI_DRIFT`, `AUTH`).
- Reiniciar o processo **não** fecha um Circuit Breaker `OPEN`: exige comando explícito de inspeção/reconciliação do operador.

### Passo 10.2 — Job Orchestrator Serial e Cancelamento Local Seguro (`src/execution/job-orchestrator.ts`)
- Executa fila de jobs de forma estritamente serial (`maxConcurrentJobs === 1` — `BC-18`), compartilhando o mesmo `ControllerLock`, `BudgetGuard` e `CircuitBreaker`.
- Antes de iniciar o próximo job do lote:
  - Verifica `StopController`, `CircuitBreaker`, `BudgetGuard` (`maxSubmissionsPerRun`, `maxRequestedOutputsPerRun`) e saúde da sessão.
  - Se o job anterior terminou em `UNKNOWN` ou `PAUSED`, interrompe o lote imediatamente (`stopOnUnknownState: true`).
- `cancelJobLocally(jobId)` (`BC-17`):
  - Marca o Job como `CANCELLED_LOCAL`.
  - Se já havia uma `SubmissionIntent` em `DISPATCHING`, `UNKNOWN` ou `CONFIRMED`, **preserva** a intenção, a reserva de orçamento e a capacidade de rodar `flow reconcile <job-id>` (pois cancelar localmente não cancela a geração nos servidores do Google Flow).

### Passo 10.3 — Documentação Operacional Obrigatória (`docs/`)
- Criar na pasta `docs/`:
  1. `docs/SAFETY.md`: Fronteiras de segurança, matriz de modos x ações, protocolo de permissões descartáveis e garantias *fail-closed*.
  2. `docs/MAPPING-PROTOCOL.md`: Guia passo a passo de observação passiva, bootstrap supervisionado, validação de pós-condições e tratamento de drift.
  3. `docs/STATE-MACHINES.md`: Diagramas e tabelas de transição de `Job`, `SubmissionIntent`, `RemoteResult`, `Artifact` e `ExecutionPermit`.
  4. `docs/RUNBOOK.md`: Procedimentos operacionais para login manual, diagnóstico (`doctor`), resolução de `UNKNOWN`, recuperação de crash, limpeza de staging, backup do SQLite WAL e reset de circuit breaker.

---

## 3. Baterias Obrigatórias de Teste (Gate G10)

1. **Testes Unitários (`tests/unit/g10-batch-and-circuit-breaker.test.ts`)**:
   - Verifica que `cancelJobLocally` não apaga `SubmissionIntent` nem libera `BudgetReservation` de envio já disparado (`BC-17`).
   - Verifica abertura do `CircuitBreaker` após falhas consecutivas e persistência do estado `OPEN` após fechar e reabrir a conexão do banco.
2. **Testes de Segurança (`tests/security/g10-batch-guardrails-across-restarts.test.ts`)**:
   - Lote de 5 jobs com `maxSubmissionsPerRun: 2` → executa exatamente 2 jobs e bloqueia os 3 seguintes.
   - Simulação de reinício do processo após o 2º job com limite por janela temporal esgotado → 3º job continua bloqueado após o restart (`BC-09`, `BC-18`).
3. **Testes de Caos (`tests/chaos/g10-batch-midway-unknown-and-partial.test.ts`)**:
   - Lote de 3 jobs onde o Job #1 sofre timeout pós-clique (`UNKNOWN`) → `stopOnUnknownState: true` para imediatamente o lote, deixando os Jobs #2 e #3 intocados em `QUEUED` com 0 cliques extras.
   - Job com `requestedOutputs: 3` onde 2 vídeos baixam e verificam (`VERIFIED`) e 1 falha remotamente (`FAILED_REMOTE`) → job fecha em `PARTIAL` (nunca `COMPLETED`).
4. **Testes de Estresse e Aceite End-to-End (`tests/stress/g10-full-lifecycle-e2e.test.ts`)**:
   - Execução completa do ciclo de vida (Gates `G1` a `G10`): `doctor` -> `observe` -> `bootstrap` -> `explore` -> `validate` -> `dry-run` -> `prepare` -> `execute` -> `reconcile` -> `artifacts reconcile` sob injeção combinada de latência, hidratação atrasada e retomada pós-crash, validando 100% dos critérios do Definition of Done (Arquitetura §26 e PRD §21).
