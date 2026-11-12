# Arquitetura — Automação local segura do Google Flow

- **Versão:** 1.0 — especificação de implementação
- **Stack:** TypeScript estrito + Playwright + SQLite
- **Status:** projeto proposto; seletores, caminhos e correlação remota pendentes de homologação no navegador real.

---

## 1. Objetivo e limites

Construir uma aplicação local que primeiro descobre e valida caminhos da interface e, somente depois de homologada, executa geração e download de vídeos.

A regra central é **falhar de forma fechada**: não executar uma mutação quando identidade, contexto, política, alvo ou resultado esperado forem ambíguos.

Esta arquitetura trata os riscos identificados com controles, testes e políticas explícitas. Não elimina indisponibilidade remota, alterações futuras do site, ausência de identidade remota, limitações contratuais ou a impossibilidade de transacionar atomicamente navegador e banco.

Não prometer *exactly-once* remoto. A garantia local é: não repetir automaticamente uma submissão incerta e manter evidência suficiente para reconciliação ou revisão.

---

## 2. Escopo

### Primeira entrega
- CLI, configuração validada e persistência mínima.
- Executor exclusivo e Safety Gateway antes de qualquer exploração.
- Navegador dedicado e login manual.
- Observação passiva e relatório sanitizado.
- Bootstrap supervisionado das primeiras transições.
- Exploração autorizada e validação contextual do mapa.
- Testes negativos das proteções.

### Entregas posteriores
- Fila, preparação, submissão única supervisionada.
- Reconciliação e retomada.
- Resultados múltiplos, downloads e verificação técnica.
- Lotes pequenos com limites persistentes.

### Fora do escopo
- Contornar CAPTCHA, bloqueios, limites ou mecanismos de proteção.
- Garantir qualidade criativa por inspeção técnica do arquivo.
- Usar APIs privadas como dependência oculta.
- Alterar conta, comprar créditos ou excluir conteúdo.
- Autocorreção silenciosa de ações com custo.
- Defender contra código malicioso no mesmo processo ou usuário local comprometido.

---

## 3. Diagrama de componentes

```text
CLI
 └─ Application Services
     ├─ Mapping Service
     │   ├─ Passive Discovery
     │   ├─ Supervised Bootstrap
     │   └─ Transition Validator
     ├─ Execution Service
     │   ├─ Job Orchestrator
     │   └─ Submission/Result State Reducers
     └─ Recovery Service
         ├─ Remote Reconciler
         └─ Local Artifact Reconciler

Application Services
 ├─ Flow Reader ────────────────┐
 └─ Action Planner             │
     └─ Safety Gateway         │
         └─ Authorized Executor│
             └─ Flow Driver ◄──┘
                 └─ Browser Manager
                     └─ Playwright

Serviços compartilhados:
- SQLite: estados, eventos, intenções, limites, permissões e mapa.
- Artifact Store: evidências sanitizadas e arquivos finais.
- Policy Engine: permissões e limites.
- Session/Controller Lock: exclusão entre processos e comandos.
- Structured Logger e Redactor.
- Stop Controller e circuit breaker.
```

Leituras e mutações têm caminhos separados. `Page`, `Locator`, `BrowserContext` e handles não escapam da infraestrutura de navegador. O reader fornece snapshots serializáveis, nunca objetos Playwright.

---

## 4. Stack e organização

- TypeScript com `strict` e checagem de tipos no CI.
- Playwright para navegador; Playwright Test para testes browser.
- Commander para CLI.
- Zod para validação de entradas, configuração, eventos e registros persistidos.
- SQLite com migrações e driver fixado por lockfile.
- Pino com redação configurada e testes de vazamento.
- Vitest para regras e integração local.
- Filesystem local para artefatos; `ffprobe` opcional para inspeção técnica.
- Monólito modular, um controlador ativo e uma página de trabalho dedicada.

