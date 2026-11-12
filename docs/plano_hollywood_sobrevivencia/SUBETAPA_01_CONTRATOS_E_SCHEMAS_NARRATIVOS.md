# SUBETAPA 01 — Contratos e Schemas Narrativos v4.0 (Fim do Quiz A/B e Entrada da Sobrevivência Tática)

## 1. Objetivo da Subetapa
Substituir nos contratos Pydantic da raiz do projeto ([`contratos/agentes.py`](file:///D:/CANAL%209/contratos/agentes.py) e [`contratos/estado.py`](file:///D:/CANAL%209/contratos/estado.py)) todas as estruturas de "Jogo de Múltipla Escolha A/B" e "Barras de Videogame (HUD Vida/Comida)" por estruturas de **Cinema de Sobrevivência Histórica em 2ª Pessoa** baseadas em **Manobras Táticas**, **Causalidade *"Mas / Portanto"*** e **Loops de Retenção de Hollywood**.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\contratos\agentes.py`](file:///D:/CANAL%209/contratos/agentes.py) (linhas `73–285`)
2. [`D:\CANAL 9\contratos\estado.py`](file:///D:/CANAL%209/contratos/estado.py)
3. [`D:\CANAL 9\contratos\integridade_assets.py`](file:///D:/CANAL%209/contratos/integridade_assets.py)

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Remover Literais de Quiz e Enquadramento `escolha_ab`
Em [`contratos/agentes.py`](file:///D:/CANAL%209/contratos/agentes.py):
1. Remover `"escolha_ab"`, `"hud_barras"` e `"porcentagem_final"` de `GraficoNaTelaLiteral`.
2. Atualizar `GraficoNaTelaLiteral` e `EnquadramentoPOVLiteral` para refletir apenas elementos cinematográficos diegéticos:

```python
EnquadramentoPOVLiteral = Literal[
    "aberto",
    "pov_olho",
    "pov_maos",
    "pov_baixo",
    "pov_companheiro",
    "detalhe",
    "reflexo",
]

GraficoNaTelaLiteral = Literal[
    "nenhum",
    "relogio_diegetico",
    "cartao_custo_epoca",
    "carimbo_locacao_tempo",
    "mapa_rota_fuga",
    "tela_escura",
]

ConectorCausalLiteral = Literal["portanto", "mas", "enquanto_isso"]
TipoLoopHollywoodLiteral = Literal[
    "ameaca_iminente",
    "relogio_fatal",
    "ironia_dramatica",
    "armadilha_oculta",
    "misterio_sensorial",
    "custo_humano",
]
```

### Passo 3.2 — Substituir `DecisaoBlocoEsqueleto` por `ManobraSobrevivenciaEsqueleto`
Em vez de ter `opcao_a` e `opcao_b` com `hud_delta` e `impacto_chance`, cada sequência dramática modela **como o protagonista sobrevive na prática** em contraste com o **instinto fatal comum da época**:

```python
class ManobraSobrevivenciaEsqueleto(BaseModel):
    ameaca_fisica: str = Field(
        description="O perigo concreto e sensorial que atinge você neste momento da história."
    )
    instinto_fatal_multidao: str = Field(
        description="O que a maioria das pessoas faz por impulso nesta situação e por que isso leva à morte (sustentado por fato_ids)."
    )
    acao_tatica_sobrevivente: str = Field(
        description="Como você age de forma prática, engenhosa e historicamente plausível para sobreviver usando recursos e técnicas da época."
    )
    fato_ids: List[str] = Field(default_factory=list)
    preco_ids: List[str] = Field(default_factory=list)
    conector_causal: ConectorCausalLiteral = Field(
        default="mas",
        description="Regra de Hollywood: toda solução gera uma nova complicação ('mas') ou consequência direta ('portanto')."
    )
    complicacao_resultante: str = Field(
        description="O efeito colateral físico ou novo obstáculo desencadeado pela sua manobra."
    )
```

### Passo 3.3 — Criar o Schema `LoopRetencaoHollywood` (Tríade Macro / Meso / Micro)
Adicionar em [`contratos/agentes.py`](file:///D:/CANAL%209/contratos/agentes.py) o contrato explícito de loops de retenção:

```python
class LoopRetencaoHollywood(BaseModel):
    nivel: Literal["macro", "meso", "micro"] = "meso"
    tipo: TipoLoopHollywoodLiteral
    pergunta_implicita_espectador: str = Field(
        description="A tensão aberta na mente do espectador (Efeito Zeigarnik) — nunca formulada como quiz A/B."
    )
    plantado_em_sequencia: int
    fechado_em_sequencia: Optional[int] = None
```

### Passo 3.4 — Substituir `HudInicialEsqueleto` e `ResultadoEsqueleto` por `ContextoSobrevivenciaEpoca` e `DesfechoHistoricoEsqueleto`
1. Remover a obrigatoriedade de `hud_inicial` (`vida: 100, comida: 100`) e `resultado.tabela_espectador`.
2. Criar `ContextoSobrevivenciaEpoca`:
   - `oficio_protagonista`: profissão real da época e ferramentas às quais tem acesso.
   - `recursos_iniciais`: itens físicos e moedas reais no bolso (vinculados a `preco_ids`).
   - `taxa_mortalidade_real`: dado demográfico/histórico real (`mortalidade_ids`).
3. Criar `DesfechoHistoricoEsqueleto`:
   - `como_sobreviveu_resumo`: síntese causal das manobras físicas que permitiram escapar com vida.
   - `destino_companheiro`: desfecho sóbrio do companheiro baseado nos fatos históricos.
   - `registro_historico_real`: evidência arqueológica ou crônica primária da época.

### Passo 3.5 — Validador de Proibição de Quiz A/B em `contratos/integridade_assets.py`
Adicionar a função `validar_ausencia_quiz_escolha_ab(planos_ou_blocos)` em [`contratos/integridade_assets.py`](file:///D:/CANAL%209/contratos/integridade_assets.py) que inspeciona textos e prompts e dispara erro fatal caso detecte:
- `"opção a"`, `"opção b"`, `"opcao a"`, `"opcao b"`
- `"escolha a sua"`, `"qual você escolheria"`, `"você escolheria"`
- `"cinco segundos para escolher"`, `"faça a sua conta"`
- `enquadramento == "escolha_ab"` ou `grafico.tipo == "escolha_ab"`

---

## 4. Critérios de Aceite da Subetapa 01
- [ ] `ArquitetoEstruturaOutput` e `RoteiristaOutput` validam o novo formato de 8 Sequências sem exigir `decisao`, `opcao_a`, `opcao_b`, `hud_inicial` ou `tabela_espectador`.
- [ ] `validar_ausencia_quiz_escolha_ab` bloqueia qualquer tentativa de inserir perguntas de múltipla escolha A/B no roteiro ou nos planos visuais.
- [ ] Testes unitários de schema passam com `pytest`.
