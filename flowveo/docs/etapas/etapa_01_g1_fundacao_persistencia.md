# Subetapa 01 (Gate G1) — Fundação, Configuração Estrita, SQLite WAL e Observabilidade Sanitizada

- **Gate:** `G1` — *Falhas locais de persistência ou sanitização bloqueiam qualquer ação*
- **Requisitos atendidos:** `A-01`, `S-06`, `S-07` | Arquitetura §4, §15, §19, §21

---

## 1. Objetivo
Estabelecer o esqueleto TypeScript estrito (`flow-automation`), validação de configuração via Zod (rejeitando campos desconhecidos com `.strict()`), motor de banco SQLite transacional (`journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`), migração inicial com as **20 tabelas obrigatórias** da Arquitetura §15, fila de escrita serializada com bloqueio de mutações em caso de erro de IO/disco cheio, e pipeline de observabilidade com `Redactor` e `EvidenceRecorder` que descarta evidências caso a sanitização falhe.

---

## 2. Passo a Passo de Implementação

### Passo 1.1 — Configuração de Projeto e Compilação Estrita
- Criar `package.json`, `tsconfig.json` (`strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`), `vitest.config.ts`, `.gitignore` (excluindo `runtime/`, `.env`, `*.db*`, `traces/`, `screenshots/`) e `.env.example`.
- Criar `config/defaults.json` e `config/policy.json` seguindo a Seção 21 da Arquitetura (`mode: "observe"`, `executionEnabled: false`, `maxConcurrentJobs: 1`, `maxSubmissionsPerRun: 1`, `allowAutomaticResubmission: false`, etc.).

### Passo 1.2 — Validação de Configuração e Política (`src/shared/config-schema.ts`)
- Definir `AppConfigSchema` e `PolicyConfigSchema` com `zod` usando `.strict()` (qualquer chave desconhecida ou ausente falha no startup — `A-01`).
- Implementar trava de Release A: mesmo que um arquivo de configuração tente passar `executionEnabled: true` quando `releasePhase === 'A'`, o validador força bloqueio ou rejeita aumento de privilégio via flags CLI.

### Passo 1.3 — Motor SQLite Transacional e 20 Tabelas (`src/infrastructure/persistence/`)
- Implementar `database.ts` encapsulando o banco SQLite com:
  - Verificação efetiva dos PRAGMAs no startup (`journal_mode = WAL`, `synchronous = FULL` ou `NORMAL` verificável, `foreign_keys = ON`, `busy_timeout = 5000`).
  - Fila serial de escrita (`writeTransaction<T>(fn: () => T): T`) que garante transações curtas e atômicas (estado + evento na mesma transação).
  - Flag `mutationBlocked` acionada imediatamente se ocorrer `SQLITE_FULL`, `SQLITE_IOERR`, `SQLITE_CORRUPT` ou falha de migração (`S-06`).
- Criar `migrations/001_initial_schema.sql` contendo todas as **20 tabelas** da Seção 15:
  1. `policy_versions`
  2. `operator_approvals`
  3. `controller_leases`
  4. `mapping_scopes`
  5. `registry_versions`
  6. `controls`
  7. `transitions`
  8. `jobs`
  9. `job_attempts`
  10. `submission_intents`
  11. `remote_submissions`
  12. `remote_results`
  13. `remote_observations`
  14. `correlation_decisions`
  15. `action_plans`
  16. `execution_permits`
  17. `events`
  18. `checkpoints`
  19. `artifacts`
  20. `artifact_links`
  21. `budget_reservations`
  22. `usage_counters`
- Implementar backup automático do arquivo `.db` antes de aplicar novas migrações.

### Passo 1.4 — Redactor, Logger e Evidence Recorder (`src/infrastructure/observability/`)
- `redactor.ts`: Sanitiza recursivamente objetos, strings, URLs e HTML/DOM, removendo cookies (`SID`, `HSID`, `SSID`, `__Secure-*`), `Bearer` tokens, `Authorization` headers, `storageState`, credenciais e substituindo prompts brutos por `{ digestSha256, length }` por padrão (`S-07`).
- Se o `Redactor` encontrar erro ou falhar ao sanitizar uma estrutura cíclica/corrompida, lança `SanitizationFailureError` e **descarta a evidência** (nunca salva bruto como fallback).
- `logger.ts` e `evidence-recorder.ts`: Registram os eventos mínimos (`action.planned`, `action.denied`, `permit.claimed`, `action.observed`, `submission.unknown`, `correlation.decided`, `artifact.verified`) sempre com `eventId`, `correlationId`, `controllerEpoch`, `policyVersion`, `registryVersion` e `reason`.

---

## 3. Baterias Obrigatórias de Teste (Gate G1)

1. **Testes Unitários (`tests/unit/g1-config-and-schema.test.ts`)**:
   - Rejeição de chaves desconhecidas, tipos incorretos, diretórios inválidos e flags que tentem elevar permissões acima da política.
   - Verificação das 20+ tabelas criadas e constraints de chave estrangeira/unicidade.
2. **Testes de Segurança (`tests/security/g1-redaction-leak.test.ts`)**:
   - Injeção de payloads contendo cookies Google (`__Secure-1PSID`), `Authorization: Bearer ya29...`, `storageState`, query strings com `token=`, `api_key=` e prompts pessoais.
   - Verificação de que nenhum segredo aparece nos logs ou na tabela `events`.
   - Teste de falha forçada no sanitizador provando que a evidência é descartada (`0 bytes` gravados) e nunca persistida em bruto.
3. **Testes de Caos (`tests/chaos/g1-persistence-failures.test.ts`)**:
   - Simulação de `SQLITE_FULL` (disco cheio), `SQLITE_BUSY` e erro de I/O no meio de uma transação: provar rollback atômico (nem estado nem evento gravados) e ativação imediata do bloqueio global de novas mutações (`isMutationBlocked() === true`).
4. **Testes de Estresse (`tests/stress/g1-sqlite-write-queue.test.ts`)**:
   - Disparo de 500 transações concorrentes de gravação de estado + eventos auditáveis verificando ordenação determinística, zero corrupção e integridade de sequência.
