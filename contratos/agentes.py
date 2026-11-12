"""Esquemas de Saída dos 48 Agentes (Doc 05 §3 e Fichas Individuais).

Define esquemas Pydantic para as saídas estruturadas dos agentes em todos os departamentos.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 0. Supervisor
# ---------------------------------------------------------------------------
class ShowrunnerDecisao(BaseModel):
    proximo_passo: str
    status_episodio: str
    rota: Optional[str] = None
    acao_orcamento: Literal["continuar", "pausar_teto", "escalar"] = "continuar"
    escalada_humana: Optional[Dict[str, Any]] = None
    licoes_a_injetar: List[Dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 1. Pesquisa
# ---------------------------------------------------------------------------
class FonteItem(BaseModel):
    canto_verso: str
    obra: str
    autor: str
    texto_original: str
    traducao_pt: str
    dominio_publico: bool = True
    url_ou_referencia: str


class PesquisadorFontesOutput(BaseModel):
    fontes: List[FonteItem]
    nomes_canonicos: Dict[str, str] = Field(description="Ex.: Ulisses -> Odisseu")


class FatoItem(BaseModel):
    id: str
    descricao: str
    fontes_confirmadas: List[str]
    variante_ou_tardia: bool = False
    grau_certeza: Literal["canonica", "variante", "apocrifa"] = "canonica"


class VerificadorFatosOutput(BaseModel):
    fatos: List[FatoItem]
    controversias: List[str] = Field(default_factory=list)


class AnalistaReferenciaOutput(BaseModel):
    metricas_ritmo: Dict[str, Any]
    densidade_cortes_ppm: float
    lacunas_identificadas: List[str]


class DemandaAnguloItem(BaseModel):
    angulo: str
    volume_busca_estimado: str
    concorrencia: str
    score: float


class AnalistaDemandaOutput(BaseModel):
    angulos_ranqueados: List[DemandaAnguloItem]
    angulo_recomendado: str


# ---------------------------------------------------------------------------
# 2. Roteiro (v3.0.0 — SOBREVIDA · As 5 Decisões + Decupagem por Beats)
# ---------------------------------------------------------------------------
HoraDoDiaLiteral = Literal["amanhecer", "manha", "meio_dia", "tarde", "por_do_sol", "noite"]
EnquadramentoLiteral = Literal["aberto", "medio", "close"]
NicoEstadoLiteral = Literal["saudavel_nervoso", "sujo_faminto", "exausto_ferido"]
CorpoEstadoLiteral = Literal["inteiro", "desgastado", "no_limite"]
GraficoNaTelaLiteral = Literal[
    "nenhum",
    "relogio_diegetico",
    "cartao_custo_epoca",
    "carimbo_locacao_tempo",
    "mapa_rota_fuga",
    "tela_escura",
    # Retrocompatibilidade legada
    "hud_barras",
    "escolha_ab",
    "porcentagem_final",
    "cartao_preco",
    "carimbo_transicao",
    "mapinha",
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
        description="Regra de Hollywood: toda solução gera uma nova complicação ('mas') ou consequência direta ('portanto').",
    )
    complicacao_resultante: str = Field(
        description="O efeito colateral físico ou novo obstáculo desencadeado pela sua manobra."
    )


class LoopRetencaoHollywood(BaseModel):
    nivel: Literal["macro", "meso", "micro"] = "meso"
    tipo: TipoLoopHollywoodLiteral = "ameaca_iminente"
    pergunta_implicita_espectador: str = Field(
        description="A tensão aberta na mente do espectador (Efeito Zeigarnik) — nunca formulada como quiz A/B."
    )
    plantado_em_sequencia: int = 0
    fechado_em_sequencia: Optional[int] = None


class ContextoSobrevivenciaEpoca(BaseModel):
    oficio_protagonista: str
    ferramentas_acessiveis: List[str] = Field(default_factory=list)
    recursos_iniciais_epoca: str = ""
    recursos_iniciais_brl: float = 0.0
    preco_ids: List[str] = Field(default_factory=list)
    taxa_mortalidade_real: str = ""
    mortalidade_ids: List[str] = Field(default_factory=list)


class DesfechoHistoricoEsqueleto(BaseModel):
    como_sobreviveu_resumo: str
    destino_companheiro: str
    registro_historico_real: str
    fato_ids: List[str] = Field(default_factory=list)


class LocacaoItem(BaseModel):
    id: str
    nome: Optional[str] = None
    descricao: Optional[str] = None
    descricao_base: Optional[str] = None
    fato_ids: List[str] = Field(default_factory=list)


class ChanceBaseEsqueleto(BaseModel):
    valor: int
    mortalidade_ids: List[str] = Field(default_factory=list)
    explicacao: str


class HudDinheiroInicial(BaseModel):
    valor_epoca: str
    valor_brl: float = 0.0
    preco_ids: List[str] = Field(default_factory=list)


class HudInicialEsqueleto(BaseModel):
    vida: int = 100
    comida: int = 100
    dinheiro: HudDinheiroInicial


class CompanheiroEsqueleto(BaseModel):
    nome: str
    ficcional: bool = True
    funcao: str
    desejo: str
    descricao_visual: Optional[str] = None
    marcas_fixas: List[str] = Field(default_factory=list)
    aparece_em: List[int] = Field(default_factory=list)
    destino: str
    destino_ids: List[str] = Field(default_factory=list)


class ObjetoPlantadoEsqueleto(BaseModel):
    objeto: str
    plantado_em: int = 1
    pago_em: int = 6


class HudDeltaOpcao(BaseModel):
    vida: int = 0
    comida: int = 0
    dinheiro_preco_ids: List[str] = Field(default_factory=list)


class ImpactoChanceOpcao(BaseModel):
    valor: int
    justificativa_ids: List[str] = Field(default_factory=list)
    estimativa: bool = False


class OpcaoDecisaoEsqueleto(BaseModel):
    texto: str
    fato_ids: List[str] = Field(default_factory=list)
    consequencia: str
    hud_delta: HudDeltaOpcao
    impacto_chance: ImpactoChanceOpcao


class DecisaoBlocoEsqueleto(BaseModel):
    pergunta: str
    opcao_a: OpcaoDecisaoEsqueleto
    opcao_b: OpcaoDecisaoEsqueleto
    caminho_nico: Literal["a", "b"]
    caminho_companheiro: Optional[Literal["a", "b"]] = None
    motivo_caminho_nico: str


class HudDepoisBloco(BaseModel):
    vida: int
    comida: int
    dinheiro_epoca: str
    dinheiro_brl: float = 0.0


class TabelaEspectadorItem(BaseModel):
    decisao: int
    a: int
    b: int


class ResultadoSobrevidaEsqueleto(BaseModel):
    chance_final_nico: int
    conta: str
    tabela_espectador: List[TabelaEspectadorItem] = Field(default_factory=list)
    tem_estimativa: bool = False


class GanchoProximoPerigo(BaseModel):
    perigo: str
    texto: str


class MissaoEpisodio(BaseModel):
    objetivo: str
    prazo: str
    resolvida_em: int = 7


class PersonagemLocal(BaseModel):
    nome: str
    papel: str
    arco: str
    blocos_presente: List[int] = Field(default_factory=list)


class BeatEsqueleto(BaseModel):
    id: str
    situacao: str
    locacao_id: Optional[str] = None
    hora_do_dia: Optional[HoraDoDiaLiteral] = None
    enquadramento: Optional[EnquadramentoLiteral] = None
    palavras_alvo: Optional[int] = None
    planos_estimados: int = 3
    fato_ids: List[str] = Field(default_factory=list)
    preco_ids: List[str] = Field(default_factory=list)
    pov_em_cena: Optional[str] = None
    reflexo: bool = False
    nico_em_cena: Optional[str] = None
    tito_em_cena: str = ""
    sentido: Literal["cheiro", "som", "tato", "gosto", "visão", "visao"] = "visão"
    companheiro_em_cena: bool = False
    curiosidade_bomba: bool = False
    som_ambiente: Optional[str] = None
    grafico_na_tela: Optional[GraficoNaTelaLiteral] = None
    cortavel_para_short: bool = False


class LoopAbertoEsqueleto(BaseModel):
    tipo: Literal[
        "ameaca_fisica",
        "barra_caindo",
        "prazo",
        "escolha_chegando",
        "pressagio",
        "conta_que_nao_fecha",
        "regra_desconhecida",
        "pergunta_pratica",
        # Tipos v4.0 Hollywood
        "ameaca_iminente",
        "relogio_fatal",
        "ironia_dramatica",
        "armadilha_oculta",
        "misterio_sensorial",
        "custo_humano",
    ]
    texto: str
    fechado_em: Optional[int] = None


class EpisodioEsqueletoMeta(BaseModel):
    # Campos v4.0 (Cinema de Sobrevivência Histórica POV)
    contexto_sobrevivencia: Optional[ContextoSobrevivenciaEpoca] = None
    macro_loop_abertura: Optional[str] = None
    # Campos v3.0.0 (SOBREVIDA — As 5 Decisões)
    perigo: Optional[str] = None
    lugar: Optional[str] = None
    data: Optional[str] = None
    papel_do_jogador: Optional[str] = None
    chance_base: Optional[ChanceBaseEsqueleto] = None
    hud_inicial: Optional[HudInicialEsqueleto] = None
    companheiro: Optional[CompanheiroEsqueleto] = None
    objeto_plantado: Optional[ObjetoPlantadoEsqueleto] = None
    locacoes: List[LocacaoItem] = Field(default_factory=list)
    # Campos compartilhados e v2.2.0 (retrocompatibilidade)
    destino: Optional[str] = None
    ano: Optional[str] = None
    duracao_estadia: Literal["UM DIA", "UMA SEMANA"] = "UM DIA"
    papel_do_viajante: Optional[str] = None
    duracao_alvo_min: int = 14
    palavras_alvo: int = 1960
    planos_totais_estimados: int = 140
    promessa_thumbnail: Optional[str] = None
    promessa_thumbnail_entregue_no_carimbo: bool = True
    premissa: str
    erro_de_previsao: str
    missao_do_episodio: Optional[MissaoEpisodio] = None
    personagem_local: Optional[PersonagemLocal] = None


class GanchoProximoDestino(BaseModel):
    destino: str
    texto: str


class BlocoEsqueleto(BaseModel):
    # Campos v4.0 (Cinema de Sobrevivência de Hollywood)
    manobra: Optional[ManobraSobrevivenciaEsqueleto] = None
    micro_loop_meio: Optional[str] = None
    loop_hollywood: Optional[LoopRetencaoHollywood] = None
    # Campos v3.0.0 (SOBREVIDA) e v2.2.0
    ordem: Optional[int] = None
    bloco: Optional[str] = None
    janela: Optional[str] = None
    relogio: Optional[str] = None
    hora_do_dia: Optional[HoraDoDiaLiteral] = None
    palavras_alvo: Optional[int] = None
    objetivo: Optional[str] = None
    curiosidade_bomba: Optional[str] = None
    revelacao_meio_bloco: Optional[str] = None
    beats: List[BeatEsqueleto] = Field(default_factory=list)
    decisao: Optional[DecisaoBlocoEsqueleto] = None
    hud_depois: Optional[HudDepoisBloco] = None
    corpo_estado: Optional[CorpoEstadoLiteral] = None
    nico_estado: Optional[NicoEstadoLiteral] = None
    loop_aberto: Optional[LoopAbertoEsqueleto] = None
    # Campos de retrocompatibilidade
    numero: Optional[int] = None
    ato: Optional[int] = None
    tempo_alvo_s: Optional[float] = None
    funcao_dramatica: Optional[str] = None
    fatos_chave: List[str] = Field(default_factory=list)


class ArquitetoEstruturaOutput(BaseModel):
    episodio: Optional[EpisodioEsqueletoMeta] = None
    locacoes: List[LocacaoItem] = Field(default_factory=list)
    blocos: List[BlocoEsqueleto]
    desfecho_historico: Optional[DesfechoHistoricoEsqueleto] = None
    resultado: Optional[ResultadoSobrevidaEsqueleto] = None
    gancho_proximo_perigo: Optional[GanchoProximoPerigo] = None
    gancho_proximo_destino: Optional[GanchoProximoDestino] = None
    alertas: List[str] = Field(default_factory=list)
    # Campos de retrocompatibilidade
    atos: List[Dict[str, Any]] = Field(default_factory=list)
    tempo_total_previsto_s: float = 840.0


MovimentoPlanoLiteral = Literal[
    # Movimentos v4.0 (Cinema de Sobrevivência de Hollywood)
    "choque_in_media_res",
    "pressao_ambiente",
    "erro_da_multidao",
    "manobra_tatica",
    "complicacao_mas_portanto",
    "cliffhanger_loop",
    "payoff_chekhov",
    "registro_historico",
    # Movimentos v3.0 (Retrocompatibilidade)
    "fecha_loop",
    "situa",
    "ameaca",
    "opcoes",
    "consequencia",
    "loop_aberto",
    "ritual",
    "resultado",
    "verdade",
]
EnquadramentoRoteiristaLiteral = Literal[
    "pov_olho",
    "pov_maos",
    "pov_baixo",
    "pov_companheiro",
    "reflexo",
    "aberto",
    "detalhe",
    "escolha_ab",
    # Retrocompatibilidade v3.0
    "medio",
    "close",
    "pov",
    "simetrico",
]
NicoEstadoLiteral = Literal["saudavel_nervoso", "sujo_faminto", "exausto_ferido"]
CorpoEstadoLiteral = Literal["inteiro", "desgastado", "no_limite"]
LuzPlanoLiteral = Literal["amanhecer", "dia", "fim_de_tarde", "noite", "vela"]
TipoGraficoRoteiristaLiteral = Literal[
    "hud_update",
    "escolha_ab",
    "relogio",
    "cartao_preco",
    "medidor_chance",
    "tabela_chance",
    "mapa",
    "tela_escura",
    "nenhum",
]
MusicaPlanoLiteral = Literal[
    "calma_inquieta",
    "tensao_baixa",
    "tensao_media",
    "tensao_alta",
    "melancolia",
    "silencio",
    "memoria",
]


class GraficoPlanoRoteirista(BaseModel):
    tipo: TipoGraficoRoteiristaLiteral = "nenhum"
    dados: Dict[str, Any] = Field(default_factory=dict)


class HudPlanoRoteirista(BaseModel):
    vida: int = Field(ge=0, le=100, default=100)
    comida: int = Field(ge=0, le=100, default=100)
    dinheiro_epoca: str = ""
    dinheiro_brl: float = 0.0


class PlanoRoteiristaV3(BaseModel):
    id: str
    beat_id: str
    movimento: MovimentoPlanoLiteral
    texto: str
    palavras: int
    duracao_s: float
    enquadramento: EnquadramentoRoteiristaLiteral
    pov_acao: Optional[str] = None
    maos_visiveis: bool = False
    corpo_estado: Optional[CorpoEstadoLiteral] = None
    animar: bool = False
    nico_acao: Optional[str] = None
    nico_estado: NicoEstadoLiteral = "saudavel_nervoso"
    companheiro_em_cena: bool = False
    locacao_id: str
    relogio: str
    luz: LuzPlanoLiteral = "dia"
    grafico: GraficoPlanoRoteirista = Field(default_factory=GraficoPlanoRoteirista)
    hud: HudPlanoRoteirista = Field(default_factory=HudPlanoRoteirista)
    som: str
    musica: MusicaPlanoLiteral = "tensao_media"
    fato_ids: List[str] = Field(default_factory=list)
    curiosidade_bomba: bool = False
    cortavel_para_short: bool = False


class BlocoRoteiristaV3Output(BaseModel):
    bloco: int
    nome: str
    palavras_total: int
    duracao_estimada_s: float
    planos: List[PlanoRoteiristaV3]
    alertas: List[str] = Field(default_factory=list)


class BlocoRoteiro(BaseModel):
    numero: int
    texto: str
    marcacoes_cena: List[str]
    fatos_referenciados: List[str]
    tempo_estimado_s: float


class RoteiristaOutput(BaseModel):
    versao: int
    blocos: List[BlocoRoteiro]
    blocos_v3: List[BlocoRoteiristaV3Output] = Field(default_factory=list)


class NotaRevisao(BaseModel):
    bloco_numero: Optional[int] = None
    tipo: str
    gravidade: Literal["bloqueante", "aviso", "sugestao"]
    mensagem: str


class EditorRetencaoOutput(BaseModel):
    aprovado: bool
    gancho_duracao_s: float
    open_loops_identificados: List[int]
    notas: List[NotaRevisao]


class RevisorFidelidadeOutput(BaseModel):
    aprovado: bool
    frases_sem_fato: List[str]
    notas: List[NotaRevisao]


class RevisorTomOutput(BaseModel):
    aprovado: bool
    palavras_por_minuto: float
    cliches_detectados: List[str]
    notas: List[NotaRevisao]


# ---------------------------------------------------------------------------
# 3. Direção
# ---------------------------------------------------------------------------
class DiretorDecupagemOutput(BaseModel):
    planos: List[Dict[str, Any]]
    total_planos: int


class FotografiaCena(BaseModel):
    cena_id: str
    nivel_fogo: int = Field(ge=1, le=5)
    proporcao: Literal["16:9", "2.39", "3:1"]
    parede: str
    luz_deus: Optional[Dict[str, str]] = None


class DiretorFotografiaOutput(BaseModel):
    color_script: List[FotografiaCena]
    ajustes_por_plano: Dict[str, Dict[str, Any]]


class CorrecaoDirecaoTela(BaseModel):
    plano_id: str
    direcao_original: str
    direcao_corrigida: str
    motivo: str


class SupervisorDirecaoTelaOutput(BaseModel):
    aprovado: bool
    correcoes: List[CorrecaoDirecaoTela]


class ElencoItem(BaseModel):
    marionete_id: str
    personagem: str
    status: Literal["biblioteca", "nova_a_criar"]
    descricao_visual: str


class DiretorArteOutput(BaseModel):
    marionetes_usadas: List[str]
    novas_a_criar: List[ElencoItem]
    reaproveitadas: List[str]


class StoryboardOutput(BaseModel):
    animatic_caminho: Optional[str]
    quadros_por_plano: Dict[str, str]


# ---------------------------------------------------------------------------
# 4. Arte & Marionetes
# ---------------------------------------------------------------------------
class DesignerSilhuetasOutput(BaseModel):
    marionete_id: str
    png_caminho: str
    png_hash: str
    estilo_figura_negra: bool = True
    furos_luz: List[str]


class VetorizadorOutput(BaseModel):
    marionete_id: str
    svg_caminho: str
    svg_hash: str
    preto_absoluto: bool = True


class PivoRig(BaseModel):
    nome_junta: str
    x: float
    y: float


class RiggerOutput(BaseModel):
    marionete_id: str
    rig_caminho: str
    pivos: List[PivoRig]


class CenografoOutput(BaseModel):
    cenario_id: str
    tipo: str
    textura_caminho: str
    textura_hash: str


class BibliotecarioOutput(BaseModel):
    ativos_registrados: List[Dict[str, Any]]
    total_ativos: int


# ---------------------------------------------------------------------------
# 5. Animação & Render
# ---------------------------------------------------------------------------
class AnimadorPlanoOutput(BaseModel):
    plano_id: str
    cena_parametrizada: Dict[str, Any]


class MontadorCena3DOutput(BaseModel):
    plano_id: str
    blend_caminho: str
    blend_hash: str


class GerenteRenderOutput(BaseModel):
    plano_id: str
    video_caminho: Optional[str]
    video_hash: Optional[str]
    status: Literal["concluido", "falhou"]
    job_id: str


class RevisorPlanoOutput(BaseModel):
    plano_id: str
    aprovado: bool
    motivo: Optional[str] = None
    tentativa: int = 1


class VFXOutput(BaseModel):
    plano_id: str
    camadas_vfx: List[Dict[str, Any]]
    caminho_composto: Optional[str]


# ---------------------------------------------------------------------------
# 6. Áudio
# ---------------------------------------------------------------------------
class MarcacaoVoz(BaseModel):
    bloco_numero: int
    ppm: int
    pausas_ms: List[int]
    enfases: List[str]


class DiretorVozOutput(BaseModel):
    roteiro_anotado: List[MarcacaoVoz]


class NarradorOutput(BaseModel):
    bloco_numero: int
    audio_caminho: str
    audio_hash: str
    duracao_s: float


class SoundDesignerOutput(BaseModel):
    sfx_utilizados: List[Dict[str, Any]]


class SupervisorMusicalOutput(BaseModel):
    stems_trilha: List[Dict[str, Any]]


class MixadorOutput(BaseModel):
    mix_caminho: str
    mix_hash: str
    lufs_medido: float = -14.0


# ---------------------------------------------------------------------------
# 7. Montagem & Finalização
# ---------------------------------------------------------------------------
class EditorOutput(BaseModel):
    timeline_otio: str
    versao_corte: int
    duracao_total_s: float


class GrafismoOutput(BaseModel):
    camadas_grafismo: List[Dict[str, Any]]


class FinalizadorOutput(BaseModel):
    master_caminho: str
    master_hash: str
    resolucao: str = "4K"
    capitulos: List[Dict[str, Any]]


class LegendadorOutput(BaseModel):
    legendas_srt: Dict[str, str]  # idioma -> srt


# ---------------------------------------------------------------------------
# 8. Embalagem
# ---------------------------------------------------------------------------
class TitulistaOutput(BaseModel):
    titulos: List[str]


class ThumbItem(BaseModel):
    layout: Literal["A", "B", "C"]
    caminho: str
    hash: str
    elementos: Dict[str, Any]


class DesignerThumbnailOutput(BaseModel):
    thumbs: List[ThumbItem]


class AvaliadorFeedOutput(BaseModel):
    ranking_thumbs: List[Dict[str, Any]]
    thumb_vencedora_layout: str


class RedatorMetadadosOutput(BaseModel):
    descricao: str
    tags: List[str]
    capitulos_formatados: str


class CortadorShortsOutput(BaseModel):
    shorts: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# 9. QA
# ---------------------------------------------------------------------------
class QARelatorioOutput(BaseModel):
    verificacao: str
    aprovado: bool
    bloqueia: bool
    departamento_alvo: Optional[str] = None
    motivo: str = ""
    metricas: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# 10. Publicação & Aprendizado
# ---------------------------------------------------------------------------
class PublicadorOutput(BaseModel):
    video_id: str
    status: Literal["privado"]
    upload_url: str
    chave_idempotencia: str


class AnalistaDesempenhoOutput(BaseModel):
    video_id: str
    ctr_48h: Optional[float] = None
    retencao_media_pct: Optional[float] = None
    queda_retencao_timecodes: List[str] = Field(default_factory=list)


class CuradorMemoriaOutput(BaseModel):
    licoes_geradas: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# 11. Engenharia de Prompts Cinemáticos (Imagem & Vídeo)
# ---------------------------------------------------------------------------
class PromptImagemItem(BaseModel):
    plano_id: str
    prompt_positivo: str
    prompt_negativo: str = "text, watermark, logo, blur, distorted, extra limbs, low resolution, 3d render"
    estilo_cinematografico: str
    lente_sugerida: str
    paleta_cores: List[str]
    consistencia_personagens: List[str]


class EngenheiroPromptImagemOutput(BaseModel):
    prompts_planos: List[PromptImagemItem]
    diretriz_consistencia: str


class PromptVideoItem(BaseModel):
    plano_id: str
    motion_prompt: str
    camera_prompt: str
    ritmo_duracao_s: float
    curva_fogo: str


class EngenheiroPromptVideoOutput(BaseModel):
    prompts_movimento: List[PromptVideoItem]


# ---------------------------------------------------------------------------
# 12. Cenas POV Realista (cenas.diretor v1.0.0 — SOBREVIDA)
# ---------------------------------------------------------------------------
class CenaDiretorItem(BaseModel):
    id: str
    enquadramento: EnquadramentoRoteiristaLiteral
    proporcao: Literal["16:9", "9:16"] = "16:9"
    prompt: Optional[str] = None
    prompt_vertical: Optional[str] = None
    negativo: str
    referencias: List[Literal["maos", "companheiro"]] = Field(default_factory=list)
    seed_grupo: str
    animar: bool = False
    prompt_movimento: Optional[str] = None
    duracao_video_s: Optional[float] = None
    checagens: List[str] = Field(default_factory=list)


class DiretorCenasBlocoOutput(BaseModel):
    bloco: int
    companion_token: str
    locacao_tokens: Dict[str, str] = Field(default_factory=dict)
    objeto_token: str
    cenas: List[CenaDiretorItem]
    alertas: List[str] = Field(default_factory=list)

