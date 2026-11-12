"""Subgrafo do Departamento de Embalagem — SOBREVIDA · Você sobreviveria? (Doc 03 §11, §14 e Doc 05 §3.8).

Criação e teste de títulos em 2ª pessoa, thumbnails com Nico, o Azarado + Selo de Porcentagem (coração rachado), metadados e Shorts:
1. embalagem.titulista (LLM-R)
2. embalagem.designer_thumbnail (IMG + Ferr.)
3. embalagem.avaliador_feed (LLM-V)
4. embalagem.redator_metadados (LLM-R)
5. embalagem.cortador_shorts (LLM-R + Ferr.)
"""

from __future__ import annotations

from typing import Any, Dict
from langgraph.graph import END, START, StateGraph

from contratos.estado import EstadoEpisodio
from grafo.base import no_agente


@no_agente("embalagem.titulista", categoria_modelo="LLM-R")
def titulista_node(state: EstadoEpisodio) -> Dict[str, Any]:
    titulos = [
        "Você Sobreviveria à Peste Negra?",                  # 32 chars <= 60
        "Você Aguentaria Ser Mineiro de Carvão em 1850?",   # 46 chars <= 60
        "Você Fugiria de Pompeia a Tempo?",                  # 32 chars <= 60
    ]
    return {
        "embalagem": {
            "titulos": titulos,
        }
    }


@no_agente("embalagem.designer_thumbnail", categoria_modelo="IMG")
def designer_thumbnail_node(state: EstadoEpisodio) -> Dict[str, Any]:
    thumbs = [
        {
            "layout": "A",
            "caminho": "storage_local/thumbs/thumb_layout_a.png",
            "hash": "hash_thumb_a",
            "personagem_close": "nico_panico_peste_negra",
            "fundo_historico": "londres_1348_medicos_peste",
            "selo_porcentagem": "12%",
            "barra_vida": "vermelho_quase_vazia",
            "texto": "FUGIR OU FICAR",
            "fonte": "Anton",
            "posicao_wordmark": "inferior_esquerdo",
            "canto_inferior_direito_livre": True,
        },
        {
            "layout": "B",
            "caminho": "storage_local/thumbs/thumb_layout_b.png",
            "hash": "hash_thumb_b",
            "personagem_close": "nico_exausto_mina_carvao",
            "fundo_historico": "mina_carvao_1850",
            "selo_porcentagem": "18%",
            "barra_vida": "vermelho_quase_vazia",
            "texto": "8 ANOS NO ESCURO",
            "fonte": "Anton",
            "posicao_wordmark": "inferior_esquerdo",
            "canto_inferior_direito_livre": True,
        },
        {
            "layout": "C",
            "caminho": "storage_local/thumbs/thumb_layout_c.png",
            "hash": "hash_thumb_c",
            "personagem_close": "nico_correndo_pompeia",
            "fundo_historico": "pompeia_79dc_vesuvio",
            "selo_porcentagem": "8%",
            "barra_vida": "vermelho_quase_vazia",
            "texto": "SÓ 18 HORAS",
            "fonte": "Anton",
            "posicao_wordmark": "inferior_esquerdo",
            "canto_inferior_direito_livre": True,
        },
    ]
    return {
        "embalagem": {
            "thumbs": thumbs,
        }
    }


@no_agente("embalagem.avaliador_feed", categoria_modelo="LLM-V")
def avaliador_feed_node(state: EstadoEpisodio) -> Dict[str, Any]:
    ranking = [
        {"layout": "A", "score_120px": 9.7, "contraste_legivel": True, "vencedor": True},
        {"layout": "B", "score_120px": 8.9, "contraste_legivel": True, "vencedor": False},
        {"layout": "C", "score_120px": 8.4, "contraste_legivel": True, "vencedor": False},
    ]
    return {
        "embalagem": {
            "ranking": ranking,
        }
    }


