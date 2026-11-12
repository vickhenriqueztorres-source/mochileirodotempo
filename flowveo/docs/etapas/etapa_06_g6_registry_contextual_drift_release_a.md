# Subetapa 06 (Gate G6) — Registry Contextual, Detector de Drift e Fechamento da Release A

- **Gate:** `G6` — *Cobertura contextual e detecção de drift aprovadas; Release A completa com zero capacidade de disparo de geração*
- **Requisitos atendidos:** `J04`, `A-13`, `A-14`, `A-15`, `A-18` | Arquitetura §8.3, §8.4, §25

---

## 1. Objetivo
Consolidar o `RegistryValidator` (`flow map validate`) e o `DriftDetector` para comparar invariantes locais do contexto (`locale`, `viewport`, `accountContextId`, `projectContextId`, `creationMode`, `observedVariant`, controles e containers) sem depender de hash do DOM inteiro. Invalidar automaticamente controles e transições dependentes quando uma invariante mudar, gerar relatórios completos de cobertura (`flow map report` distinguindo `validated`, `candidate`, `invalidated` e `statesNotObserved`), e selar o aceite da **Release A**.

---

## 2. Passo a Passo de Implementação

### Passo 6.1 — Registry Validator e Versionamento Contextual (`src/mapping/registry-validator.ts`)
- Gerencia versões imutáveis do mapa (`registry_versions`) vinculadas a um `MappingScope`.
- Revalida todas as transições aprovadas para um escopo (incluindo teste após recarga simulada da página — Arquitetura §8.4).
- Calcula métricas de cobertura:
  - Controles `validated`, `candidate`, `invalidated`.
  - Transições `validated`, `candidate`, `invalidated`.
  - Lista explícita de `statesNotObserved` (ex.: estados de erro remoto, listagem vazia vs povoada, modal de download) para que o operador saiba exatamente o que ainda não foi homologado (`A-13`).

### Passo 6.2 — Drift Detector e Cascata de Invalidação (`src/mapping/drift-detector.ts`)
- Compara invariantes estruturais locais (roles, nomes, hierarquia de container, unicidade, atributos de estado) entre o `RegistryVersion` ativo e o `ContextSnapshot` atual.
- Não usa hash do DOM inteiro (evita que classes CSS dinâmicas irrelevantes quebrem o mapa sem necessidade, mas captura qualquer mudança no controle-alvo ou em seu container).
- Se um controle sofrer drift:
  - Marca o controle como `invalidated`.
  - Em cascata, marca todas as transições que dependem daquele `controlId` como `invalidated` (`A-14`).
  - Se existir um seletor alternativo candidato (`LocatorSpec` secundário), mantém como `candidate` para revisão do operador — **jamais substitui silenciosamente um alvo com custo** (Arquitetura §8.4).

### Passo 6.3 — Exportação Sanitizada e Trava Final da Release A (`src/application/mapping-service.ts`)
- `exportSanitizedMapReport()`: exporta JSON/Markdown do mapa e cobertura garantindo exclusão de cookies, tokens, `accountContextId` bruto (usa hash canônico no export) e URLs sensíveis (`A-15`).
- Gate final da Release A (`A-18`): prova em todos os comandos públicos da CLI e serviços que nenhuma chamada consegue emitir ou executar `SUBMIT` enquanto a instalação estiver em Release A.

---

## 3. Baterias Obrigatórias de Teste (Gate G6)

1. **Testes Unitários (`tests/unit/g6-registry-and-drift.test.ts`)**:
   - Validação de cascata: invalidar `control_model_dropdown` invalida automaticamente `transition_select_model` e `transition_submit_generation`.
   - Verificação de que `statesNotObserved` lista explicitamente todos os estados esperados do domínio ainda não visitados.
2. **Testes de Segurança (`tests/security/g6-release-a-hard-lock.test.ts`)**:
   - Tentativa de forçar `SUBMIT` na Release A via CLI, via alteração de JSON, via chamada direta ao `SafetyGateway` e via `AuthorizedExecutor` → **0 submissões disparadas** em 100% dos caminhos.
   - Auditoria de segredos no arquivo gerado por `flow map report`.
3. **Testes de Caos (`tests/chaos/g6-ui-drift-and-reload.test.ts`)**:
   - Mudança de `locale` (`pt-BR` → `en-US`), mudança de `viewport`, troca de `projectContextId` ou renomeação do botão no DOM após recarga → `DriftDetector` dispara `UI_DRIFT`, revoga permissões e pausa a operação antes de qualquer clique.
   - Seletor primário desaparece mas seletor secundário existe → em controle `cost-bearing`, o sistema bloqueia e pede revisão (não faz fallback silencioso).
4. **Testes de Estresse (`tests/stress/g6-massive-drift-evaluation.test.ts`)**:
   - Comparação de drift em 500 escopos/versões de registro com grafos de dependência de 50 transições cada, executando em `< 200ms` com determinismo total.
