# SUBETAPA 04 — Auditores de Retenção de Hollywood, Fidelidade e Tom

## 1. Objetivo da Subetapa
Atualizar os 3 agentes revisores do Departamento de Roteiro (`roteiro.editor_retencao`, `roteiro.revisor_fidelidade`, `roteiro.revisor_tom`) tanto nos arquivos de prompt (`.md`) quanto nos nós de código em [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L994-L1092) para auditar a **Curva de Retenção de Cinema de Hollywood**, a **plausibilidade histórica das manobras de sobrevivência** e a **ausência absoluta de mecânicas de quiz A/B**.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\prompts\roteiro\03-editor-de-retencao.md`](file:///D:/CANAL%209/prompts/roteiro/03-editor-de-retencao.md)
2. [`D:\CANAL 9\prompts\roteiro\04-revisor-de-fidelidade.md`](file:///D:/CANAL%209/prompts/roteiro/04-revisor-de-fidelidade.md)
3. [`D:\CANAL 9\prompts\roteiro\05-revisor-de-tom.md`](file:///D:/CANAL%209/prompts/roteiro/05-revisor-de-tom.md)
4. [`D:\CANAL 9\grafo\roteiro\subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py) (linhas `994–1092`)

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Reescrever `prompts/roteiro/03-editor-de-retencao.md` (Auditor de Loops de Hollywood)
Substituir as regras antigas (que cobravam *"barras cheias na Entrada"*, *"3 a 5 decisões A/B"* e *"entrega da porcentagem final"*) pelos **5 Critérios Bloqueantes de Retenção de Hollywood**:

1. **Cold Open *In Media Res* ($\le 35\text{s}$)**: Os primeiros `35s` devem abrir com impacto sensorial imediato, um *Erro de Previsão* que quebra o senso comum do espectador, o disparo do Relógio Diegético e o Macro-Loop de sobrevivência. Se ultrapassar `45s` ou começar de forma passiva/escolar, **REPROVAR COM `[BLOQUEANTE]`**.
2. **Densidade de Micro-Loops (Teto de `60s` Sem Virada)**: Nenhum trecho de `60 segundos` (ou 4 planos consecutivos) pode passar sem uma complicação causal (*"Mas / Portanto"*), uma ironia dramática histórica ou uma descoberta sensorial.
3. **Fechamento Atrasado de Loops (Delayed Payoff / Zeigarnik)**: Todo fim de sequência (`0..5`) deve terminar em um *Cliffhanger de Ação* antes da resolução física, que só é fechada no 1º plano da sequência seguinte (`fecha_loop`).
4. **Proibição Estrita de Quiz A/B**: Qualquer pergunta do tipo *"O que você faria?"*, *"Opção A ou Opção B"*, *"Qual você escolheria?"* gera **`[BLOQUEANTE]` imediato** por quebra de fluxo cinematográfico.
5. **Midpoint Reversal & Silêncio Dramático**: A sequência central (Seq 4) deve conter uma reversão real de expectativa (o abrigo seguro vira armadilha), e a penúltima sequência (Seq 6 — *Ponto Sem Volta*) deve conter o pagamento do Objeto Plantado (Arma de Chekhov) seguido de `1.50s` de Silêncio Dramático absoluto.

### Passo 3.2 — Atualizar `editor_retencao_node` em `grafo/roteiro/subgrafo.py`
Atualizar [`editor_retencao_node`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L994-L1026) para verificar programaticamente:
1. `tempo_gancho <= 45.0` no bloco inicial.
2. Ausência de frases de quiz (`FRASES_QUIZ_PROIBIDAS_V4`) em todos os blocos.
3. Presença de conectores causais e ganchos de fim de bloco (nenhum bloco intermediário termina de forma episódica fechada sem tensão pendente).

### Passo 3.3 — Atualizar `04-revisor-de-fidelidade.md` e `revisor_fidelidade_node`
Garantir que o Revisor de Fidelidade audite:
1. **Veracidade das Manobras de Sobrevivência**: toda técnica usada pelo protagonista para sobreviver (ex.: filtrar cinza com linho molhado, identificar gás carbônico/sulfuroso junto ao solo, usar moeda/ferramenta específica da época) deve ser fisicamente possível em `ano/data` do episódio e vinculada a `fato_ids` verificados (zero anacronismo tecnológico).
2. **Veracidade do Erro da Multidão**: o comportamento coletivo letal mostrado em contraste com o protagonista deve refletir dados arqueológicos ou crônicas reais da época (`fato_ids` / `mortalidade_ids`).

### Passo 3.4 — Atualizar `05-revisor-de-tom.md` e `revisor_tom_node`
Garantir que o Revisor de Tom:
1. Bloqueie gírias modernas (`GIRIAS_PROIBIDAS`) **e** jargões de videogame/RPG (`"suas barras"`, `"pontos de vida"`, `"HP"`, `"game over"`, `"escolha a opção"`, `"comenta sua porcentagem"`).
2. Valide o tom de **thriller histórico em 2ª pessoa**: frases curtas e cortantes nos picos de perigo (`3 a 7 palavras`), concretude sensorial (cheiro, temperatura, peso, textura) antes da explicação histórica.

---

## 4. Critérios de Aceite da Subetapa 04
- [ ] `editor_retencao_node`, `revisor_fidelidade_node` e `revisor_tom_node` reprovam com `[BLOQUEANTE]` qualquer roteiro que contenha perguntas de escolha A/B ou jargão de HUD/RPG.
- [ ] `editor_retencao_node` valida o gancho $\le 45\text{s}$ e a presença de loops de retenção entre sequências.