@no_agente("embalagem.redator_metadados", categoria_modelo="LLM-R")
def redator_metadados_node(state: EstadoEpisodio) -> Dict[str, Any]:
    metadados = {
        "descricao": (
            "Você sobreviveria à Peste Negra em 1348? Em cada escolha, suas barras de Vida, Comida e Dinheiro "
            "sobem ou caem — e no fim você descobre a sua chance real de sair vivo.\n\n"
            "No Sobrevida, a história vira um jogo de sobrevivência. Você entra em Londres em 1348 na pele de Nico, "
            "toma 4 decisões difíceis baseadas no que pessoas reais fizeram e descobre de onde vem a taxa real "
            "de sobrevivência da maior pandemia da Idade Média.\n\n"
            "CAPÍTULOS DO JOGO:\n"
            "00:00 Entrada · Londres, 1348 (Barras Cheias)\n"
            "00:15 Situação · O Avanço da Peste Negra\n"
            "01:30 Decisão 1 · Fugir para o Campo ou Trancar a Casa? (A/B)\n"
            "04:15 Decisão 2 · Cuidar dos Doentes ou Isolar a Rua? (A/B)\n"
            "07:00 Decisão 3 · Comprar Comida no Mercado ou Racionar? (A/B)\n"
            "10:00 Resultado · Sua Porcentagem Final de Sobrevivência\n"
            "11:00 Saída · O Que Aconteceu de Verdade\n\n"
            "FONTES:\n"
            "1. Ole J. Benedictow — The Black Death 1346–1353: The Complete History\n"
            "2. Rosemary Horrox — The Black Death (Manchester Medieval Sources)\n"
            "3. Philip Ziegler — The Black Death\n"
            "4. Barbara W. Tuchman — Um Espelho Distante: O Terrível Século XIV\n"
            "5. Registros Paroquiais e Manoriais da Inglaterra (1348–1350)\n\n"
            "Suas barras estão cheias. Por enquanto.\n\n"
            "#sobrevida #vocesobreviveria #pestenegra #historia #jogodesobrevivencia"
        ),
        "tags": [
            "sobrevida",
            "voce sobreviveria",
            "voce sobreviveria a peste negra",
            "historia como jogo de sobrevivencia",
            "nico o azarado",
            "peste negra 1348",
            "idade media",
            "animacao 2d historia",
            "qual sua chance de sobreviver",
            "escolhas e consequencias",
            "historia curiosidades",
            "gladiador romano",
            "pompeia 79 dc",
            "trincheiras 1916",
            "educacao historia",
        ],
    }
    return {
        "embalagem": {
            "metadados": metadados,
        }
    }


@no_agente("embalagem.cortador_shorts", categoria_modelo="LLM-R")
def cortador_shorts_node(state: EstadoEpisodio) -> Dict[str, Any]:
    shorts = [
        {
            "id": "short_01",
            "serie": "Você Sobreviveria?",
            "titulo": "Fugir ou Ficar na Peste Negra de 1348? #Shorts",
            "tempo_inicio": "01:30",
            "duracao_s": 40.0,
            "proporcao": "9:16",
            "fechamento": "O vídeo completo está no canal.",
            "caminho": "storage_local/shorts/short_01.mp4",
        },
        {
            "id": "short_02",
            "serie": "Você Sobreviveria?",
            "titulo": "Por Que a Máscara do Médico da Peste Tinha Bico? #Shorts",
            "tempo_inicio": "04:15",
            "duracao_s": 38.0,
            "proporcao": "9:16",
            "fechamento": "O vídeo completo está no canal.",
            "caminho": "storage_local/shorts/short_02.mp4",
        },
        {
            "id": "short_03",
            "serie": "Você Sobreviveria?",
            "titulo": "Qual Era a Sua Chance Real na Peste Negra? #Shorts",
            "tempo_inicio": "10:00",
            "duracao_s": 42.0,
            "proporcao": "9:16",
            "fechamento": "O vídeo completo está no canal.",
            "caminho": "storage_local/shorts/short_03.mp4",
        },
    ]
    return {
        "embalagem": {
            "shorts": shorts,
        }
    }


def construir_subgrafo_embalagem() -> StateGraph:
    """Compila o subgrafo de Embalagem."""
    builder = StateGraph(EstadoEpisodio)

    builder.add_node("embalagem.titulista", titulista_node)
    builder.add_node("embalagem.designer_thumbnail", designer_thumbnail_node)
    builder.add_node("embalagem.avaliador_feed", avaliador_feed_node)
    builder.add_node("embalagem.redator_metadados", redator_metadados_node)
    builder.add_node("embalagem.cortador_shorts", cortador_shorts_node)

    builder.add_edge(START, "embalagem.titulista")
    builder.add_edge("embalagem.titulista", "embalagem.designer_thumbnail")
    builder.add_edge("embalagem.designer_thumbnail", "embalagem.avaliador_feed")
    builder.add_edge("embalagem.avaliador_feed", "embalagem.redator_metadados")
    builder.add_edge("embalagem.redator_metadados", "embalagem.cortador_shorts")
    builder.add_edge("embalagem.cortador_shorts", END)

    return builder.compile()
