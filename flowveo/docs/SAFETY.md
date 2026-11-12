# SAFETY — Garantias e Fronteiras Fail-Closed do Flow Automation

## 1. Regra Central (Fail-Closed)
Nenhuma mutação na página é executada quando identidade, contexto, política, alvo, versão do mapa ou pós-condição esperada forem ambíguos.

## 2. Fronteira de Isolamento do Navegador
- Somente `src/infrastructure/browser/` pode importar tipos ou pacotes `playwright` / `@playwright/test`.
- `Page`, `Locator`, `BrowserContext` e `ElementHandle` jamais escapam para `src/application/`, `src/domain/`, `src/mapping/` ou `src/cli/`.
- Leituras ocorrem via `FlowReader` (retornando snapshots serializáveis validados por Zod); mutações exigem `ExecutionPermit` emitido pelo `SafetyGateway` e consumido atomicamente (`ISSUED -> CLAIMED`) pelo `AuthorizedExecutor`.

## 3. Permissões Descartáveis (Single-Use Permits)
- Cada mutação individual exige um `ExecutionPermit` com `nonce` único, `controllerEpoch`, `sessionEpoch`, `pageId`, `observedRevision`, `observedConfigDigest`, `expiresAtMs` (wall-clock) e `monotonicExpiresNs` (`process.hrtime.bigint()`).
- Qualquer divergência na releitura imediata pré-mutação revoga a permissão (`REVOKED`) antes de tocar no DOM.

## 4. Proteção contra Reenvio Indevido e Estouro de Limites
- Intenção (`SubmissionIntent`) e reserva de orçamento (`BudgetReservation`) são gravadas em transação SQLite `WAL` (`synchronous=FULL`) **antes** do clique de submissão (`BC-05`).
- Qualquer falha após `DISPATCHING` transita a intenção para `UNKNOWN` e mantém a reserva `HELD_UNKNOWN` ativa indefinidamente até reconciliação explícita (`BC-07`, `BC-09`).
- Falha de download aciona retry apenas de `DOWNLOAD` sobre o mesmo `remoteResultId`, **jamais** criando nova `SubmissionIntent` (`BC-16`).
