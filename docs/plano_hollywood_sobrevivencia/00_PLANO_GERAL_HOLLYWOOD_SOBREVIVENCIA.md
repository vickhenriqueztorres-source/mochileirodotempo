# PLANO GERAL — Reformulação Raiz: Narrativa de Sobrevivência Histórica com Loops de Retenção de Hollywood (v4.0)

## 1. Diagnóstico do Problema Raiz e Mudança de Paradigma

O modelo anterior (`v3.0 / v3.1`) operava como um **quiz/RPG interativo** (*"Você tem duas opções: Opção A ou Opção B. Cinco segundos para escolher"*, tela dividida `escolha_ab`, barras de videogame `VIDA % | COMIDA %` e cálculo de porcentagem final). Esse formato:
1. **Quebra a imersão cinematográfica** ao interromper a tensão dramática com perguntas de múltipla escolha e pausas artificiais (`[PAUSA 2s] Escolha a sua`).
2. **Enfraquece a retenção orgânica**, substituindo a progressão causal de cinema por paradas mecânicas repetitivas.
3. **Desvia do foco central do canal**: mostrar **como você realmente sobreviveria naquela época** — o que faria passo a passo com as ferramentas, leis, ciência empírica e recursos reais do período enquanto a maioria ao redor comete erros fatais.

---

## 2. Novo Paradigma v4.0: "Como Você Sobreviveria na Época" + Engenharia de Retenção de Hollywood

