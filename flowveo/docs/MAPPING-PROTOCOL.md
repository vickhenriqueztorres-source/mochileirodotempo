# MAPPING PROTOCOL — Protocolo de Descoberta, Bootstrap e Homologação Contextual

## 1. Estágios do Mapa Contextual
1. **`observe` (Observação Passiva — Zero Mutações):**
   - Varre o DOM visível sem clicar, digitar ou disparar eventos sintéticos.
   - Registra controles como `candidate` vinculados ao `MappingScopeKey` (`accountContextId`, `projectContextId`, `locale`, `viewportBucket`, `creationMode`, `observedVariant`).
2. **`bootstrap` (Bootstrap Supervisionado):**
   - Usado quando uma área da UI só existe após abrir um painel/menu pela primeira vez.
   - Exige aprovação explícita do operador para a transição candidata específica e reverte à página base se a pós-condição falhar.
3. **`explore` (Exploração Autorizada):**
   - Executa somente transições reversíveis homologadas (`OPEN_UI`, `CONFIGURE`), verificando predicados tipados de pré e pós-condição e unicidade (`expectedMatches === 1`).
4. **`validate` (Promoção Contextual):**
   - Promove o registro contextual para `VALIDATED` somente se todos os controles obrigatórios estiverem `validated` no escopo exato e o `DriftDetector` registrar 0 colisões/ambiguidades.

## 2. Detecção de Drift
- Qualquer mudança no texto acessível, `role`, hierarquia ou contagem de correspondências (`observedMatches !== 1`) rebaixa o controle para `invalidated` e pausa a operação com `pauseReason = 'UI_DRIFT'`.
