# Subetapa 05 (Gate G5) — Bootstrap Supervisionado, Exploração Autorizada e Pós-Condições

- **Gate:** `G5` — *Apenas transições concretamente aprovadas pelo operador são executadas, e somente pós-condições observadas validam uma transição*
- **Requisitos atendidos:** `J03`, `A-09`, `A-10`, `A-11`, `A-12`, `S-04` | Arquitetura §8.2, §8.3, §17

---

## 1. Objetivo
Implementar o fluxo de `SupervisedBootstrap` (`flow map bootstrap`) onde o operador aprova uma transição específica num contexto concreto, e o `TransitionValidator` / modo `explore` (`flow map explore`) que executa exclusivamente transições autorizadas de baixo/médio risco (`OPEN_UI`, `CONFIGURE`, `FILL`, `UPLOAD` de teste sem envio), exigindo que cada ação tenha alvo único (`expectedMatches === 1`) e pós-condição observada (ex.: menu abriu no container esperado, valor selecionado foi relido e bate com o solicitado, texto preenchido estabilizou no campo).

---

## 2. Passo a Passo de Implementação

### Passo 5.1 — Schemas Runtime de Locators e Predicados (`src/mapping/`)
- Definir `LocatorSpecSchema` (`role`, `name`, `label`, `placeholder`, `testId`, `css`, `containerId`) e `PredicateSpecSchema` (`kind: 'control_visible' | 'control_text_equals' | 'control_value_equals' | 'menu_open_in_container' | 'upload_ready' | 'url_matches'`, parâmetros tipados).
- Proibição absoluta de serializar funções JavaScript arbitrárias no banco/mapa (Arquitetura §8.3).

### Passo 5.2 — Bootstrap Supervisionado (`src/mapping/supervised-bootstrap.ts`)
- Apresenta proposta de transição concreta (`sourceState`, `controlId`, `actionKind`, `preconditions`, `expectedPostconditions`, `risk`).
- Registra aprovação explícita do operador na tabela `operator_approvals` vinculada àquela `transitionId` e `scopeId` específicos (`A-09`).
- Aprovar um botão "Abrir seletor de modelo" em um container **não** aprova outros botões ou menus semelhantes (`J03`).
- Se o estado atual exigir uma transição não aprovada, a exploração para imediatamente e registra pendência explícita.

### Passo 5.3 — Validador de Transições e Pós-Condições (`src/mapping/transition-validator.ts`)
- Antes de executar a transição via `SafetyGateway -> AuthorizedExecutor`:
  1. Verifica todas as `preconditions`.
  2. Verifica unicidade estrita do controle no container (`observedMatches === 1`; se `0` ou `>1`, aborta e invalida o controle — `A-12`).
- Após executar a ação:
  1. Aguarda com polling limitado baseado em evidência (nunca `sleep` fixo cego e nunca `networkidle` como critério único — Arquitetura §17).
  2. Verifica todas as `expectedPostconditions`:
     - `OPEN_UI`: menu esperado está aberto dentro do `containerId` correto.
     - `CONFIGURE`: valor efetivo do modelo/proporção/quantidade foi **relido** da UI e corresponde ao parâmetro enviado.
     - `FILL`: texto do prompt foi relido após janela de estabilização e permanece idêntico (detecta perda de caracteres por re-render/hidratação atrasada).
     - `UPLOAD`: indicador de ativo pronto/anexado presente.
  3. Se a pós-condição falhar, o clique **não** valida a transição (`status: 'invalidated'`, `A-11`).

---

## 3. Baterias Obrigatórias de Teste (Gate G5)

1. **Testes Unitários (`tests/unit/g5-bootstrap-and-predicates.test.ts`)**:
   - Validação de `LocatorSpec` e `PredicateSpec` via Zod, rejeitando qualquer tentativa de injetar código/funções ou seletores `.first()` / `.nth()`.
   - Verificação de que a aprovação de `transition_A` não concede permissão para `transition_B` mesmo com label parecido.
2. **Testes de Segurança (`tests/security/g5-unauthorized-exploration-block.test.ts`)**:
   - Tentativa de explorar transição com `status: 'candidate'` (sem aprovação em `operator_approvals`) → bloqueada pelo `SafetyGateway`.
   - Tentativa de aprovar ou executar transição `SUBMIT` durante `bootstrap` ou `explore` na Release A → bloqueada incondicionalmente.
3. **Testes de Caos (`tests/chaos/g5-postconditions-and-dom-traps.test.ts`)**:
   - **Clique sem efeito:** botão recebe clique mas o menu não abre → transição marcada como `invalidated` (`A-11`).
   - **Hidratação atrasada que apaga o prompt:** campo recebe `FILL`, mas 50ms depois um re-render da página limpa ou trunca o texto → releitura de estabilização detecta divergência e falha de forma fechada.
   - **Elemento duplicado:** surgem 2 controles que casam com o seletor no mesmo container → ação abortada antes do clique (`A-12`).
   - **Elemento substituído entre leitura e clique:** revisão do elemento muda antes do disparo → permissão revogada.
4. **Testes de Estresse (`tests/stress/g5-serial-transitions-validation.test.ts`)**:
   - Execução de 100 validações sequenciais de transições aprovadas sob latências variáveis simuladas, garantindo 100% de precisão na checagem de pré e pós-condições.