| Critério | Modelo Antigo (v3.0/v3.1 — Descartado) | Novo Modelo Raiz (v4.0 — Cinema de Sobrevivência POV) |
|---|---|---|
| **Mecânica Central** | Quiz *"Você escolheria X ou Y?"* com pausa de escolha | **Sobrevivência Tática Contínua**: o que você faz na prática para sobreviver hora a hora na época |
| **Estrutura de Atos** | 5 Decisões A/B + Tabela de % Final | **8 Sequências Cinematográficas de Hollywood** com causalidade *"Mas / Portanto"* (*Yes, But / No, And*) |
| **Motor de Retenção** | Pergunta de opção A/B no fim do bloco | **Tríade de Loops de Hollywood**: Macro-Loop (*Ticking Clock* + *Chekhov's Gun*), Meso-Loop (*Cliffhanger* de corte seco entre sequências) e Micro-Loop (pulso de ironia dramática / erro de previsão a cada `45–60s`) |
| **Contraste de Sobrevivência** | Opção A vs. Opção B na tela dividida | **Instinto da Multidão (Fatal) vs. Manobra Tática do Sobrevivente (Você)**: mostra o que 90% das pessoas fizeram e por que falhou, seguido de como você age diferente para escapar |
| **Enquadramentos POV** | Incluía `escolha_ab` (bifurcação simétrica) | `aberto`, `pov_olho`, `pov_maos`, `pov_baixo`, `pov_companheiro`, `detalhe`, `reflexo` (máx. 1 por episódio) — **zero `escolha_ab`** |
| **Grafismo de Tela** | HUD de videogame (`VIDA 85% \| COMIDA 70%`) | **Timecode / Relógio Diegético de Cinema** discreto (`POMPEIA · 15H10 · HORA +02 DA ERUPÇÃO`) + estado físico real nas mãos/respiração (`intacto` $\to$ `desgastado` $\to$ `no_limite`) |

---

## 3. Arquitetura dos Loops de Retenção de Hollywood Aplicada ao Roteiro

```mermaid
flowchart LR
    S0["Seq 0: Cold Open In Media Res\n(Erro de Previsão + Relógio)"] -->|"Loop 1: Ameaça Imediata"| S1["Seq 1: O Ofício & A Arma de Chekhov\n(Recursos Reais da Época)"]
    S1 -->|"Mas... (Complicação 1)"| S2["Seq 2: O Erro da Multidão vs. Manobra 1\n(Como sobreviver ao 1º choque)"]
    S2 -->|"Portanto / Mas..."| S3["Seq 3: Escassez & Adaptação Tática\n(Improviso com técnica da época)"]
    S3 -->|"Cliffhanger de Meio"| S4["Seq 4: Midpoint Reversal\n(O refúgio seguro vira armadilha)"]
    S4 -->|"Custo Humano"| S5["Seq 5: O Sacrifício & Perda de Recurso\n(Companheiro em risco extremo)"]
    S5 -->|"Tudo Está Perdido"| S6["Seq 6: Ponto Sem Volta + Chekhov Payoff\n(Silêncio Dramático 1.5s)"]
    S6 -->|"Resolução Física"| S7["Seq 7: O Dia Seguinte & Prova Histórica\n(Registro Real + Fechamento)"]
```

### As 5 Leis de Retenção de Hollywood no Código:
1. **Lei da Causalidade Estrita (*"Portanto / Mas"* — *South Park / Hollywood Rule*)**: É proibido conectar cenas com *"E depois..."*. Toda manobra de sobrevivência que você executa resolve o perigo imediato **MAS** gera um efeito colateral físico ou ambiental pior (*"Sim, você bloqueia a fresta com lã molhada, MAS o peso da pedra-pomes no teto começa a envergar a viga central"*).
2. **Lei do Contraste Prático (*Instinto Fatal vs. Técnica de Sobrevivência*)**: Em vez de perguntar *"Você fugiria pelo mar ou pela estrada?"*, o narrador mostra o erro humano real (*"A multidão corre para os barcos no píer — sem saber que o recuo sísmico da água vai virar os cascos em três minutos. Você faz o oposto:..."*) e detalha **como** você executa a técnica que funciona naquela época.
3. **Lei dos 3 Níveis de Loop Aberto (Efeito Zeigarnik)**:
   - **Macro-Loop (Episódio)**: Plantado nos primeiros `30s` (o prazo fatal do relógio + o objeto aparentemente comum plantado na Seq 1 que salvará sua vida na Seq 6).
   - **Meso-Loop (Fim de cada Sequência)**: Toda sequência termina no pico de uma complicação física antes da resposta (`loop_aberto`), e o 1º plano da sequência seguinte resolve a ação em movimento (`fecha_loop`).
   - **Micro-Loop (A cada 45–60s / 3 a 4 planos)**: Um dado sensorial contraintuitivo ou ironia dramática histórica que impede queda na curva de retenção.
4. **Lei da Degradação Física Visível (Substituindo Barras de RPG)**: O desgaste não é um número artificial de `VIDA 40%`, mas visível no **DNA das suas mãos/antebraços em POV** (`intacto` $\to$ `desgastado` $\to$ `no_limite`) e audível no desenho de som.
5. **Lei de Ritmo Contínuo**: Janelas de áudio e vídeo cravadas na duração real da fala (`0.20s` de respiro, corte seco nos takes internos e movimento 100% progressivo sem `reverse`).

---

## 4. Divisão em 6 Subetapas Completas (Arquivos `.md` Passo a Passo)

Cada subetapa possui um documento `.md` próprio e autocontido em `D:\CANAL 9\docs\plano_hollywood_sobrevivencia\` com o passo a passo exato de implementação, contratos, arquivos afetados e critérios de aceite:

1. **[SUBETAPA 01 — Contratos e Schemas Narrativos v4.0](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_01_CONTRATOS_E_SCHEMAS_NARRATIVOS.md)**
   - Atualização de [`contratos/agentes.py`](file:///D:/CANAL%209/contratos/agentes.py) e [`contratos/estado.py`](file:///D:/CANAL%209/contratos/estado.py): substituição de `DecisaoBlocoEsqueleto`, `OpcaoDecisaoEsqueleto`, `HudInicialEsqueleto` e `escolha_ab` por `ManobraSobrevivenciaEsqueleto`, `LoopRetencaoHollywood` (`macro`, `meso`, `micro`), `conector_causal` (`"portanto"` | `"mas"`) e `progressao_fisica`.
2. **[SUBETAPA 02 — Arquiteto de 8 Sequências e Loops de Hollywood](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_02_ARQUITETO_8_SEQUENCIAS_E_LOOPS_HOLLYWOOD.md)**
   - Reescrita de [`prompts/roteiro/01-arquiteto-de-estrutura.md`](file:///D:/CANAL%209/prompts/roteiro/01-arquiteto-de-estrutura.md) e do validador [`validar_esqueleto_arquiteto_v30`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L195-L598) para exigir as 8 Sequências Cinematográficas, plantio/pagamento da Arma de Chekhov, progressão do relógio e proibição de perguntas A/B.
3. **[SUBETAPA 03 — Roteirista: "Como Ele Faria para Sobreviver" (Zero Quiz A/B)](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_03_ROTEIRISTA_COMO_ELE_FARIA_SEM_ESCOLHA_AB.md)**
   - Reescrita de [`prompts/roteiro/02-roteirista.md`](file:///D:/CANAL%209/prompts/roteiro/02-roteirista.md) e [`validar_bloco_roteirista_v3`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L814-L925): bloqueio por regex de *"Opção A"*, *"Opção B"*, *"Você escolheria"*, *"Escolha a sua"*, e estruturação de cada sequência em 6 movimentos de cinema (`fecha_loop` $\to$ `pressao_ambiente` $\to$ `erro_da_multidao` $\to$ `manobra_tatica` $\to$ `complicacao_mas_portanto` $\to$ `cliffhanger_loop`).
4. **[SUBETAPA 04 — Auditores de Retenção de Hollywood, Fidelidade e Tom](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_04_AUDITOR_RETENCAO_HOLLYWOOD_E_FIDELIDADE.md)**
   - Atualização de [`prompts/roteiro/03-editor-de-retencao.md`](file:///D:/CANAL%209/prompts/roteiro/03-editor-de-retencao.md), [`04-revisor-de-fidelidade.md`](file:///D:/CANAL%209/prompts/roteiro/04-revisor-de-fidelidade.md), [`05-revisor-de-tom.md`](file:///D:/CANAL%209/prompts/roteiro/05-revisor-de-tom.md) e nós em [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L994-L1092) para auditar densidade de loops abertos (mínimo 1 micro-loop a cada 60s), ausência total de quiz A/B e rigor histórico das técnicas de sobrevivência.
5. **[SUBETAPA 05 — Direção de Cenas POV, DNA Visual e Fim do Split-Screen A/B](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_05_DIRECAO_POV_DNA_E_FIM_DO_SPLIT_AB.md)**
   - Atualização de [`prompts/cenas/01-diretor-de-cenas.md`](file:///D:/CANAL%209/prompts/cenas/01-diretor-de-cenas.md) e [`grafo/direcao/engenheiro_prompt_imagem.py`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py): remoção definitiva do enquadramento `escolha_ab` e substituição por planos de ação tática em 1ª pessoa (`pov_maos`, `pov_olho`, `detalhe` de engenharia/improviso histórico) com DNA canônico imutável.
6. **[SUBETAPA 06 — Conformação de Vídeo Diegética (Sem HUD RPG) e Testes E2E](file:///D:/CANAL%209/docs/plano_hollywood_sobrevivencia/SUBETAPA_06_CONFORMACAO_VIDEO_DIEGETICA_E_TESTES_E2E.md)**
   - Atualização de [`orquestrador_episodio_puro_firefly.py`](file:///D:/CANAL%209/orquestrador_episodio_puro_firefly.py) e scripts de produção para substituir a barra de videogame (`VIDA % | COMIDA %`) por *Lower-Third / Timecode Diegético* de cinema (`LUGAR · HORÁRIO · CONTAGEM REGRESSIVA`) e suíte de testes automatizados (`pytest`).
