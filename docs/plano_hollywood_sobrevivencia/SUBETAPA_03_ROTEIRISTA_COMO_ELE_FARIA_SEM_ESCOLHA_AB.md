# SUBETAPA 03 — Roteirista: "Como Ele Faria para Sobreviver" (Zero Quiz A/B)

## 1. Objetivo da Subetapa
Transformar o agente **Roteirista** ([`prompts/roteiro/02-roteirista.md`](file:///D:/CANAL%209/prompts/roteiro/02-roteirista.md) e [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py)) de um "apresentador de jogo de escolhas" em um **Narrador Cinematográfico de Sobrevivência Imersiva em 2ª Pessoa**. Em vez de perguntar *"O que você escolheria?"*, a narração coloca o espectador na pele de alguém da época e demonstra **como ele agiria passo a passo para sobreviver**, usando a técnica dos **6 Movimentos de Cena de Hollywood**.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\prompts\roteiro\02-roteirista.md`](file:///D:/CANAL%209/prompts/roteiro/02-roteirista.md)
2. [`D:\CANAL 9\grafo\roteiro\subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py) (linhas `783–925`: `PALAVRAS_PROIBIDAS_ROTEIRISTA_V3`, `validar_bloco_roteirista_v3`, `roteirista_node`)

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Nova Fórmula do Cold Open (Primeiros 35 segundos, Sem "Barras Cheias")
Substituir a abertura ritual antiga (*"[Bip. As barras aparecem cheias] Vida: cheia. Comida: cheia..."*) na Seção 4 de [`prompts/roteiro/02-roteirista.md`](file:///D:/CANAL%209/prompts/roteiro/02-roteirista.md) pelos **4 Tempos do Cold Open de Hollywood**:

| Tempo | Janela | Função Cinematográfica | Exemplo Prático |
|---|---|---|---|
| **1. Choque Sensorial *In Media Res*** | `0–7s` | Começa pelo sentido físico imediato (tato, cheiro, som) e crava lugar + data + ofício. | *"Pompeia, vinte e quatro de agosto do ano setenta e nove. Uma hora da tarde. O chão da sua padaria treme tanto que a farinha salta da mesa de pedra."* |
| **2. Erro de Previsão (*Prediction Error*)** | `7–17s` | Destrói o mito que o espectador traz na cabeça com um fato contraintuitivo real. | *"Você acha que a lava vai invadir as ruas. Não existe lava aqui. O que vai matar nove em cada dez pessoas que ficarem é uma chuva branca e leve que já está tapando o sol."* |
| **3. Situação Real do Sobrevivente + Relógio** | `17–26s` | O que você realmente tem nas mãos e na bolsa (convertido em `R$`) e o prazo fatal. | *"Você tem vinte e dois anos, doze sestércios no cinto — uns cento e oitenta reais — e uma pá de madeira no forno. Em dezoito horas, esta cidade inteira vai estar seis metros debaixo da terra."* |
| **4. Macro-Loop de Sobrevivência** | `26–35s` | Planta a grande pergunta dramática de **como fazer para sair vivo** (sem quiz A/B!). | *"Para sair vivo daqui antes do ar queimar a sua garganta, cada movimento das suas mãos nas próximas horas precisa vencer a física do vulcão."* |

### Passo 3.2 — Os 6 Movimentos de Cada Sequência de Sobrevivência (Substituindo `opcoes` A/B)
Na Seção 5 de [`prompts/roteiro/02-roteirista.md`](file:///D:/CANAL%209/prompts/roteiro/02-roteirista.md), substituir os movimentos antigos (`fecha_loop`, `situa`, `ameaca`, `opcoes`, `consequencia`, `loop_aberto`) pelos **6 Movimentos de Ação e Retenção de Hollywood**:

1. **`fecha_loop` (Payoff Imediato — 15 a 25 palavras)**: Resolve em ação física imediata o cliffhanger deixado pelo último segundo da sequência anterior.
2. **`pressao_ambiente` (Relógio + Sentidos — 25 a 35 palavras)**: Atualiza a passagem do tempo e o agravamento físico do ambiente e das suas mãos.
3. **`erro_da_multidao` (Contraste Histórico — 40 a 60 palavras)**: Mostra o que o pânico leva as pessoas ao redor a fazerem (com base em `fato_ids`) e o motivo físico/biológico pelo qual essa reação é uma armadilha fatal.
4. **`manobra_tatica` ("Como Você Faz para Sobreviver" — 70 a 90 palavras)**: Descreve passo a passo o que **você** faz com as próprias mãos (`pov_maos` / `pov_olho`), usando ferramentas, materiais e conhecimentos disponíveis naquela época (ex.: amarrar almofada de lã com corda de cânhamo contra projéteis de pedra-pomes, testar direção do vento, umedecer linho grosso em água de cisterna).
5. **`complicacao_mas_portanto` (Micro-Loop / Virada Causal — 45 a 65 palavras)**: Aplica a regra *"Sim, mas..."*: sua manobra salva você da ameaça imediata, **mas** desencadeia um obstáculo inesperado.
6. **`cliffhanger_loop` (Gancho de Corte Seco — 15 a 25 palavras)**: Termina a sequência exatamente no instante em que uma nova ameaça se materializa na sua frente, cortando no ápice da tensão para a próxima sequência.

### Passo 3.3 — Atualizar Validador `validar_bloco_roteirista_v3` em `grafo/roteiro/subgrafo.py`
Em [`grafo/roteiro/subgrafo.py`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py) (linhas `783–925`):
1. Adicionar `FRASES_QUIZ_PROIBIDAS_V4`:
   ```python
   FRASES_QUIZ_PROIBIDAS_V4 = [
       "opção a",
       "opção b",
       "opcao a",
       "opcao b",
       "escolha a sua",
       "você tem duas opções",
       "voce tem duas opcoes",
       "qual você escolheria",
       "o que você escolheria",
       "cinco segundos para escolher",
       "faça a sua conta",
       "comenta a sua porcentagem",
       "vida: cheia",
       "comida: cheia",
       "suas barras estão cheias",
   ]
   ```
2. Remover a regra 6 antiga (linhas `901–914`) que exigia `grafico.tipo == "escolha_ab"` e `"[PAUSA 2s] Escolha a sua."`.
3. Adicionar a regra v4.0 que:
   - **Reprova imediatamente** qualquer plano cujo `texto` contenha termos de `FRASES_QUIZ_PROIBIDAS_V4` ou `enquadramento == "escolha_ab"`.
   - **Exige** que cada sequência tenha os movimentos `erro_da_multidao`, `manobra_tatica` e `cliffhanger_loop` preenchidos e com `fato_ids` verificados.

---

## 4. Critérios de Aceite da Subetapa 03
- [ ] Nenhum plano gerado pelo Roteirista contém perguntas de escolha A/B, pausas de quiz ou menções a barras de videogame.
- [ ] Toda sequência descreve em 2ª pessoa (`"você"`) como o sobrevivente executa na prática a manobra histórica de sobrevivência com as próprias mãos.
- [ ] O validador [`validar_bloco_roteirista_v3`](file:///D:/CANAL%209/grafo/roteiro/subgrafo.py#L814-L925) bloqueia automaticamente qualquer regressão para o modelo de escolhas A/B.