```text
flow-automation/
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ playwright.config.ts
├─ vitest.config.ts
├─ .env.example
├─ .gitignore
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ SAFETY.md
│  ├─ MAPPING-PROTOCOL.md
│  ├─ STATE-MACHINES.md
│  └─ RUNBOOK.md
├─ config/
│  ├─ defaults.json
│  └─ policy.json
├─ src/
│  ├─ cli/
│  ├─ application/
│  │  ├─ mapping-service.ts
│  │  ├─ execution-service.ts
│  │  └─ recovery-service.ts
│  ├─ domain/
│  │  ├─ jobs/
│  │  ├─ submissions/
│  │  ├─ results/
│  │  ├─ artifacts/
│  │  ├─ actions/
│  │  └─ policies/
│  ├─ mapping/
│  │  ├─ passive-discovery.ts
│  │  ├─ supervised-bootstrap.ts
│  │  ├─ transition-validator.ts
│  │  ├─ registry-validator.ts
│  │  └─ drift-detector.ts
│  ├─ flow/
│  │  ├─ flow-reader.ts
│  │  ├─ action-planner.ts
│  │  └─ contracts.ts
│  ├─ safety/
│  │  ├─ safety-gateway.ts
│  │  ├─ permit-store.ts
│  │  ├─ policy-engine.ts
│  │  ├─ budget-guard.ts
│  │  └─ stop-controller.ts
│  ├─ execution/
│  │  ├─ job-orchestrator.ts
│  │  ├─ submission-ledger.ts
│  │  ├─ remote-reconciler.ts
│  │  └─ state-reducers.ts
│  ├─ infrastructure/
│  │  ├─ browser/
│  │  │  ├─ browser-manager.ts
│  │  │  ├─ flow-driver.ts
│  │  │  ├─ authorized-executor.ts
│  │  │  ├─ navigation-guard.ts
│  │  │  └─ controller-lock.ts
│  │  ├─ persistence/
│  │  │  ├─ database.ts
│  │  │  ├─ migrations/
│  │  │  └─ repositories/
│  │  ├─ artifacts/
│  │  │  ├─ artifact-store.ts
│  │  │  ├─ download-verifier.ts
│  │  │  └─ local-reconciler.ts
│  │  └─ observability/
│  │     ├─ logger.ts
│  │     ├─ redactor.ts
│  │     └─ evidence-recorder.ts
│  └─ shared/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ architecture/
│  ├─ browser/
│  └─ fixtures/simulated-flow/
└─ runtime/                       # Inteiramente fora do Git
   ├─ profile/
   ├─ database/
   ├─ artifacts/
   ├─ downloads/
   └─ locks/
```

---

## 5. Fronteiras obrigatórias

- Somente `infrastructure/browser` pode importar Playwright para produção.
- Somente `authorized-executor` pode iniciar mutações de trabalho.
- `Flow Driver` implementa operações internas, não é exportado para `application`.
- `Flow Reader` permite leitura auditável; não executa JavaScript arbitrário recebido de chamadores.
- `Domain` não importa infraestrutura.
- Nenhum módulo externo recebe `Page`, `Locator` ou função que permita executar código no navegador.
- Login e navegação inicial são operações explícitas de lifecycle, com política própria; não são atalhos para executar tarefas.
- CLI não pode ativar execução se a política persistida e a homologação não permitirem.

**Enforcement:** regras de importação, verificação de exports, testes arquiteturais e revisão. Tipos TypeScript isoladamente não constituem uma fronteira de segurança.

---

## 6. Modos e classificação das ações

| Modo | Permissão |
|---|---|
| `observe` | Ler e produzir evidências sanitizadas |
| `bootstrap` | Executar uma transição específica aprovada pelo operador |
| `explore` | Executar transições de exploração já aprovadas |
| `validate` | Revalidar transições autorizadas; nenhuma geração |
| `dry-run` | Simular decisões, sem mutações na interface |
| `prepare` | Preencher e configurar sob autorização, sem envio |
| `execute` | Executar tarefa homologada dentro dos limites |
| `reconcile` | Ler evidências e recuperar resultados já identificados |

