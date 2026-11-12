# Subetapa 04 (Gate G4) — Flow Reader Auditável, Observação Passiva (`observe`), Doctor e CLI Base

- **Gate:** `G4` — *Observação passiva mapeia candidatos e gera relatório sanitizado com zero mutação na interface*
- **Requisitos atendidos:** `OBJ-01`, `A-02`, `A-06`, `A-07`, `A-08`, `A-15` | Arquitetura §6, §8.1, §9, §22

---

## 1. Objetivo
Construir o `FlowReader` (leitura puramente passiva que retorna snapshots serializáveis validados por Zod, sem executar scripts arbitrários e sem expor objetos do Playwright), o motor de descoberta passiva (`PassiveDiscovery`) que cataloga controles candidatos (`status: 'candidate'`, sem conceder permissão executável), o diagnóstico de ambiente (`flow doctor`) e a estrutura de comandos CLI da Release A (`doctor`, `login`, `map observe`, `policy inspect`, `stop`).

---

## 2. Passo a Passo de Implementação

### Passo 4.1 — Flow Reader e Snapshots Serializáveis (`src/flow/flow-reader.ts`)
- Implementar `inspectContext()`, `inspectCreationForm()` e `inspectResults()`.
- Retornar exclusivamente estruturas imutáveis e validadas por Zod (`ContextSnapshot`, `CreationSnapshot`, `ResultObservation[]`).
- Retry limitado de leitura (`maxReadRetries: 2`) com backoff exponencial + jitter para lidar com hidratação transitória da página (Arquitetura §20), sem nunca executar clique ou mutação.
- Proibição de `evaluate` dinâmico: toda extração usa seletores/atributos fixos e auditados internamente.

### Passo 4.2 — Descoberta Passiva (`src/mapping/passive-discovery.ts`)
- Inspeciona controles visíveis na página de trabalho atual e registra na tabela `controls` com:
  - `scopeId` (`MappingScope`: `locale`, `viewport`, `accountContextId`, `projectContextId`, `creationMode`, `observedVariant`).
  - `candidates: LocatorSpec[]` priorizando `role + name` dentro de `containerId`, seguido de `label`, `placeholder`, `testId` e `css` revisado.
  - `observedCount`: se encontrar `> 1` elementos para um mesmo seletor no escopo, marca o candidato como ambíguo (`duplicateMatches: true`) e nunca usa `.first()` ou `.nth()` para mascarar duplicidade (`A-12`).
  - `status: 'candidate'` e `capabilities: []` (nenhuma capacidade de mutação é inferida automaticamente por heurística de texto ou ícone — `A-08`).

### Passo 4.3 — Diagnóstico de Ambiente (`flow doctor`) e CLI (`src/cli/`)
- `flow doctor`: verifica versão do Node, presença de diretórios `runtime/`, permissões de escrita, integridade e PRAGMAs do SQLite, espaço livre em disco, estado do `ControllerLock`, validade do `policy.json` e disponibilidade opcional do `ffprobe`. Retorna relatório estruturado e **jamais declara geração homologada** (`A-02`).
- `flow map observe`: executa descoberta passiva no navegador (ou fixture simulado em testes), grava candidatos no SQLite e gera relatório sanitizado informando o que foi observado e as lacunas ainda não observadas (`statesNotObserved`).

---

## 3. Baterias Obrigatórias de Teste (Gate G4)

1. **Testes Unitários (`tests/unit/g4-passive-discovery-and-doctor.test.ts`)**:
   - Verifica que `PassiveDiscovery` cataloga controles apenas como `candidate` e com `capabilities` vazias até aprovação explícita.
   - Verifica que `doctor` detecta falta de espaço em disco, diretório inválido ou configuração corrompida.
2. **Testes de Segurança (`tests/security/g4-observe-zero-mutation.test.ts`)**:
   - Executa `flow map observe` contra uma página simulada instrumentada com sensores de mutação (qualquer `click`, `fill`, `keydown`, `input`, `change`, `submit` ou abertura de menu dispara alarme) → prova matemática de **zero mutações** (`A-06`).
   - Verifica que o export do relatório passa pelo `Redactor` e não contém tokens, cookies ou dados privados da conta (`A-15`).
3. **Testes de Caos (`tests/chaos/g4-hydration-and-transient-reads.test.ts`)**:
   - Simulação de falha de leitura nas 2 primeiras tentativas (DOM em hidratação atrasada) recuperando na 3ª tentativa com backoff/jitter, e falha segura na 4ª tentativa quando excede `maxReadRetries: 2`.
   - Simulação de página com botões duplicados (`2 botões "Generate"` no mesmo container) → registrados como ambíguos, sem colapsar com `.first()`.
4. **Testes de Estresse (`tests/stress/g4-large-dom-snapshot.test.ts`)**:
   - Extração e sanitização de snapshot com 1.000 controles candidatos simultâneos verificando tempo de resposta, consumo de memória controlado e persistência íntegra no SQLite.
