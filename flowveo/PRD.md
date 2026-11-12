# PRD — Automação local segura de vídeos no Google Flow

- **Versão:** 1.0
- **Status:** proposto para implementação
- **Data:** 04/11/2026
- **Produto:** Flow Automation
- **Responsável pelo produto:** proprietário da instalação local
- **Documento complementar:** [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Resumo executivo

Criar uma aplicação local em TypeScript + Playwright que opere a interface do Google Flow para automatizar tarefas de geração e download de vídeos, com rastreabilidade, limites persistentes e tratamento explícito de incerteza.

A implementação começa pelo mapeamento da interface real. Geração permanece desabilitada até existir homologação contextual, testes de segurança aprovados e autorização explícita do operador.

O produto deve executar somente ações conhecidas, em contextos reconhecidos, com pré-condições verificadas e pós-condições observadas. Na ausência de evidência suficiente, deve parar ou solicitar revisão.

Este PRD define resultados e critérios de aceitação. Não afirma que a automação já foi implementada, nem que todos os caminhos do Flow foram observados.

---

## 2. Problema

A operação manual de geração exige repetir configurações, preencher prompts, acompanhar resultados, baixar arquivos e organizar saídas. Automatizar apenas os cliques transfere esse trabalho para um processo frágil, sujeito a gerar no projeto errado, repetir envios, consumir recursos indevidamente e perder o vínculo entre pedido e arquivo.

O problema central não é clicar mais rápido. É executar tarefas repetitivas com controle sobre o que será enviado, evidência do que aconteceu e recuperação segura quando o resultado for desconhecido.

---

## 3. Público e contexto de uso

### Usuário principal
Operador técnico ou criador de conteúdo que utiliza uma conta própria e autorizada do Google Flow, em computador local, e deseja automatizar tarefas sem construir uma infraestrutura distribuída.

### Condições operacionais iniciais
- Uma instalação, um operador e um controlador ativo.
- Perfil de navegador separado do uso pessoal.
- Login e verificações de conta realizados manualmente.
- Operação inicial supervisionada; autonomia ampliada por homologação.
- TypeScript + Playwright, CLI local e persistência em SQLite.
- Nenhuma dependência obrigatória de plataforma externa de orquestração.
- Plataforma-alvo inicial: Windows; demais sistemas fora da homologação inicial, salvo decisão posterior.

A aplicação não cria direito de uso, não elimina custos do plano e não contorna restrições do serviço.

---

## 4. Objetivos do produto

| ID | Objetivo | Evidência de atendimento |
|---|---|---|
| OBJ-01 | Descobrir a interface antes de executar geração | Relatório contextual e cobertura do mapa |
| OBJ-02 | Impedir mutações não autorizadas pelos caminhos públicos da aplicação | Testes de política e arquitetura |
| OBJ-03 | Evitar reenvios automáticos em situações incertas | Ledger e testes de recuperação |
| OBJ-04 | Preservar limites entre reinícios | Reservas e contadores persistentes |
| OBJ-05 | Vincular arquivos às tarefas corretas | Cadeia de associação auditável |
| OBJ-06 | Retomar sem presumir que a página continua no estado anterior | Preflight e reconciliação |
| OBJ-07 | Tornar falhas compreensíveis para o operador | Diagnóstico estruturado e instrução de recuperação |

---

## 5. Não objetivos

- Garantir exatamente uma geração no serviço remoto.
- Garantir disponibilidade, estabilidade ou autorização permanente do Google Flow.
- Contornar CAPTCHA, bloqueios, verificações, limites ou restrições contratuais.
- Automatizar compras, mudanças de conta ou exclusão de conteúdo.
- Usar APIs privadas como requisito oculto.
- Avaliar automaticamente qualidade criativa ou aderência semântica ao prompt.
- Construir serviço multiusuário, microserviços, extensão ou painel web no MVP.
- Tornar a primeira calibração totalmente autônoma.
- Defender contra código malicioso no mesmo processo ou comprometimento da máquina.

---

## 6. Releases e escopo

### Release A — Mapeamento seguro: MVP imediato
- **Inclui:** configuração, banco mínimo, eventos, executor exclusivo, políticas, navegador dedicado, login, observação passiva, bootstrap supervisionado, exploração autorizada, validação contextual e relatório.
- **Exclui:** submissão de geração, fila executável, downloads de resultados de tarefas e lotes.
- A interface de configuração não poderá habilitar geração nesta release. Contratos futuros podem existir, mas comandos de envio devem estar ausentes ou retornar bloqueio explícito.

### Release B — Geração única supervisionada
- **Inclui:** entrada de tarefa, preparação, releitura de configurações, ledger, reserva de limites, envio único, associação de resultado, download e verificação técnica.
- **Gate:** Release A homologada no contexto real e testes locais de incerteza aprovados.

### Release C — Recuperação e lotes pequenos
- **Inclui:** retomada, reconciliação remota e local, resultados múltiplos, falhas parciais e execução serial de lote limitado.
- **Gate:** geração única e recuperação demonstradas. Se não existir identidade remota suficiente, manter revisão obrigatória nos casos incertos.

---

## 7. Princípios de produto

- Ambiguidade resulta em bloqueio, não em escolha por aproximação.
- Sucesso de interação não é confirmação de sucesso de negócio.
- Observação não concede permissão de execução.
- Estado salvo não prova o estado atual do site.
- Submissão não observada não equivale a submissão não realizada.
- Cancelamento local não equivale a cancelamento remoto.
- Autocorreção pode sugerir candidatos; não pode homologar silenciosamente novo envio.
- Segurança será medida também pela capacidade de parar corretamente.

---

## 8. Jornadas principais

### J01 — Preparar ambiente
Operador executa `doctor`, recebe diagnóstico das dependências, configuração, banco, diretórios, perfil, lock e espaço em disco. Corrige pendências e inicia login manual.
- **Saída:** ambiente apto à observação. `Doctor` não declara geração homologada.

### J02 — Mapear projeto
Operador informa projeto autorizado. Aplicação observa a página, identifica candidatos e produz relatório com evidências sanitizadas e estados não observados.
- **Saída:** mapa candidato sem capacidade automática de geração.

### J03 — Aprovar exploração
Aplicação apresenta uma transição concreta: origem, alvo, finalidade, ação e pós-condição. Operador aprova. Aplicação executa apenas essa transição e registra o resultado.
- **Saída:** caminho aprovado ou pendência explícita. Aprovação não se estende a botões semelhantes.

### J04 — Validar mapa
Aplicação revalida contexto, unicidade, pré-condições e pós-condições, incluindo recarga quando apropriado. Relatório informa escopo e cobertura.
- **Saída:** mapa validado apenas para o contexto homologado ou lista de bloqueios.

### J05 — Gerar um vídeo, após Release A
Operador cadastra tarefa, executa `dry-run`, aprova preparação e envio. Aplicação relê configurações, reserva limites, persiste intenção e envia uma vez.
- **Saída:** submissão confirmada ou estado incerto, nunca reenvio automático.

### J06 — Recuperar interrupção
Aplicação encontra tentativa incompleta, invalida permissões antigas, executa novo preflight e procura evidências remotas e locais.
- **Saída:** retomada comprovada, revisão ou bloqueio. Ausência de resultado visível não autoriza nova geração.

### J07 — Obter arquivos
Aplicação baixa o resultado associado, valida integridade técnica e registra arquivo e hash.
- **Saída:** artefato verificado ou falha específica. Arquivo válido de outro resultado não satisfaz a tarefa.

---

## 9. Requisitos funcionais — Release A

| ID | Requisito | Critério de aceitação |
|---|---|---|
| A-01 | Validar configuração com schema | Campos inválidos, desconhecidos ou obrigatórios ausentes impedem operação |
| A-02 | Oferecer `doctor` sem geração | Diagnóstico informa cada verificação e não dispara criação |
| A-03 | Usar perfil dedicado | Perfil pessoal não é selecionado implicitamente |
| A-04 | Permitir login manual | Sessão é reutilizada localmente sem registrar credenciais |
| A-05 | Garantir um controlador ativo | Segundo comando de controle não opera a mesma sessão |
| A-06 | Inspecionar sem mutações de trabalho | `Observe` não preenche, abre menus, anexa ou envia |
| A-07 | Registrar candidatos contextualizados | Cada candidato tem estado, escopo, estratégia e status |
| A-08 | Separar candidato de controle aprovado | Descoberta isolada nunca habilita execução |
| A-09 | Exigir bootstrap supervisionado | Primeira transição desconhecida depende de aprovação concreta |
| A-10 | Explorar apenas transições autorizadas | Ação fora do conjunto aprovado é bloqueada e registrada |
| A-11 | Verificar pós-condições | Click sem efeito esperado não valida a transição |
| A-12 | Detectar alvo ambíguo | Duplicidade não é resolvida por `first`, `nth` ou posição |
| A-13 | Versionar mapa e cobertura | Relatório distingue validado, candidato, invalidado e não observado |
| A-14 | Detectar drift relevante | Mudança em invariantes bloqueia transições dependentes |
| A-15 | Exportar mapa e relatório sanitizados | Export não contém sessão, tokens ou credenciais |
| A-16 | Implementar gateway antes de explorar | Nenhuma mutação pública contorna autorização |
| A-17 | Autorizar todas as mutações | Preenchimento, teclado, upload e configuração seguem política |
| A-18 | Bloquear geração nesta release | Flags ou entrada de tarefa não habilitam submissão |
| A-19 | Oferecer parada controlada | `Ctrl+C` impede novas ações e registra estado possível |
| A-20 | Pausar em autenticação ou verificação | Nenhuma tentativa de contorno ou loop de login |

---

## 10. Requisitos funcionais — Releases B e C

| ID | Requisito | Critério de aceitação |
|---|---|---|
| BC-01 | Cadastrar tarefas validadas | Job possui UUID, payload versionado e quantidade explícita |
| BC-02 | Dry-run sem mutações | Nenhuma alteração de formulário ou submissão |
| BC-03 | Preparação autorizada | Configuração e preenchimento são auditáveis e relidos |
| BC-04 | Vincular autorização ao contexto | Mudança de projeto, modelo, payload, sessão ou versão revoga permissão |
| BC-05 | Persistir intenção antes do envio | Falha na gravação implica nenhum clique |
| BC-06 | Consumir autorização uma única vez | Permissão `CLAIMED` não pode ser reutilizada |
| BC-07 | Não reenviar automaticamente | Timeout após possível envio resulta em `UNKNOWN` |
| BC-08 | Reconciliar com evidência | Decisão é `CONFIRMED`, `AMBIGUOUS` ou `NOT_OBSERVED` |
| BC-09 | Preservar limites | Reinício não zera contadores nem reservas incertas |
| BC-10 | Separar submissão, resultados e artefatos | Uma submissão pode produzir múltiplas saídas |
| BC-11 | Tratar conclusão parcial | Política de conclusão define requisitos antes da execução |
| BC-12 | Retomar de observações atuais | Resultado pronto pode ser reconhecido sem inventar estados intermediários |
| BC-13 | Vincular download ao resultado | Cadeia de associação é consultável no relatório |
| BC-14 | Verificar arquivo | Existência, tamanho, tipo e requisitos técnicos são registrados |
| BC-15 | Reconciliar banco e filesystem | Arquivos órfãos e referências sem arquivo são identificados |
| BC-16 | Repetir download sem regenerar | Retry usa o mesmo resultado identificado |
| BC-17 | Diferenciar cancelamentos | Cancelamento local mantém registro de possível geração remota |
| BC-18 | Controlar lote serial | Apenas um job opera o navegador; limites se aplicam ao lote |

---

## 11. Requisitos de segurança e confiabilidade

### S-01 — Fronteira de execução
`Page`, `Locator` e `BrowserContext` permanecem na infraestrutura. APIs públicas recebem planos e snapshots, não handles ou scripts arbitrários. Regras de importação e testes arquiteturais verificam a restrição.
O gateway protege contra erros de implementação no projeto; não é isolamento contra código malicioso local.

### S-02 — Permissão vinculada e descartável
Permissão referencia plano imutável, ação, alvo, tarefa, tentativa, intenção quando aplicável, projeto, sessão, owner, versões de mapa/política, digest de configurações e expiração. Reinício e troca de owner invalidam permissões.

### S-03 — Revalidação final
Antes da mutação, conferir novamente identidade e invariantes. Divergência bloqueia a ação. TTL curto sozinho não é aceito como prova de contexto inalterado.

### S-04 — Sem atalhos silenciosos
Não empregar `force`, click por JavaScript ou heurística visual como fallback automático de submissão. Alternativas de seletor exigem nova validação conforme risco.

### S-05 — Limites persistentes
Reservas e contadores são gravados antes do envio. `UNKNOWN` mantém reserva. Limites distinguem submissões, quantidade de saídas e orçamento quando observável. Não afirmar controle financeiro exato quando custo não for confiável.

### S-06 — Durabilidade e falhas locais
Erro de banco, disco cheio ou perda de ownership impede novas mutações. Estado e evento são persistidos na mesma transação. Não manter transação aberta aguardando navegador.

### S-07 — Dados sensíveis
Perfil, autenticação e runtime ficam fora do Git. Logs não contêm cookies, tokens ou credenciais. Prompts, DOM, URLs, screenshots e traces são tratados como potencialmente sensíveis. Falha de sanitização descarta evidência; não grava bruto como fallback.

### S-08 — Navegação e caminhos
Página de trabalho e projeto devem estar autorizados. Recursos de rede não são confundidos com navegação principal. Downloads usam nomes internos e diretórios controlados; caminhos fornecidos externamente não autorizam escrita arbitrária.

### S-09 — Intervenção humana
Operação exige navegador dedicado. Interferência detectada invalida contexto e pausa quando necessário. O produto não promete detectar toda interação humana.

---

## 12. Modelo conceitual de dados

- **Job:** pedido, payload, política de conclusão e estado local.
- **JobAttempt:** tentativa operacional, sem equivaler automaticamente a nova geração.
- **SubmissionIntent:** intenção persistida antes do envio, com reserva e estado.
- **RemoteSubmission:** envio remoto quando identificável.
- **RemoteResult:** cada saída e seu estado observado.
- **Artifact:** arquivo, verificação e vínculo com resultado.
- **MappingScope:** contexto em que o mapa foi homologado.
- **Control e Transition:** alvo e comportamento aprovado.
- **ActionPlan e ExecutionPermit:** ação imutável e autorização descartável.
- **Observation e CorrelationDecision:** evidências e decisão de associação.
- **Event e Checkpoint:** histórico durável e auxílio de retomada.
- **BudgetReservation e UsageCounter:** controle persistente de limites.
- **ControllerLease e PolicyVersion:** ownership e política efetiva.

Prompt ou hash do prompt não substitui identidade de tarefa. Duas gerações intencionais podem compartilhar o mesmo texto.

---

## 13. Estados visíveis ao operador

### Tarefa
- `QUEUED`, `ACTIVE`, `PAUSED`, `NEEDS_REVIEW`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED_LOCAL`.
- **Fase operacional separada:** `PREFLIGHT`, `PREPARING`, `SUBMITTING`, `AWAITING_RESULTS`, `COLLECTING`, `VERIFYING`, `DONE`.

### Intenção de envio
- `PLANNED`, `RESERVED`, `DISPATCHING`, `CONFIRMED`, `UNKNOWN`, `RECONCILING`, `NEEDS_REVIEW`, `ABORTED`.
- `ABORTED` somente quando há evidência de que o disparo não ocorreu. Depois de `DISPATCHING`, falha sem confirmação deve preservar incerteza.

### Motivos de pausa
- `AUTH`, `POLICY`, `UI_DRIFT`, `UNKNOWN_STATE`, `CONTROLLER_LOST`, `USER`.

O relatório informa o que aconteceu, o que foi comprovado, o que continua desconhecido e qual ação do operador é permitida.

---

## 14. CLI do produto

### Release A
```bash
flow doctor
flow login
flow map observe
flow map bootstrap
flow map explore
flow map validate
flow map report
flow policy inspect
flow stop
```

### Releases posteriores
```bash
flow jobs add --file jobs.json
flow jobs list
flow jobs inspect <job-id>
flow run --dry-run
flow prepare <job-id>
flow run --max-submissions 1
flow reconcile <job-id>
flow resume <job-id>
flow artifacts reconcile
```

Os comandos são contratos planejados, não indicação de implementação existente. Flags só podem restringir a política aprovada, nunca ampliar permissões implicitamente.

---

## 15. Configuração padrão do produto

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

Além dos defaults, configuração efetiva exige destinos autorizados, limites persistentes, prazos e diretórios válidos. A Release A não permite envio mesmo que `executionEnabled` seja alterado.

---

## 16. Critérios de qualidade e métricas

### Gates obrigatórios, não promessas estatísticas

| Métrica | Meta de aceitação |
|---|---|
| Gerações disparadas por `observe`, `dry-run` e Release A | Zero na suíte e homologação |
| Reenvios automáticos de intenção `UNKNOWN` | Zero |
| Ações com alvo duplicado executadas | Zero |
| Consumo repetido da mesma permissão | Zero |
| Casos negativos obrigatórios aprovados | 100% dos casos definidos |
| Artefatos declarados verificados com cadeia completa | 100% |
| Reinícios que zeram limite persistente indevidamente | Zero |
| Vazamento de segredos nos fixtures de teste | Zero |

Esses números são critérios do escopo testado, não garantia de ausência universal de falhas.

### Métricas operacionais a coletar
- Tarefas concluídas sem intervenção, por versão de mapa e contexto.
- Pausas por drift, autenticação, política e ambiguidade.
- Submissões `UNKNOWN` e decisões de reconciliação.
- Tempo de descoberta, preparação, geração observada e download.
- Downloads rejeitados e artefatos órfãos.
- Quantidade de intervenções por lote.

Não estabelecer taxa de autonomia ou tempo máximo de geração antes de medir o Flow real. Limites de espera são configuráveis e nunca autorizam reenvio por expiração.

---

## 17. Plano de testes e aceite

### Release A
- Configuração inválida impede execução.
- Dois controladores não compartilham sessão ativa.
- `Observe` não altera formulário nem abre menus.
- Candidato encontrado não ganha permissão automaticamente.
- `Bootstrap` autoriza somente a transição apresentada.
- Controle ausente ou duplicado bloqueia ação.
- Pós-condição ausente impede validação.
- Drift relevante invalida dependências.
- Chamadas de mutação fora do executor falham nos testes arquiteturais.
- Export e logs não incluem segredos conhecidos dos fixtures.
- Geração permanece bloqueada por todos os caminhos públicos.

### Releases B e C
- Alterar modelo ou projeto após autorização bloqueia envio.
- Reinício invalida permissões, mas mantém limites.
- Falha antes de persistir intenção produz zero envios.
- Queda após possível clique produz `UNKNOWN` e não reenvia.
- Dois resultados compatíveis produzem revisão.
- Histórico parcial não prova ausência de geração.
- Resultado pronto na retomada é reconhecido sem estados fictícios.
- Submissão com múltiplas saídas aplica política de conclusão.
- Download de resultado errado não conclui tarefa.
- Queda entre download, rename e commit é reconciliável.
- Disco cheio, banco ocupado e owner antigo bloqueiam novas mutações conforme política.

Injeção de falhas ocorre em interface simulada e ambiente local. Não provocar falhas de gasto na conta real como substituição de testes.

---

## 18. Homologação real

1. Confirmar conta, projeto e uso autorizados.
2. Validar ambiente e sessão dedicada.
3. Observar interface e produzir relatório candidato.
4. Aprovar caminhos iniciais de exploração.
5. Validar mapa no escopo declarado.
6. Aprovar Release A sem geração.
7. Após gates locais de execução, realizar `dry-run` e preparação supervisionada.
8. Autorizar uma submissão com limite persistente.
9. Demonstrar associação e download corretos.
10. Validar retomada segura e somente então lote pequeno.

A ausência de identificador remoto confiável é uma descoberta de produto, não um bug a esconder. Nessa condição, restringir autonomia e documentar revisão obrigatória.

---

## 19. Riscos, dependências e decisões pendentes

| Item | Tratamento |
|---|---|
| Interface e seletores desconhecidos | Mapeamento no navegador real antes da execução |
| Identidade remota insuficiente | Revisão e limitação de autonomia |
| Mudanças de idioma, viewport ou variante | Escopo contextual e revalidação |
| Limites e disponibilidade do serviço | Pausa sem insistência ou evasão |
| Atomicidade impossível entre banco e site | Ledger e estado `UNKNOWN` |
| Banco e arquivos sem commit conjunto | Reconciliação local |
| Interferência humana | Perfil dedicado e revalidação |
| Conteúdo sensível em evidências | Minimização, sanitização e retenção |
| Compatibilidade de SO/dependências | `Doctor` e homologação da plataforma-alvo |
| Inspeção de mídia | Decidir se `ffprobe` será obrigatório na Release B |

**Decisões a concluir antes da Release B:** modos de criação suportados, quantidade inicial de saídas, regras de custo observável, identidade remota disponível, política de conclusão parcial e limites por janela temporal.

---

## 20. Plano de entrega por gates

| Gate | Entregável | Condição de avanço |
|---|---|---|
| G1 | Configuração, banco e eventos mínimos | Falhas locais bloqueiam ações |
| G2 | Gateway e executor exclusivo | Testes de fronteira aprovados |
| G3 | Navegador, sessão e lock | Exclusão entre controladores demonstrada |
| G4 | Observação e relatório | Nenhuma mutação de trabalho |
| G5 | Bootstrap e exploração | Apenas transições aprovadas |
| G6 | Mapa contextual | Cobertura e drift explícitos; Release A aceita |
| G7 | Ledger, limites e reducers | Testes locais de crash aprovados |
| G8 | Geração única supervisionada | Envio e resultado correlacionados |
| G9 | Download e recuperação | Artefatos e estados reconciliáveis; Release B aceita |
| G10 | Lote limitado | Guardrails mantidos entre reinícios; Release C aceita |

Sem datas artificiais: estimativa de esforço será produzida após G4, quando a interface e os obstáculos reais estiverem conhecidos.

---

## 21. Definition of Done

Uma funcionalidade só está concluída quando:
- Requisito e critério de aceitação estão rastreados em testes.
- Tipos, schemas, lint e testes aplicáveis passam.
- Cenário positivo e cenários de bloqueio foram exercitados.
- Não existe bypass público de autorização.
- Evidências distinguem observado, inferido e desconhecido.
- Retomada e falhas relevantes estão documentadas.
- Não há segredo nos artefatos exportáveis de teste.
- Runbook explica o procedimento de intervenção.
- Capacidades ainda não homologadas permanecem bloqueadas.

---

## 22. Regra de precedência e mudanças

Este PRD define o que entregar e como aceitar. A arquitetura define como implementar. A política de segurança determina o que a instalação pode executar.

Conflito entre documentos não autoriza escolher a interpretação mais permissiva: registrar a divergência, bloquear a capacidade afetada e revisar os documentos. Mudanças que ampliem permissões, gasto, contexto de validade ou autonomia exigem aceite explícito e nova homologação pertinente.

---

## 23. Base deste documento

PRD elaborado a partir dos requisitos, da revisão de pontos de quebra e da arquitetura acordados nesta conversa. Os comportamentos específicos do Google Flow permanecem hipóteses até observação e validação reais.