**Categorias:** `READ`, `OPEN_UI`, `CONFIGURE`, `FILL`, `UPLOAD`, `SUBMIT`, `DOWNLOAD`, `LIFECYCLE`.

Uma ação desconhecida é proibida. Abrir menus, preencher, enviar teclas e anexar arquivos são mutações. Não basta proibir somente click no botão de geração.

`force`, `dispatchEvent` e cliques via `evaluate` são proibidos no fluxo produtivo. Avaliação de leitura, se necessária, deve ser fixa, interna e revisada; não aceitar scripts fornecidos em tarefas.

---

## 7. Navegador, sessão e exclusão

- Perfil dedicado; não usar o perfil pessoal do Chrome.
- Login inicial manual em modo próprio.
- Estado de autenticação e perfil fora do Git, logs e exports.
- Arquivos com permissões locais restritas; isso não equivale a criptografia em repouso.
- Sessão inválida, CAPTCHA ou verificação: pausar, sem contornar.
- Uma sessão de controle exclusiva cobre login, mapeamento, execução e retomada.
- Lock de sistema operacional como exclusão primária; lease no SQLite para diagnóstico e ownership.
- Heartbeat vencido não basta para tomar controle: verificar lock e processo anterior. Na dúvida, exigir recuperação explícita.
- Cada owner recebe `controllerEpoch`; permissões antigas deixam de valer ao trocar owner.
- Uma fila serial de ações cobre todos os serviços.
- Interação humana durante `execute` invalida o contexto quando detectável. Não assumir detecção perfeita: recomendar não interagir e sempre reler configurações críticas.
- Reinício, recarga, nova página ou troca de sessão revogam permissões.
- `Navigation Guard` valida a página de trabalho e o projeto. Origens necessárias a recursos não devem ser confundidas com destinos de navegação autorizados. Popups inesperados pausam a execução; login tem allowlist própria. Não bloquear toda requisição externa indiscriminadamente.

---

## 8. Mapeamento por estados e transições

### 8.1 Observação passiva
- Coletar controles candidatos, papéis, nomes, labels, placeholders, contexto, unicidade e estado. Não atribuir capacidade executável por heurística.
- Identificar controles não prova sua finalidade. Um projeto vazio não valida geração, falha ou download.

### 8.2 Bootstrap supervisionado
- O operador aprova uma ação concreta num contexto conhecido. O sistema registra estado anterior, alvo, finalidade declarada e estado posterior. A aprovação vale para essa transição, não para todos os botões semelhantes.
- Sem um caminho aprovado, a exploração para e gera pendência. Não inventar exploração segura a partir de ícones.

### 8.3 Registro contextual

```ts
type MappingScope = {
  locale: string;
  viewport: { width: number; height: number };
  accountContextId: string;
  projectContextId: string;
  creationMode: string;
  observedVariant: string;
};

type ControlDefinition = {
  id: string;
  scopeId: string;
  pageState: string;
  containerId: string;
  candidates: LocatorSpec[];
  expectedMatches: 1;
  capabilities: ActionKind[];
  status: 'candidate' | 'validated' | 'invalidated';
  evidenceIds: string[];
};

type TransitionDefinition = {
  id: string;
  scopeId: string;
  sourceState: string;
  actionKind: ActionKind;
  controlId: string;
  preconditions: PredicateSpec[];
  expectedPostconditions: PredicateSpec[];
  timeoutMs: number;
  approvedForModes: OperationMode[];
  risk: 'low' | 'medium' | 'cost-bearing';
  evidenceIds: string[];
  status: 'candidate' | 'validated' | 'invalidated';
};
```

`LocatorSpec`, `PredicateSpec` e demais contratos precisam de schema runtime; não implementar funções arbitrárias serializadas no mapa.

Priorizar `role/name` e escopo de container, depois `label`, `placeholder`, `testId` e CSS revisado. Não usar `first()` ou `nth()` para esconder duplicidade.

