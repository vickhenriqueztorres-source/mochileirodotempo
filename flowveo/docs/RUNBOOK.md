# RUNBOOK — Guia Operacional e Resolução de Incidentes

## 1. Diagnóstico Inicial e Sessão
1. Executar `flow doctor` para validar Node, SQLite WAL, espaço livre em disco, diretórios `runtime/` e ausência de processos órfãos.
2. Executar `flow session open` e realizar login manual na janela dedicada do Google Flow.

## 2. Resolução de Estado `UNKNOWN` / `NEEDS_REVIEW`
- Quando um Job pausa com `pauseReason = 'UNKNOWN_STATE'` ou `status = 'NEEDS_REVIEW'`:
  - **Não** reenvie o Job manualmente sem antes inspecionar a página.
  - Execute `flow reconcile <job-id>` para que o `RemoteReconciler` compare o `BaselineSnapshot` com os itens visíveis na página.
  - Se o resultado já estiver pronto na UI, execute `flow resume <job-id>` para baixar e verificar o artefato sem nova geração.

## 3. Reconciliação de Artefatos e Limpeza de Staging
- Executar `flow artifacts reconcile` para:
  - Limpar arquivos `.part` incompletos em `runtime/downloads/staging`.
  - Identificar arquivos órfãos (`ORPHAN_FILE`) em `runtime/artifacts`.
  - Marcar como `MISSING` registros cujo arquivo físico foi removido externamente.

## 4. Reset do Circuit Breaker Persistido
- Se o `CircuitBreaker` abrir (`OPEN`) após falhas consecutivas ou erro crítico (`UI_DRIFT`, `UNKNOWN_STATE`):
  1. Corrija a causa raiz (revalide o mapa com `flow map validate` ou reconcilie o job incerto).
  2. Acione o reset explícito do `CircuitBreaker` informando o motivo auditável.
