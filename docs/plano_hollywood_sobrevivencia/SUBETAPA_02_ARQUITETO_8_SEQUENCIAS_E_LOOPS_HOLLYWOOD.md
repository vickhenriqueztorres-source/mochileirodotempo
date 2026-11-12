# SUBETAPA 02 — Arquiteto de 8 Sequências e Loops de Retenção de Hollywood

## 1. Objetivo da Subetapa
Reescrever o prompt de sistema do **Arquiteto de Estrutura** ([`prompts/roteiro/01-arquiteto-de-estrutura.md`](file:///D:/CANAL%209/prompts/roteiro/01-arquiteto-de-estrutura.md)) e o validador determinístico em código ([`validar_esqueleto_arquiteto_v30`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L195-L598)) para substituir a estrutura de "5 Decisões A/B" pela **Arquitetura de 8 Sequências de Sobrevivência de Hollywood**, focada em **como o protagonista sobrevive naquela época** através de engenharia prática, recursos reais e loops de retenção aninhados.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\prompts\roteiro\01-arquiteto-de-estrutura.md`](file:///D:/CANAL%209/prompts/roteiro/01-arquiteto-de-estrutura.md)
2. [`D:\CANAL 9\grafo\roteiro\subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py) (constantes `BLOCOS_OFICIAIS_*` nas linhas `24–70` e validador nas linhas `195–600`)

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Definir as 8 Sequências Cinematográficas Oficiais (`SEQUENCIAS_HOLLYWOOD_V40`)
Em [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py), adicionar a lista canônica das 8 sequências (inspirada no *Sequence Approach* de Frank Daniel / Hollywood):

```python
SEQUENCIAS_HOLLYWOOD_V40 = [
    "Seq 0 · Cold Open In Media Res",
    "Seq 1 · O Ofício e a Arma de Chekhov",
    "Seq 2 · O Choque Inicial e o Erro da Multidão",
    "Seq 3 · Escalada Física e Improviso Tático",
    "Seq 4 · A Grande Virada (Midpoint Reversal)",
    "Seq 5 · O Preço Humano e o Limite do Corpo",
    "Seq 6 · Tudo Está Perdido e o Ponto Sem Volta",
    "Seq 7 · O Dia Seguinte e o Registro Histórico",
]
```

### Passo 3.2 — Estruturar o Papel Dramático de Cada Sequência no Prompt `01-arquiteto-de-estrutura.md`
Substituir a tabela da Seção 3 de [`prompts/roteiro/01-arquiteto-de-estrutura.md`](file:///D:/CANAL%209/prompts/roteiro/01-arquiteto-de-estrutura.md) pela seguinte arquitetura:

| # | Sequência | Função no Cinema de Sobrevivência | Mecânica de Retenção (Hollywood Loop) |
|---|---|---|---|
| **0** | **Cold Open In Media Res** (`0:00–0:35`) | Joga o espectador direto no meio do impacto sensorial da época + *Erro de Previsão* que destrói o clichê escolar + disparo do **Relógio Diegético**. | Abre o **Macro-Loop**: *"Como um trabalhador comum, apenas com as ferramentas do corpo e do ofício, escapa vivo das próximas X horas?"* |
| **1** | **O Ofício e a Arma de Chekhov** (`0:35–1:45`) | Mostra quem você é naquela época, quanto vale o seu suor em `R$`, apresenta o **Companheiro** e planta discretamente a **Arma de Chekhov** (`objeto_plantado`) + o 1º sinal físico anomalístico da catástrofe. | **Ironia Dramática**: o espectador percebe o sinal letal antes dos habitantes da época. |
| **2** | **O Choque Inicial e o Erro da Multidão** (`1:45–3:15`) | O perigo explode. Mostra o que a maioria das pessoas faz por pânico (e por que morrem) vs. a sua **1ª Manobra Tática de Sobrevivência** baseada no conhecimento prático da época. | Conector **"Sim, mas..."**: você escapa do primeiro impacto, **MAS** a saída principal fica bloqueada. |
| **3** | **Escalada Física e Improviso Tático** (`3:15–4:45`) | Escassez de ar, água, luz ou abrigo. Você usa física/química/engenharia rudimentar da época (ex.: tecido embebido, alavanca, vedação, suborno calculado) para vencer o obstáculo. | **Micro-Loop no meio + Cliffhanger no fim**: a ferramenta funciona, **MAS** revela um perigo maior no ambiente. |
| **4** | **A Grande Virada (*Midpoint Reversal*)** (`4:45–6:00`) | **Quebra de Expectativa Central**: o lugar ou estratégia que parecia a salvação definitiva (ex.: adega abobadada, muralha, porto, hospital da época) revela-se uma armadilha mortal comprovada pelas fontes. | Força mudança radical de rota com metade do tempo esgotado no relógio. |
| **5** | **O Preço Humano e o Limite do Corpo** (`6:00–7:00`) | Seu corpo entra no estado `desgastado` / `no_limite`. O Companheiro cede ao cansaço ou ao erro humano da época; você executa uma manobra desesperada para tentar salvá-lo ou seguir adiante. | **Loop Emocional**: o custo humano real da sobrevivência na época. |
| **6** | **Tudo Está Perdido e o Ponto Sem Volta** (`7:00–8:00`) | *All Hope Is Lost*: encurralado no pico letal do evento. Você usa o **Objeto Plantado na Seq 1 (Payoff de Chekhov)** na última manobra de vida ou morte + **Silêncio Dramático absoluto de `1.50s`**. | Clímax sensorial máximo antes da resolução. |
| **7** | **O Dia Seguinte e o Registro Histórico** (`8:00–8:45`) | Resolução física do Macro-Loop: como o seu corpo sobreviveu, o destino real do Companheiro, os números reais das fontes primárias e o *Callback* visual da abertura. | Fechamento catártico sem jargão de videogame. |

### Passo 3.3 — Regras de Validação em Código (`validar_esqueleto_arquiteto_v40`)
Em [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py):
1. **Validar Conectores Causais (`"mas"` / `"portanto"`)**: 100% das sequências `1..6` devem declarar `manobra.conector_causal` $\in$ `{"mas", "portanto"}` e `manobra.complicacao_resultante` não-vazio.
2. **Validar Dupla de Sobrevivência Prática**: Toda sequência `2..6` deve conter `instinto_fatal_multidao` (o erro que mata na época) e `acao_tatica_sobrevivente` (como você faz diferente para sobreviver), ambos vinculados a `fato_ids` reais da pesquisa.
3. **Validar Aninhamento de Loops (`loop_aberto`)**:
   - Proibir dois blocos consecutivos com o mesmo `loop_aberto.tipo`.
   - Exigir que todo `loop_aberto` nas sequências `0..5` aponte para `fechado_em > ordem`.
   - Exigir pelo menos 1 `micro_loop_meio` em cada sequência de ação (`2..6`).
4. **Validar Plantio e Pagamento de Chekhov (`objeto_plantado`)**:
   - Plantado obrigatoriamente na `Seq 1` e pago obrigatoriamente na `Seq 6` (*Ponto Sem Volta*).
5. **Validar Progressão Monotônica do Relógio (`relogio`)** e **Degradação Física (`corpo_estado`: `inteiro` $\to$ `desgastado` $\to$ `no_limite`)** sem depender de barras de RPG.

---

## 4. Critérios de Aceite da Subetapa 02
- [ ] [`prompts/roteiro/01-arquiteto-de-estrutura.md`](file:///D:/CANAL%209/prompts/roteiro/01-arquiteto-de-estrutura.md) não contém nenhuma menção a `"Decisão A/B"`, `"HUD de Vida/Comida"` ou `"Tabela de porcentagem do espectador"`.
- [ ] O validador aprova esqueletos de 8 sequências com manobras táticas e loops de retenção e reprova qualquer esqueleto sem causalidade `"mas"/"portanto"` ou sem `fato_ids`.
