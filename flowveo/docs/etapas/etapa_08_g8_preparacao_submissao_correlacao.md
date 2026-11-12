# Subetapa 08 (Gate G8) — Action Planner, Preparação Supervisionada, Envio Único e Correlação Remota

- **Gate:** `G8` — *Preparação composta por ações individualmente autorizadas, envio único com releitura final e correlação remota por evidência*
- **Requisitos atendidos:** `J05`, `BC-02`, `BC-03`, `BC-04`, `BC-07`, `BC-08`, `S-03` | Arquitetura §9, §13, §14

---

## 1. Objetivo
Implementar o `ActionPlanner`, o fluxo de `dry-run` (simulação completa sem tocar na página), o caso de uso composto `prepareCreation` (onde cada passo `OPEN_UI`, `CONFIGURE`, `FILL`, `UPLOAD` exige seu próprio plano e permissão no `SafetyGateway`), o protocolo completo de submissão única supervisionada (`execute` da Release B) com releitura final de todas as configurações antes do clique, e o motor de correlação remota (`CorrelationEngine`) que classifica o resultado como `CONFIRMED`, `AMBIGUOUS` ou `NOT_OBSERVED` considerando listagens parciais/virtualizadas.

---

## 2. Passo a Passo de Implementação

### Passo 8.1 — Action Planner e Dry-Run (`src/flow/action-planner.ts`)
- Recebe `ActionInput` + `ContextSnapshot` + `CreationSnapshot` e produz um `ActionPlan` determinístico vinculado ao `RegistryVersion` validado.
- Em modo `dry-run` (`flow run --dry-run`), gera e valida todos os planos contra o `PolicyEngine` e `BudgetGuard`, emitindo relatório do que faria, com **zero** chamadas ao `FlowDriver` (`BC-02`).

### Passo 8.2 — Preparação Composta Supervisionada (`src/application/execution-service.ts`)
- `prepareJob(jobId)` (`flow prepare <job-id>`):
  1. Planeja e executa `CONFIGURE` para o modelo solicitado → relê o modelo ativo na UI e confirma igualdade.
  2. Planeja e executa `CONFIGURE` para proporção/quantidade → relê e confirma.
  3. Planeja e executa `FILL` para o prompt → aguarda estabilização, relê o texto completo do campo e compara o SHA-256 com `job.promptDigest` (`BC-03`).
  4. Se houver imagem inicial (`startFrame`), planeja e executa `UPLOAD` → confirma ativo pronto.
  5. Calcula `observedConfigDigest` cobrindo `{ projectContextId, model, aspectRatio, requestedOutputs, promptDigest }`.

### Passo 8.3 — Protocolo de Submissão Única Supervisionada (Arquitetura §13)
1. Captura `BaselineSnapshot` dos resultados visíveis na página antes do envio, registrando explicitamente se a listagem é completa, paginada ou virtualizada (`isVirtualizedOrPartial`).
2. Executa `SubmissionLedger.createIntentAndReserveBudget()`.
3. Solicita permissão `SUBMIT` ao `SafetyGateway` vinculada ao `observedConfigDigest`.
4. **Revalidação Final Imediata (`S-03`, `BC-04`):** O `AuthorizedExecutor` relê projeto, modelo, proporção, quantidade e prompt imediatamente antes do clique. Se qualquer item divergir do `observedConfigDigest`, revoga a permissão e aborta antes de `DISPATCHING`.
5. Persiste `DISPATCHING` no SQLite, consome `CLAIMED` e executa **uma única** chamada de clique no botão de submissão homologado.
6. Nunca repete o clique em caso de timeout ou erro de rede (`BC-07`).

### Passo 8.4 — Motor de Correlação Remota (`src/execution/remote-reconciler.ts`)
- Avalia observações remotas pós-envio seguindo a ordem estrita da Seção 14:
  - **Nível 1 (`CONFIRMED`):** Identificador remoto estável observado no evento/card criado após o envio e ausente no baseline.
  - **Nível 2 (`CONFIRMED`):** Combinação homologada de evidências (novo item único surgido após baseline completo + parâmetros/timestamp compatíveis + exclusão comprovada de alternativas).
  - **`AMBIGUOUS` (vai para `NEEDS_REVIEW`):** Surgiram 2+ resultados candidatos compatíveis (ex.: geração manual concorrente ou dois cards idênticos) ou o baseline era parcial/virtualizado sem ID único estável.
  - **`NOT_OBSERVED`:** Nenhum novo item visível ainda (mantém `UNKNOWN` ou `AWAITING_RESULTS`; jamais assume que não enviou).
- Regra crítica: Prompt, posição na lista ou horário **isoladamente** nunca produzem `CONFIRMED`.

---

## 3. Baterias Obrigatórias de Teste (Gate G8)

1. **Testes Unitários (`tests/unit/g8-planner-and-correlation.test.ts`)**:
   - Prova que prompt igual isolado, posição #1 na lista isolada ou timestamp próximo isolado nunca retornam `CONFIRMED`.
   - Prova que listagem marcada como `isVirtualizedOrPartial: true` sem ID remoto único retorna `AMBIGUOUS` / `NEEDS_REVIEW` em vez de `CONFIRMED` falso.
2. **Testes de Segurança (`tests/security/g8-prepare-and-pre-submit-revalidation.test.ts`)**:
   - Dry-run executa todo o planejamento com 0 mutações na página.
   - Simulação de troca de modelo ou projeto na UI milissegundos antes do clique de `SUBMIT` → releitura final detecta divergência, revoga permissão e impede o envio (`BC-04`).
3. **Testes de Caos (`tests/chaos/g8-concurrent-manual-generation-and-ambiguity.test.ts`)**:
   - Dois resultados idênticos aparecem após o envio (simulando geração manual concorrente na mesma conta) → sistema classifica como `AMBIGUOUS` e coloca o Job em `NEEDS_REVIEW` sem baixar o arquivo errado.
   - Timeout de resposta após o clique de envio → sistema registra `submission.unknown`, preserva reserva de limite e faz **zero** novos cliques.
4. **Testes de Estresse (`tests/stress/g8-high-frequency-observations.test.ts`)**:
   - Processamento de 500 snapshots de observação remota progressiva (incluindo listas virtualizadas que mudam de janela de scroll) mantendo decisões de correlação 100% determinísticas.