### 8.4 Validação e drift
- Validar alvo único no contexto e pós-condição da transição.
- Repetir após recarga e nos estados declarados.
- Registrar cobertura e estados não observados.
- Para envio, exigir homologação específica e supervisionada.
- Comparar invariantes locais relevantes, não hash do DOM inteiro.
- Mudança relevante invalida controle/transições dependentes.
- Alternativa de seletor vira candidato; não substitui silenciosamente alvo com custo.
- Mapa validado é contextual, não universal nem permanente.

---

## 9. Contratos sem acesso direto ao navegador

```ts
interface FlowReader {
  inspectContext(): Promise<ContextSnapshot>;
  inspectCreationForm(): Promise<CreationSnapshot>;
  inspectResults(): Promise<ResultObservation[]>;
}

interface ActionPlanner {
  plan(input: ActionInput, snapshot: ContextSnapshot): ActionPlan;
}

interface SafetyGateway {
  authorize(plan: ActionPlan): Promise<AuthorizationDecision>;
}

interface AuthorizedExecutor {
  execute(permitId: string): Promise<ActionOutcome>;
}
```

O executor busca o plano imutável pelo `permitId`. Não recebe outro alvo ou payload no momento da execução.

`prepareCreation` é um caso de uso composto por ações `CONFIGURE`/`FILL`/`UPLOAD` separadamente autorizadas. Não há método genérico que altere a interface fora do gateway.

---

## 10. Permissões e janela de corrida

Uma permissão contém:
- `permitId` e nonce único;
- `controllerEpoch`, `sessionEpoch` e `pageId`;
- `jobId`, `attemptId` e `submissionIntentId` quando aplicável;
- `actionKind`, `targetControlId` e `transitionId`;
- parâmetros canônicos ou referência imutável e seu digest;
- `projectContextId` e `accountContextId`;
- `registryVersion` e `policyVersion`;
- digest das configurações efetivamente lidas;
- `observedRevision`, `issuedAt` e `expiresAt`;
- estado `ISSUED`, `CLAIMED`, `FINISHED`, `REVOKED` ou `EXPIRED`.

### Protocolo
1. Planejar ação com snapshot recente.
2. Validar mapa, modo, contexto, alvo e limites.
3. Persistir plano e permissão.
4. Adquirir execução serial e conferir ownership.
5. Reler invariantes críticas imediatamente antes da mutação.
6. Comparar contexto e parâmetros com o plano.
7. Marcar permissão `CLAIMED` atomicamente; nunca reutilizar.
8. Executar uma ação.
9. Observar pós-condição e persistir outcome.

TTL é verificado também com relógio monotônico durante o processo; permissões não sobrevivem a reinício. Revision local é indício, não prova de ausência de mudanças remotas.

Não existe atomicidade entre passo 7, interface e banco. Se cair após `CLAIMED`, `SUBMIT` vira incerteza e exige reconciliação; nunca recriar permissão de envio automaticamente.

---

## 11. Modelo de domínio e cardinalidade

```text
Job
 ├─ JobAttempt [0..N]
 └─ SubmissionIntent [0..N, somente conforme política explícita]
     └─ RemoteSubmission [0..1 quando identificável]
         └─ RemoteResult [0..N]
             └─ Artifact [0..N]
```

- Um prompt não é identificador de tarefa. Cada job tem UUID e payload versionado.
- Política inicial: uma intenção de geração por job, quantidade solicitada explícita, sem regeneração automática. Uma nova geração deliberada exige nova decisão auditada e orçamento próprio.
- `CompletionPolicy` define quantidade necessária, tratamento de falha parcial e requisitos técnicos. Estado parcial não é `COMPLETED`.

---

## 12. Estados separados e reconciliação por evidência

### Job
- **phase:** `PREFLIGHT`, `PREPARING`, `SUBMITTING`, `AWAITING_RESULTS`, `COLLECTING`, `VERIFYING`, `DONE`.
- **status:** `QUEUED`, `ACTIVE`, `PAUSED`, `NEEDS_REVIEW`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED_LOCAL`.
- **pauseReason:** `AUTH`, `POLICY`, `UI_DRIFT`, `UNKNOWN_STATE`, `CONTROLLER_LOST` ou `USER`.

### SubmissionIntent
- `PLANNED` → `RESERVED` → `DISPATCHING` → `CONFIRMED`
- `DISPATCHING` → `UNKNOWN` → `RECONCILING` → `CONFIRMED` | `NEEDS_REVIEW`
- Antes de disparar, pode ser `ABORTED`. Depois de `DISPATCHING`, ausência de confirmação não autoriza afirmar falha sem evidência.

### RemoteResult
- `OBSERVED`, `PROCESSING`, `READY`, `FAILED_REMOTE`, `UNKNOWN`.

### Artifact
- `PLANNED`, `DOWNLOADING`, `DOWNLOADED`, `VERIFYING`, `VERIFIED`, `REJECTED`, `MISSING`.

Observações remotas e processo local não são a mesma máquina. Um reducer pode avançar direto para `READY` ao reencontrar resultado pronto, sem inventar que observou `PROCESSING`. Toda transição exige evidência, regra e evento persistido.

Cancelar localmente não cancela geração remota. Manter ledger e reconciliação acessíveis após `CANCELLED_LOCAL`.

---

## 13. Protocolo de submissão

1. Obter snapshot baseline dos resultados identificáveis e cobertura da leitura.
2. Confirmar sessão, projeto, modelo, prompt, quantidade e demais parâmetros efetivos.
3. Em transação: criar intenção, reservar limite/orçamento e registrar evento.
4. Confirmar commit durável. Falha no banco significa nenhum clique.
5. Autorizar plano vinculado à intenção.
6. Revalidar invariantes finais e persistir `DISPATCHING` antes da ação.
7. Executar no máximo uma chamada de submissão para essa intenção.
8. Observar confirmação e referência remota, se disponíveis.
9. Persistir correlação e `CONFIRMED` em transação.
10. Se houver falha entre 6 e 9, classificar `UNKNOWN` e reconciliar.

Não repetir click por timeout de Playwright ou falta de feedback. Leituras podem ter retry limitado; envios incertos não.

---

## 14. Correlação remota

### Ordem de evidência
1. Identificador remoto estável observado e associado no envio.
2. Evidências combinadas homologadas, com baseline completo para o contexto e exclusão de alternativas.

Prompt, posição e horário isolados nunca bastam para confirmação automática.

### Saídas
- `CONFIRMED`: associação demonstrada pela regra homologada.
- `AMBIGUOUS`: múltiplas hipóteses; revisão.
- `NOT_OBSERVED`: ausência de evidência; não equivale a não enviado.

Baseline deve registrar se a listagem é parcial, paginada ou virtualizada. Não afirmar completude sem observação validada.

Se identidade suficiente não estiver disponível, limitar a autonomia: execução supervisionada e revisão de casos incertos. O sistema não deve inventar IDs remotos.

Aprovação manual de associação exige evidência, evento e operador; não apaga histórico.

---

## 15. Persistência e durabilidade

### Tabelas
- `jobs`, `job_attempts`;
- `submission_intents`, `remote_submissions`, `remote_results`;
- `remote_observations`, `correlation_decisions`;
- `action_plans`, `execution_permits`;
- `events`, `checkpoints`;
- `registry_versions`, `controls`, `transitions`, `mapping_scopes`;
- `artifacts`, `artifact_links`;
- `controller_leases`;
- `budget_reservations`, `usage_counters`;
- `policy_versions`, `operator_approvals`.

### Regras
- Migrações versionadas e backup antes de migração.
- `foreign_keys=ON`; `busy_timeout` explícito.
- WAL e `synchronous=FULL` como proposta inicial para ledger crítico, verificando PRAGMAs efetivos no startup.
- Banco e WAL em disco local suportado; não copiar somente o arquivo principal com processo ativo.
- Uma fila de escrita e transações curtas.
- Nenhuma transação aberta aguardando navegador ou download.
- Estado atual e evento de transição atualizados na mesma transação.
- Constraints únicas para identidade remota no escopo e consumo de permissão.
- Comparação de versão para evitar atualização concorrente de estado.
- Disco cheio, erro de IO ou perda de ownership interrompem novas mutações.
- Checkpoint é uma otimização, não a fonte final da realidade remota. No restart, invalidar permissões e executar preflight/reconciliação.

Durabilidade depende também do SO, armazenamento e ambiente; configurar `FULL` não autoriza prometer resistência absoluta a qualquer falha física.

---

## 16. Limites persistentes

Limites por execução, janela de tempo, conta e projeto quando configurados. Reiniciar processo não zera histórico.

Controlar separadamente:
- submissões;
- quantidade de resultados solicitados;
- jobs ativos;
- espaço em disco e volume de downloads;
- duração e ações máximas por sessão;
- orçamento estimado, somente quando custo for observável de modo confiável.

Reservar limite antes do envio. `UNKNOWN` mantém a reserva até decisão explícita ou evidência remota suficiente; não liberar por timeout.

Não inferir falha a partir de saldo inalterado. Não depender do limite remoto como único guardrail. Bloqueio remoto pausa a fila, sem insistência automática.

---

## 17. Pós-condições e prontidão

Sucesso de click não é sucesso de negócio.

| Ação | Pós-condição |
|---|---|
| Abrir menu | Menu esperado no container correto |
| Selecionar modelo | Valor efetivo relido e compatível |
| Preencher prompt | Conteúdo final permanece correto após estabilização observável |
| Upload | Arquivo correspondente aparece pronto |
| Submeter | Confirmação correlacionável ou `UNKNOWN` |
| Download | Evento/fluxo vinculado ao resultado correto e arquivo finalizado |

Não usar sleep fixo como prova de prontidão. Aplicar waits limitados sobre evidências específicas. `networkidle` não é critério universal de página pronta.

---

## 18. Artefatos e downloads

**Cadeia obrigatória:**
`job` → `intenção` → `associação remota` → `resultado` → `ação de download` → `artefato`.

- Nome interno gerado pelo sistema; nome remoto apenas como metadado sanitizado.
- Diretório controlado sem entrada de caminho arbitrário em jobs.
- Resolver e verificar caminhos, rejeitando traversal e symlinks inesperados.
- Usar staging no mesmo filesystem do destino para finalização por rename quando suportado.
- Registrar artefato `PLANNED` antes de iniciar.
- Registrar download finalizado e verificar tamanho, tipo real, contêiner, duração e dimensões quando disponíveis.
- `ffprobe`, quando usado, recebe argumentos sem shell e limites de tempo.
- Hash registra integridade, não identidade da tarefa ou qualidade criativa.
- Finalizar arquivo e atualizar estado; reconhecer que filesystem e SQLite não têm commit conjunto.
- No startup, reconciliar arquivos órfãos, temporários antigos e registros sem arquivo. Não anexar arquivo órfão a job por semelhança de nome.
- Retry de download deve apontar para o mesmo resultado conhecido. Não gerar novo vídeo para corrigir download.

---

## 19. Proteção de dados e observabilidade

- Não registrar cookies, tokens, credenciais, headers de autenticação ou `storageState`.
- Prompts e nomes de arquivos podem conter dados pessoais; logar referências/digests por padrão.
- DOM bruto, URLs, screenshots e traces são sensíveis; minimização antes da persistência.
- Redação de texto não sanitiza automaticamente imagens ou trace ZIP.
- Captura ampla desabilitada por padrão; diagnóstico sensível exige opção explícita, retenção curta e aviso.
- Sanitização falhou: descartar evidência, não salvar bruto como fallback.
- Export do mapa exclui sessão, tokens e dados privados de conta/projeto.
- **Eventos mínimos:** `action.planned`, `action.denied`, `permit.claimed`, `action.observed`, `submission.unknown`, `correlation.decided`, `artifact.verified`.
- Cada evento contém `eventId`, `correlationId`, `jobId` quando aplicável, `controllerEpoch`, versão da política/mapa e motivo.
- Event bus em memória não é fonte durável. Notificações derivam de eventos persistidos; não presumir entrega *exactly-once*.

---

## 20. Política de falhas

| Falha | Resposta |
|---|---|
| Leitura transitória | Retry limitado com backoff e jitter |
| Alvo ausente/duplicado | Parar ação e invalidar dependência relevante |
| Contexto ou parâmetro divergente | Revogar permissão |
| Sessão/CAPTCHA | Pausar para intervenção |
| Timeout após envio possível | `UNKNOWN` e reconciliação |
| Falha remota confirmada | Registrar; sem regeneração automática |
| Download interrompido | Rebaixar o mesmo resultado com limite |
| Associação ambígua | `NEEDS_REVIEW` |
| Erro de banco/disco | Bloquear novas mutações |
| Falhas consecutivas | Abrir circuit breaker persistido |
| `Ctrl+C` | Interromper agendamento, drenar com prazo e persistir incertezas |

`Stop` não garante que ação remota já iniciada seja cancelada. No encerramento forçado, o startup trata ações `CLAIMED`/`DISPATCHING` como potencialmente executadas.

---

## 21. Configuração inicial

```json
{
  "mode": "observe",
  "executionEnabled": false,
  "maxConcurrentJobs": 1,
  "maxSubmissionsPerRun": 1,
  "maxRequestedOutputsPerRun": 1,
  "maxReadRetries": 2,
  "stopOnUnknownState": true,
  "allowAutomaticResubmission": false,
  "allowAccountChanges": false,
  "allowPurchases": false,
  "allowDeletion": false,
  "allowRawTraces": false,
  "dryRunMutatesPage": false
}
```

São defaults, não a política inteira. Schema exige destinos autorizados, prazos, limites persistentes e diretórios válidos. Configuração desconhecida ou incompleta falha no startup. Flags não podem ampliar permissões acima da política aprovada.

---

## 22. CLI planejada

```bash
flow doctor
flow login
flow map observe
flow map bootstrap
flow map explore
flow map validate
flow map report
flow policy inspect
flow jobs add --file jobs.json
flow jobs list
flow jobs inspect <job-id>
flow run --dry-run
flow prepare <job-id>
flow run --max-submissions 1
flow reconcile <job-id>
flow resume <job-id>
flow artifacts reconcile
flow stop
```

`bootstrap` é interativo e aprova transição concreta. `doctor` verifica ambiente, não declara geração homologada. `resume` nunca ignora preflight ou reconciliação. Comandos de controle compartilham lock e fila; consultas puramente locais não precisam controlar o navegador.

---

## 23. Testes obrigatórios

### Unitários e arquiteturais
- Transições e política de conclusão parcial.
- Permissão expirada, consumida ou com epoch incorreto.
- Mudança de payload, modelo, projeto, política ou mapa.
- Reserva persistente e manutenção em `UNKNOWN`.
- Redação e descarte seguro de evidências.
- Imports proibidos e ausência de handles Playwright nas APIs públicas.
- Nenhum método de preparação pode mutar fora do executor.

### Interface simulada
- Botões duplicados e containers semelhantes.
- Elemento substituído entre leitura e clique.
- Hidratação atrasada e prompt que perde conteúdo.
- Menu lento e pós-condição ausente.
- Troca de projeto/modelo antes do envio.
- Listagem virtualizada ou parcial.
- Dois resultados idênticos e geração manual concorrente.
- Resultado pronto antes da retomada, sem estado intermediário observado.
- Uma submissão com múltiplas saídas e falha parcial.
- Download tecnicamente válido, mas de resultado errado.

### Injeção de falhas local
- Matar processo e falhar persistência em cada fronteira do protocolo de envio, inclusive antes/depois do commit, claim, click e confirmação. Provar que nenhuma retomada reenvia uma intenção incerta.
- Também testar disco cheio, `SQLITE_BUSY`, owner antigo, relógio alterado, `Ctrl+C` durante submissão, queda após rename e corrupção de artefato. Simular esses casos localmente; não provocar gasto ou falhas arriscadas na conta real.

---

## 24. Homologação no Flow real

1. Conferir condições de uso, conta e projeto autorizados.
2. Validar sessão e observação passiva.
3. Bootstrap supervisionado de caminhos de baixo risco.
4. Validar mapa no contexto declarado.
5. Dry-run sem mutações.
6. Preparação supervisionada e releitura das configurações.
7. Uma submissão autorizada com limite persistente.
8. Associar resultado por evidência e validar download.
9. Confirmar retomada segura sem reenvio.
10. Somente então liberar lote pequeno.

Se não houver identidade remota suficiente, declarar limitação operacional e manter revisão em casos incertos. Não remover essa trava para passar na homologação.

---

## 25. Ordem de implementação e gates

| Fase | Entregável | Gate |
|---|---|---|
| 1 | Configuração, banco e eventos mínimos | Falhas de persistência bloqueiam ações |
| 2 | Gateway, executor e restrições arquiteturais | Mutações sem permissão impossíveis pelas APIs públicas |
| 3 | Sessão, navegador e exclusão | Dois controladores não operam juntos |
| 4 | Observação passiva | Nenhuma mutação de trabalho |
| 5 | Bootstrap e exploração | Transições aprovadas com pós-condições |
| 6 | Registry contextual | Cobertura e drift testados |
| 7 | Ledger, limites e reducers | Crash tests locais aprovados |
| 8 | Preparação e envio supervisionado | Correlação real demonstrada ou limitação declarada |
| 9 | Artefatos e recuperação | Arquivos e banco reconciliáveis |
| 10 | Lote pequeno | Guardrails preservados entre reinícios |

---

## 26. Definition of Done

- Tipos, schemas, testes e lint aprovados.
- Nenhum seletor de produção inventado a partir de screenshot.
- Nenhuma ação desconhecida executável por fallback.
- Toda mutação tem plano, autorização e outcome auditável.
- Nenhum envio depende apenas de visibilidade/habilitação.
- Submissão incerta não é reenviada automaticamente.
- Limites sobrevivem a reinício.
- Resultado e arquivo têm cadeia de associação verificável.
- Estados não observados e lacunas de cobertura aparecem no relatório.
- Runbook explica login, pausa, `UNKNOWN`, drift, recuperação e backup.
- Falhas seguras contam como sucesso do teste; completar um vídeo não basta.

---

## 27. Riscos residuais aceitos

| Risco | Tratamento e limite |
|---|---|
| Mudança do site | Invalidar mapa e parar; manutenção continua necessária |
| Ausência de identidade remota | Revisão; autonomia limitada |
| Clique/banco sem atomicidade | Ledger + `UNKNOWN`; não prometer *exactly-once* |
| Interferência humana | Sessão dedicada e revalidação; detecção não perfeita |
| Falha física de armazenamento | Durabilidade configurada e backup; sem garantia absoluta |
| Limites ou bloqueios remotos | Pausa; nenhuma evasão |
| Conta ou máquina comprometida | Fora da garantia do gateway em processo |
| Defeito criativo no vídeo | Fora da verificação técnica de mídia |

---

## 28. Referências técnicas

- **Playwright — Authentication:** https://playwright.dev/docs/auth
- **Playwright — Locators:** https://playwright.dev/docs/locators
- **Playwright — Auto-waiting:** https://playwright.dev/docs/actionability
- **Playwright — Navigations e hidratação:** https://playwright.dev/docs/navigations
- **SQLite — Write-Ahead Logging:** https://sqlite.org/wal.html
- **Google Flow — Get started:** https://support.google.com/flow/answer/16353333?hl=en

As referências sustentam comportamentos das ferramentas e limitações gerais. A arquitetura, os contratos e os gates acima são decisões de projeto; não certificam a interface atual do Flow.
