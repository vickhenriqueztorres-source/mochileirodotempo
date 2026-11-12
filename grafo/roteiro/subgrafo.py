"""Subgrafo do Departamento de Roteiro — SOBREVIDA · Você sobreviveria? (Doc 03 §8-9 e Fichas 01-05).

Implementa o ciclo autor ↔ revisores (máximo de 3 voltas):
Arquiteto de Estrutura (Jogo de Sobrevivência: Entrada + Situação + Decisões A/B + Resultado + Saída / Beats -> Planos)
-> Validador Automático em Código (matemática de palavras/planos, IDs, enquadramentos, ganchos e Shorts)
-> Roteirista (2ª Pessoa / Narrador de Jogo de Sobrevivência com Nico, o Azarado)
-> (Retenção || Fidelidade || Tom) -> Roteador de Revisão.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from langgraph.graph import END, START, StateGraph

from contratos.agentes import ArquitetoEstruturaOutput, RoteiristaOutput
from contratos.estado import EstadoEpisodio
from grafo.base import no_agente
from grafo.ferramentas.modelos import obter_cliente_modelo

PROMPTS_ROTEIRO_DIR = Path(__file__).resolve().parent.parent.parent / "prompts" / "roteiro"

BLOCOS_OFICIAIS_V21 = [
    "Carimbo",
    "Chegada",
    "Onde dormir",
    "O que comer",
    "Trabalho e dinheiro",
    "Leis e perigos",
    "Diversão e fé",
    "O grande evento",
    "Partida",
]

BLOCOS_OFICIAIS_V30 = [
    "Entrada",
    "Situação",
    "Decisão 1",
    "Decisão 2",
    "Decisão 3 · Virada",
    "Decisão 4",
    "Decisão 5 · Ponto sem volta",
    "Resultado",
    "Saída",
]

BLOCOS_OFICIAIS_V30_4_DECISOES = [
    "Entrada",
    "Situação",
    "Decisão 1",
    "Decisão 2 · Virada",
    "Decisão 3",
    "Decisão 4 · Ponto sem volta",
    "Resultado",
    "Saída",
]

BLOCOS_OFICIAIS_V30_6_DECISOES = [
    "Entrada",
    "Situação",
    "Decisão 1",
    "Decisão 2",
    "Decisão 3 · Virada",
    "Decisão 4",
    "Decisão 5",
    "Decisão 6 · Ponto sem volta",
    "Resultado",
    "Saída",
]

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


def _carregar_prompt_roteiro(nome_arquivo: str, fallback: str) -> str:
    caminho = PROMPTS_ROTEIRO_DIR / nome_arquivo
    if caminho.is_file():
        return caminho.read_text(encoding="utf-8")
    return fallback


def montar_entrada_arquiteto_v21(state: EstadoEpisodio) -> Dict[str, Any]:
    """Monta o payload de entrada da Seção 2 do Arquiteto de Estrutura (v3.0.0 / v2.2.0)."""
    ep = state.get("episodio", {})
    pesquisa = state.get("pesquisa", {})
    roteiro = state.get("roteiro", {})

    fatos_raw = pesquisa.get("fatos", [])
    fatos_v21 = []
    for idx, f in enumerate(fatos_raw, start=1):
        f_id = f.get("id") or f"F{idx:02d}"
        grau = f.get("grau_certeza", "canonica")
        confianca = "debatido" if f.get("variante_ou_tardia") or grau != "canonica" else "alta"
        fontes_conf = f.get("fontes_confirmadas", [])
        fatos_v21.append({
            "id": f_id,
            "texto": f.get("descricao") or f.get("texto", ""),
            "fonte": fontes_conf[0] if fontes_conf else f.get("fonte", "Fonte histórica primária"),
            "confianca": f.get("confianca", confianca),
        })

    precos_raw = pesquisa.get("precos", [
        {"id": "P01", "item": "aluguel de cabana/quarto", "valor_epoca": "1 khar de cevada", "valor_brl": 280, "metodo_conversao": "equivalência alimentar mensal"},
        {"id": "P02", "item": "ração diária de pão e cerveja", "valor_epoca": "2 pães ta + 1 jarra", "valor_brl": 18, "metodo_conversao": "cesta calórica diária"},
        {"id": "P03", "item": "salário mensal do artesão/trabalhador", "valor_epoca": "5,5 khar de grãos", "valor_brl": 1540, "metodo_conversao": "poder de compra de subsistência"},
    ])

    dados_mortalidade = pesquisa.get("dados_mortalidade", [
        {"id": "M01", "grupo": "população de Florença", "taxa": "cerca de 50% a 60%", "fonte": "Crônica de Giovanni Villani (1348)", "confianca": "media"},
    ])

    notas = roteiro.get("notas", {})
    tem_bloqueio = any(
        any("[BLOQUEANTE]" in str(n) for n in lista)
        for lista in notas.values()
        if isinstance(lista, list)
    )
    feedback_auditoria = notas if tem_bloqueio else None

    return {
        # Campos v3.0.0 (SOBREVIDA — As 5 Decisões)
        "perigo": ep.get("perigo") or ep.get("mito_alvo", "Peste Negra"),
        "lugar": ep.get("lugar") or ep.get("destino", "Florença, Itália"),
        "data": ep.get("data") or ep.get("ano", "abril de 1348"),
        "papel_do_jogador": ep.get("papel_do_jogador") or ep.get("papel_do_viajante", "tecelão de lã, 20 anos, mora de aluguel"),
        "serie": ep.get("serie", "Você Sobreviveria?"),
        "titulo_previsto": ep.get("titulo_previsto") or ep.get("titulo", "Você Sobreviveria à Peste Negra?"),
        "dados_mortalidade": dados_mortalidade,
        # Campos compartilhados e v2.2.0
        "destino": ep.get("destino", "Tebas, Egito"),
        "ano": ep.get("ano", "1250 a.C."),
        "duracao_estadia": ep.get("duracao_estadia", "UM DIA"),
        "papel_do_viajante": ep.get("papel_do_viajante", "trabalhador comum em Deir el-Medina"),
        "duracao_alvo_min": int(ep.get("duracao_alvo_min", 14)),
        "promessa_thumbnail": ep.get("promessa_thumbnail", "PÃO COM AREIA · O SALÁRIO ERA CERVEJA"),
        "diagnostico_atencao": ep.get("diagnostico_atencao", {
            "nivel_consciencia": 2,
            "sofisticacao": 4,
            "cliches_proibidos_na_abertura": ["faraós", "pirâmides", "deuses", "múmias"],
            "erro_de_previsao_sugerido": "Areia no pão que lixa os dentes até a polpa e pagamento em grãos atrasado.",
        }),
        "fatos": fatos_v21,
        "precos": precos_raw,
        "feedback_auditoria": feedback_auditoria,
        "episodio": ep,
        "pesquisa": pesquisa,
    }


def _estado_nico_esperado(vida: int, comida: int) -> str:
    pior = min(vida, comida)
    if pior > 60:
        return "saudavel_nervoso"
    if pior >= 30:
        return "sujo_faminto"
    return "exausto_ferido"


def _estado_corpo_esperado(vida: int, comida: int) -> str:
    pior = min(vida, comida)
    if pior > 60:
        return "inteiro"
    if pior >= 30:
        return "desgastado"
    return "no_limite"


def _extrair_posicao_relogio(relogio: str) -> Optional[float]:
    """Converte strings como 'faltam 18 horas', 'dia 3 da peste', 'semana 6' em horas na linha do tempo."""
    txt = (relogio or "").strip().lower()
    if not txt:
        return None
    fatores = {
        "minuto": 1.0 / 60.0,
        "minutos": 1.0 / 60.0,
        "hora": 1.0,
        "horas": 1.0,
        "dia": 24.0,
        "dias": 24.0,
        "semana": 24.0 * 7.0,
        "semanas": 24.0 * 7.0,
        "mes": 24.0 * 30.0,
        "mês": 24.0 * 30.0,
        "meses": 24.0 * 30.0,
    }
    m_decorrido = re.match(r"^(minuto|hora|dia|semana|m[eê]s)\s+(\d+)\b", txt)
    if m_decorrido:
        unidade, valor = m_decorrido.group(1), float(m_decorrido.group(2))
        return valor * fatores.get(unidade, 24.0)
    m_falta = re.search(r"\bfaltam?\s+(\d+)\s+(minutos?|horas?|dias?|semanas?|m[eê]s|meses)\b", txt)
    if m_falta:
        valor, unidade = float(m_falta.group(1)), m_falta.group(2)
        return -valor * fatores.get(unidade, 1.0)
    return None


def validar_esqueleto_arquiteto_v30(
    esqueleto: Dict[str, Any],
    entrada_arquiteto: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Validador automático em código para o Arquiteto de Estrutura v3.0.0 — As 5 Decisões (SOBREVIDA).

    Confere os 6 itens da Seção 9.1:
    1. Número de blocos e de beats, e as somas de palavras.
    2. Se todo fato_id, preco_id, mortalidade_id e locacao_id existe.
    3. A soma do HUD, bloco a bloco (e limites de recuperação, queda ≤ 25 e estado do Nico).
    4. A conta da chance final e os limites de 1 a 95.
    5. A presença do relógio e validade dos loops abertos.
    6. A contagem do companheiro, do objeto plantado, das curiosidades_bomba e dos Shorts.
    """
    erros: List[str] = []
    blocos = esqueleto.get("blocos", [])
    ep_meta = esqueleto.get("episodio") or {}

    if not blocos:
        erros.append("[ARQUITETO v3.0] Nenhum bloco encontrado no esqueleto.")
        return erros

    # 1. Número de blocos na ordem oficial (8 para 4 decisões, 9 para 5 decisões, 10 para 6 decisões)
    mapa_blocos_oficiais = {
        8: BLOCOS_OFICIAIS_V30_4_DECISOES,
        9: BLOCOS_OFICIAIS_V30,
        10: BLOCOS_OFICIAIS_V30_6_DECISOES,
    }
    nomes_esperados = mapa_blocos_oficiais.get(len(blocos))
    if nomes_esperados is None:
        erros.append(
            f"[ARQUITETO v3.0] Número de blocos inválido ({len(blocos)}); esperados 9 (14 min / 5 decisões), 8 (4 decisões) ou 10 (6 decisões)."
        )
    else:
        for idx, nome_esperado in enumerate(nomes_esperados):
            b = blocos[idx]
            if b.get("ordem") != idx or b.get("bloco") != nome_esperado:
                erros.append(
                    f"[ARQUITETO v3.0] Bloco na posição {idx} inválido: ordem={b.get('ordem')}, "
                    f"bloco='{b.get('bloco')}' (esperado '{nome_esperado}')."
                )

    # Entrada com no máximo 100 palavras e sem clichês nos primeiros 5s (1º beat)
    entrada_bloco = blocos[0]
    palavras_entrada = int(entrada_bloco.get("palavras_alvo") or 0)
    if palavras_entrada > 100:
        erros.append(f"[ARQUITETO v3.0] Entrada excede 100 palavras ({palavras_entrada}).")

    cliches = (
        (entrada_arquiteto or {})
        .get("diagnostico_atencao", {})
        .get("cliches_proibidos_na_abertura", [])
    )
    beats_entrada = entrada_bloco.get("beats", [])
    if beats_entrada and cliches:
        primeiro_beat_txt = str(beats_entrada[0].get("situacao", "")).lower()
        for cl in cliches:
            if cl.lower() in primeiro_beat_txt:
                erros.append(f"[ARQUITETO v3.0] Clichê proibido no 1º beat da Entrada: '{cl}'.")

    # 2. Catálogo de IDs válidos (fatos, preços, mortalidade, locações)
    fatos_validos = {
        str(f.get("id")) for f in (entrada_arquiteto or {}).get("fatos", []) if f.get("id")
    }
    precos_validos = {
        str(p.get("id")) for p in (entrada_arquiteto or {}).get("precos", []) if p.get("id")
    }
    mortalidades_validas = {
        str(m.get("id")) for m in (entrada_arquiteto or {}).get("dados_mortalidade", []) if m.get("id")
    }
    justificativas_validas = fatos_validos | mortalidades_validas

    locacoes_lista = ep_meta.get("locacoes") or esqueleto.get("locacoes") or []
    locacoes_validas = {str(loc.get("id")) for loc in locacoes_lista if loc.get("id")}
    for loc in locacoes_lista:
        for fid in loc.get("fato_ids", []):
            if fatos_validos and fid not in fatos_validos:
                erros.append(f"[ARQUITETO v3.0] Locação {loc.get('id')} referencia fato_id inexistente: '{fid}'.")

    # Chance base e HUD inicial
    chance_base = ep_meta.get("chance_base") or {}
    chance_base_val = int(chance_base.get("valor", 50))
    for mid in chance_base.get("mortalidade_ids", []):
        if mortalidades_validas and mid not in mortalidades_validas:
            erros.append(f"[ARQUITETO v3.0] chance_base referencia mortalidade_id inexistente: '{mid}'.")

    hud_inicial = ep_meta.get("hud_inicial") or {}
    vida_atual = int(hud_inicial.get("vida", 100))
    comida_atual = int(hud_inicial.get("comida", 100))
    dinheiro_ini = hud_inicial.get("dinheiro") or {}
    for pid in dinheiro_ini.get("preco_ids", []):
        if precos_validos and pid not in precos_validos:
            erros.append(f"[ARQUITETO v3.0] hud_inicial.dinheiro referencia preco_id inexistente: '{pid}'.")

    # Detecta modo v3.1.0 POV realista (pov_em_cena, corpo_estado ou descricao_visual/marcas_fixas)
    usa_v31_pov = any(
        b.get("corpo_estado") is not None
        or any(bt.get("pov_em_cena") is not None or bt.get("reflexo") for bt in b.get("beats", []))
        for b in blocos
    ) or bool((ep_meta.get("companheiro") or {}).get("descricao_visual"))

    # Companheiro e Objeto plantado
    companheiro = ep_meta.get("companheiro")
    if not companheiro:
        erros.append("[ARQUITETO v3.0] 'episodio.companheiro' ausente.")
    else:
        if not companheiro.get("ficcional", False):
            erros.append("[ARQUITETO v3.0] 'companheiro.ficcional' deve ser True.")
        aparece_em = companheiro.get("aparece_em") or []
        if len(set(aparece_em)) < 4:
            erros.append(
                f"[ARQUITETO v3.0] Companheiro ('{companheiro.get('nome')}') deve aparecer em pelo menos 4 blocos (atual: {aparece_em})."
            )
        for did in companheiro.get("destino_ids", []):
            if justificativas_validas and did not in justificativas_validas:
                erros.append(f"[ARQUITETO v3.0] companheiro.destino_ids referencia ID inexistente: '{did}'.")
        if usa_v31_pov:
            if not str(companheiro.get("descricao_visual") or "").strip():
                erros.append("[ARQUITETO v3.1] 'companheiro.descricao_visual' obrigatório no modo POV.")
            marcas = companheiro.get("marcas_fixas") or []
            if len(marcas) != 3:
                erros.append(
                    f"[ARQUITETO v3.1] 'companheiro.marcas_fixas' deve ter exatamente 3 marcas fixas (atual: {len(marcas)})."
                )

    idx_ultima_decisao = len(blocos) - 3
    idx_saida = len(blocos) - 1

    objeto_plantado = ep_meta.get("objeto_plantado")
    if not objeto_plantado or not objeto_plantado.get("objeto"):
        erros.append("[ARQUITETO v3.0] 'episodio.objeto_plantado' ausente.")
    else:
        if objeto_plantado.get("plantado_em") != 1:
            erros.append(
                f"[ARQUITETO v3.0] 'objeto_plantado.plantado_em' deve ser 1 (Situação), recebido {objeto_plantado.get('plantado_em')}."
            )
        if objeto_plantado.get("pago_em") not in (idx_ultima_decisao, idx_saida):
            erros.append(
                f"[ARQUITETO v3.0] 'objeto_plantado.pago_em' deve ser no Ponto sem volta ({idx_ultima_decisao}) ou na Saída ({idx_saida})."
            )

    soma_palavras_blocos = 0
    soma_planos = 0
    total_shorts = 0
    total_reflexos = 0
    companheiro_outra_opcao_count = 0
    vida_minima_ate_ultima_decisao = vida_atual
    soma_modificadores_nico = 0
    tem_estimativa_calculada = False
    tabela_esperada: List[Dict[str, int]] = []
    ultimo_tipo_loop: Optional[str] = None
    ultima_pos_relogio: Optional[float] = None
    ultimo_relogio_txt: str = ""
    num_decisao_seq = 0

    for idx, b in enumerate(blocos):
        ordem = b.get("ordem", idx)
        nome_bloco = str(b.get("bloco") or "")
        eh_bloco_decisao = nome_bloco.startswith("Decisão")
        eh_ponto_sem_volta = "Ponto sem volta" in nome_bloco

        palavras_bloco = int(b.get("palavras_alvo") or 0)
        soma_palavras_blocos += palavras_bloco

        relogio_txt = str(b.get("relogio") or "").strip()
        if not relogio_txt:
            erros.append(f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') sem 'relogio'.")
        else:
            pos_relogio = _extrair_posicao_relogio(relogio_txt)
            if pos_relogio is not None:
                if ultima_pos_relogio is not None and pos_relogio < ultima_pos_relogio:
                    erros.append(
                        f"[ARQUITETO v3.0] O relógio voltou para trás no bloco {ordem} ('{relogio_txt}' após '{ultimo_relogio_txt}')."
                    )
                ultima_pos_relogio = pos_relogio
                ultimo_relogio_txt = relogio_txt

        beats = b.get("beats", [])
        if idx in (0, len(blocos) - 2, len(blocos) - 1):
            if not (1 <= len(beats) <= 3):
                erros.append(
                    f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') deve ter entre 1 e 3 beats (atual: {len(beats)})."
                )
        else:
            if not (2 <= len(beats) <= 4):
                erros.append(
                    f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') deve ter entre 2 e 4 beats (atual: {len(beats)})."
                )

        soma_palavras_beats = 0
        todos_beats_tem_palavras = bool(beats) and all(bt.get("palavras_alvo") is not None for bt in beats)
        curiosidades_no_bloco = 0

        for beat in beats:
            soma_planos += int(beat.get("planos_estimados") or 3)
            if beat.get("palavras_alvo") is not None:
                soma_palavras_beats += int(beat.get("palavras_alvo") or 0)
            if beat.get("cortavel_para_short"):
                total_shorts += 1
            if beat.get("curiosidade_bomba"):
                curiosidades_no_bloco += 1
            if beat.get("reflexo"):
                total_reflexos += 1

            f_ids = beat.get("fato_ids", [])
            if not f_ids:
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} no bloco {ordem} sem fato_ids.")
            elif fatos_validos and not all(fid in fatos_validos for fid in f_ids):
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} referencia fato_id inexistente: {f_ids}.")

            p_ids = beat.get("preco_ids", [])
            if p_ids and precos_validos and not all(pid in precos_validos for pid in p_ids):
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} referencia preco_id inexistente: {p_ids}.")

            loc_id = beat.get("locacao_id")
            if not loc_id:
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} sem locacao_id.")
            elif locacoes_validas and loc_id not in locacoes_validas:
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} usa locacao_id inexistente: '{loc_id}'.")

            acao_protagonista = str(beat.get("pov_em_cena") or beat.get("nico_em_cena") or "").strip()
            if not acao_protagonista:
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} sem 'pov_em_cena'/'nico_em_cena'.")
            elif re.search(r"\b(nico|você|voce)\s+(diz|fala|pergunta|grita|responde)\b", acao_protagonista.lower()):
                erros.append(f"[ARQUITETO v3.0] Beat {beat.get('id')} coloca o protagonista para falar: '{acao_protagonista}'.")
            elif usa_v31_pov and re.search(r"\bnico\b", str(beat.get("pov_em_cena") or "").lower()):
                erros.append(
                    f"[ARQUITETO v3.1] Beat {beat.get('id')} descreve Nico em 3ª pessoa em 'pov_em_cena': '{beat.get('pov_em_cena')}'."
                )

        if todos_beats_tem_palavras and soma_palavras_beats != palavras_bloco:
            erros.append(
                f"[ARQUITETO v3.0] Soma de palavras_alvo dos beats ({soma_palavras_beats}) no bloco {ordem} difere de palavras_alvo do bloco ({palavras_bloco})."
            )

        # Decisão A/B e HUD
        decisao = b.get("decisao")
        if eh_bloco_decisao:
            num_decisao_seq += 1
            if curiosidades_no_bloco < 1:
                erros.append(
                    f"[ARQUITETO v3.0] Bloco de decisão {ordem} ('{nome_bloco}') deve ter pelo menos 1 beat com curiosidade_bomba=True."
                )
            if not decisao:
                erros.append(f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') exige objeto 'decisao'.")
            else:
                op_a = decisao.get("opcao_a") or {}
                op_b = decisao.get("opcao_b") or {}
                for letra, op in (("a", op_a), ("b", op_b)):
                    op_fatos = op.get("fato_ids") or []
                    if not op_fatos:
                        erros.append(f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra} sem fato_ids.")
                    elif fatos_validos and not all(fid in fatos_validos for fid in op_fatos):
                        erros.append(f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra} referencia fato_id inexistente: {op_fatos}.")

                    delta = op.get("hud_delta") or {}
                    for pid in delta.get("dinheiro_preco_ids", []):
                        if precos_validos and pid not in precos_validos:
                            erros.append(
                                f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra}.hud_delta referencia preco_id inexistente: '{pid}'."
                            )
                    for nome_barra in ("vida", "comida"):
                        d_val = int(delta.get(nome_barra, 0))
                        if d_val > 20:
                            erros.append(
                                f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra} recupera mais de 20 pontos em '{nome_barra}' (+{d_val})."
                            )
                        if abs(d_val) > 40 and not eh_ponto_sem_volta:
                            erros.append(
                                f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra} altera '{nome_barra}' em mais de 40 pontos ({d_val}) fora do Ponto sem volta."
                            )

                    imp = op.get("impacto_chance") or {}
                    just_ids = imp.get("justificativa_ids") or []
                    if not just_ids:
                        erros.append(f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra}.impacto_chance sem justificativa_ids.")
                    elif justificativas_validas and not all(jid in justificativas_validas for jid in just_ids):
                        erros.append(
                            f"[ARQUITETO v3.0] Bloco {ordem} opcao_{letra}.impacto_chance referencia ID inexistente: {just_ids}."
                        )

                caminho_nico = decisao.get("caminho_nico")
                caminho_comp = decisao.get("caminho_companheiro")
                if caminho_comp in ("a", "b") and caminho_comp != caminho_nico:
                    companheiro_outra_opcao_count += 1

                op_escolhida = op_a if caminho_nico == "a" else op_b
                delta_nico = op_escolhida.get("hud_delta") or {}
                vida_atual += int(delta_nico.get("vida", 0))
                comida_atual += int(delta_nico.get("comida", 0))

                imp_nico = op_escolhida.get("impacto_chance") or {}
                soma_modificadores_nico += int(imp_nico.get("valor", 0))
                if imp_nico.get("estimativa") or (op_a.get("impacto_chance") or {}).get("estimativa") or (op_b.get("impacto_chance") or {}).get("estimativa"):
                    tem_estimativa_calculada = True

                tabela_esperada.append({
                    "decisao": num_decisao_seq,
                    "a": int((op_a.get("impacto_chance") or {}).get("valor", 0)),
                    "b": int((op_b.get("impacto_chance") or {}).get("valor", 0)),
                })
        else:
            if decisao is not None:
                erros.append(f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') não é de decisão e deve ter decisao=null.")

        # Checagem do HUD depois do bloco
        hud_depois = b.get("hud_depois")
        if hud_depois:
            v_dep = int(hud_depois.get("vida", vida_atual))
            c_dep = int(hud_depois.get("comida", comida_atual))
            if eh_bloco_decisao and (v_dep != vida_atual or c_dep != comida_atual):
                erros.append(
                    f"[ARQUITETO v3.0] Bloco {ordem} hud_depois ({v_dep}/{c_dep}) não bate com a soma do HUD ({vida_atual}/{comida_atual})."
                )
            vida_atual = v_dep
            comida_atual = c_dep
            if idx > 0 and (vida_atual >= 100 and comida_atual >= 100 and eh_bloco_decisao):
                erros.append(f"[ARQUITETO v3.0] Bloco {ordem}: as barras nunca voltam a 100 depois da Entrada.")
            if idx > 0 and (vida_atual > 100 or comida_atual > 100):
                erros.append(f"[ARQUITETO v3.0] Bloco {ordem}: barra acima de 100 ({vida_atual}/{comida_atual}).")

            estado_informado = b.get("nico_estado")
            estado_esp = _estado_nico_esperado(vida_atual, comida_atual)
            if estado_informado and estado_informado != estado_esp:
                erros.append(
                    f"[ARQUITETO v3.0] Bloco {ordem}: nico_estado='{estado_informado}' incoerente com a pior barra ({min(vida_atual, comida_atual)} -> esperado '{estado_esp}')."
                )

            corpo_informado = b.get("corpo_estado")
            corpo_esp = _estado_corpo_esperado(vida_atual, comida_atual)
            if corpo_informado and corpo_informado != corpo_esp:
                erros.append(
                    f"[ARQUITETO v3.1] Bloco {ordem}: corpo_estado='{corpo_informado}' incoerente com a pior barra ({min(vida_atual, comida_atual)} -> esperado '{corpo_esp}')."
                )

        if idx <= idx_ultima_decisao:
            vida_minima_ate_ultima_decisao = min(vida_minima_ate_ultima_decisao, vida_atual)

        # Loops abertos (Da Entrada até a última Decisão)
        loop = b.get("loop_aberto")
        if idx <= idx_ultima_decisao:
            if not loop or not loop.get("texto") or not loop.get("tipo"):
                erros.append(f"[ARQUITETO v3.0] Bloco {ordem} ('{nome_bloco}') sem loop_aberto válido.")
            else:
                tipo_atual = loop.get("tipo")
                if ultimo_tipo_loop and tipo_atual == ultimo_tipo_loop:
                    erros.append(
                        f"[ARQUITETO v3.0] Tipo de loop_aberto repetido em blocos seguidos ({ordem - 1} e {ordem}): '{tipo_atual}'."
                    )
                ultimo_tipo_loop = tipo_atual
                fechado_em = loop.get("fechado_em")
                if fechado_em is None or not (ordem < int(fechado_em) <= idx_saida):
                    erros.append(
                        f"[ARQUITETO v3.0] Bloco {ordem} tem fechado_em inválido ({fechado_em}); deve apontar para bloco > {ordem}."
                    )
        elif idx == idx_saida:
            if loop is not None and loop.get("fechado_em") is not None:
                erros.append("[ARQUITETO v3.0] Na Saída, loop_aberto (ou fechado_em) deve ser null.")

    if vida_minima_ate_ultima_decisao > 25:
        erros.append(
            f"[ARQUITETO v3.0] A Vida precisa chegar a 25 ou menos pelo menos uma vez até a última decisão (mínimo atingido: {vida_minima_ate_ultima_decisao})."
        )

    if companheiro_outra_opcao_count < 2:
        erros.append(
            f"[ARQUITETO v3.0] O companheiro deve escolher a outra opção em pelo menos 2 decisões (atual: {companheiro_outra_opcao_count})."
        )

    if not (2 <= total_shorts <= 3):
        erros.append(f"[ARQUITETO v3.0] Marque de 2 a 3 beats com cortavel_para_short=True (atual: {total_shorts}).")

    if total_reflexos > 1:
        erros.append(f"[ARQUITETO v3.1] No máximo 1 beat pode ter reflexo=True no episódio (atual: {total_reflexos}).")

    # 4. Resultado e conta da chance final (entre 1 e 95)
    resultado = esqueleto.get("resultado")
    chance_esperada = chance_base_val + soma_modificadores_nico
    if not resultado:
        erros.append("[ARQUITETO v3.0] Objeto 'resultado' ausente.")
    else:
        chance_final = int(resultado.get("chance_final_nico", 0))
        if not (1 <= chance_final <= 95):
            erros.append(f"[ARQUITETO v3.0] chance_final_nico ({chance_final}%) fora dos limites de 1% a 95%.")
        if chance_final != chance_esperada:
            erros.append(
                f"[ARQUITETO v3.0] chance_final_nico ({chance_final}) não bate com chance_base ({chance_base_val}) + modificadores do caminho do Nico ({soma_modificadores_nico}) = {chance_esperada}."
            )
        if tem_estimativa_calculada and not resultado.get("tem_estimativa", False):
            erros.append("[ARQUITETO v3.0] Há modificador com estimativa=True, mas resultado.tem_estimativa está False.")
        if resultado.get("tabela_espectador") != tabela_esperada:
            erros.append("[ARQUITETO v3.0] resultado.tabela_espectador não confere com os impacto_chance das decisões.")

    if isinstance(ep_meta, dict):
        ep_meta["planos_totais_estimados"] = soma_planos

    alvo_ep = int(ep_meta.get("palavras_alvo") or 1960)
    if alvo_ep > 0 and abs(soma_palavras_blocos - alvo_ep) > (alvo_ep * 0.05):
        erros.append(
            f"[ARQUITETO v3.0] Soma de palavras dos blocos ({soma_palavras_blocos}) fora da margem de ±5% do alvo ({alvo_ep})."
        )

    return erros


def validar_esqueleto_arquiteto_v40(
    esqueleto: Dict[str, Any],
    entrada_arquiteto: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Validador determinístico em código para o Arquiteto v4.0 — 8 Sequências de Hollywood & Sobrevivência Prática (Zero Quiz A/B)."""
    erros: List[str] = []
    blocos = esqueleto.get("blocos", [])
    ep_meta = esqueleto.get("episodio") or {}

    if len(blocos) != 8:
        erros.append(
            f"[ARQUITETO v4.0 HOLLYWOOD] Esperadas exatamente 8 Sequências Cinematográficas (0 a 7), recebidas {len(blocos)}."
        )
    else:
        for idx, nome_esp in enumerate(SEQUENCIAS_HOLLYWOOD_V40):
            b = blocos[idx]
            if b.get("ordem") != idx or b.get("bloco") != nome_esp:
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência na posição {idx} inválida: ordem={b.get('ordem')}, "
                    f"bloco='{b.get('bloco')}' (esperado '{nome_esp}')."
                )

    fatos_validos = {
        str(f.get("id")) for f in (entrada_arquiteto or {}).get("fatos", []) if f.get("id")
    }
    locacoes_lista = ep_meta.get("locacoes") or esqueleto.get("locacoes") or []
    locacoes_validas = {str(loc.get("id")) for loc in locacoes_lista if loc.get("id")}

    # Arma de Chekhov (objeto plantado na Seq 1 e pago na Seq 6)
    obj_plantado = ep_meta.get("objeto_plantado") or {}
    if not obj_plantado.get("objeto"):
        erros.append("[ARQUITETO v4.0 HOLLYWOOD] 'episodio.objeto_plantado.objeto' obrigatório (Arma de Chekhov).")
    else:
        if obj_plantado.get("plantado_em") != 1:
            erros.append(
                f"[ARQUITETO v4.0 HOLLYWOOD] A Arma de Chekhov deve ser plantada na Seq 1 (recebido {obj_plantado.get('plantado_em')})."
            )
        if obj_plantado.get("pago_em") != 6:
            erros.append(
                f"[ARQUITETO v4.0 HOLLYWOOD] A Arma de Chekhov deve ser paga na Seq 6 — Ponto Sem Volta (recebido {obj_plantado.get('pago_em')})."
            )

    ultimo_tipo_loop: Optional[str] = None
    ultima_pos_relogio: Optional[float] = None
    ultimo_relogio_txt = ""

    for idx, b in enumerate(blocos):
        ordem = int(b.get("ordem", idx))
        nome_seq = str(b.get("bloco") or f"Seq {idx}")

        # Proibição absoluta de decisão A/B no modo v4.0
        if b.get("decisao") is not None:
            erros.append(
                f"[ARQUITETO v4.0 HOLLYWOOD] A sequência {ordem} ('{nome_seq}') contém 'decisao' A/B proibida. "
                "Use 'manobra' (instinto_fatal_multidao vs. acao_tatica_sobrevivente + conector_causal)."
            )

        relogio_txt = str(b.get("relogio") or "").strip()
        if not relogio_txt:
            erros.append(f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') sem 'relogio' diegético.")
        else:
            pos_rel = _extrair_posicao_relogio(relogio_txt)
            if pos_rel is not None:
                if ultima_pos_relogio is not None and pos_rel < ultima_pos_relogio:
                    erros.append(
                        f"[ARQUITETO v4.0 HOLLYWOOD] O relógio voltou para trás na sequência {ordem} ('{relogio_txt}' após '{ultimo_relogio_txt}')."
                    )
                ultima_pos_relogio = pos_rel
                ultimo_relogio_txt = relogio_txt

        # Causalidade "Mas / Portanto" e Manobra Prática de Sobrevivência nas sequências de ação (1 a 6)
        manobra = b.get("manobra") or {}
        if 1 <= idx <= 6:
            conector = str(manobra.get("conector_causal") or "").lower()
            if conector not in ("mas", "portanto"):
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') exige conector_causal 'mas' ou 'portanto' (recebido '{conector}')."
                )
            if not str(manobra.get("complicacao_resultante") or "").strip():
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') sem 'complicacao_resultante' (Lei Mas/Portanto)."
                )
        if 2 <= idx <= 6:
            if not str(manobra.get("instinto_fatal_multidao") or "").strip():
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') exige 'instinto_fatal_multidao' (o que a multidão faz e por que falha)."
                )
            if not str(manobra.get("acao_tatica_sobrevivente") or "").strip():
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') exige 'acao_tatica_sobrevivente' (como você faz para sobreviver na época)."
                )
            m_fatos = manobra.get("fato_ids") or []
            if not m_fatos:
                erros.append(f"[ARQUITETO v4.0 HOLLYWOOD] Manobra da sequência {ordem} sem fato_ids verificados.")
            elif fatos_validos and not all(fid in fatos_validos for fid in m_fatos):
                erros.append(f"[ARQUITETO v4.0 HOLLYWOOD] Manobra da sequência {ordem} usa fato_id inexistente: {m_fatos}.")
            if not str(b.get("micro_loop_meio") or "").strip():
                erros.append(
                    f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') exige 'micro_loop_meio' (pulso de retenção de 45-60s)."
                )

        # Loops de Retenção de Hollywood (Zeigarnik) nas sequências 0 a 5
        loop_hw = b.get("loop_hollywood") or b.get("loop_aberto") or {}
        if idx <= 5:
            pergunta_loop = str(loop_hw.get("pergunta_implicita_espectador") or loop_hw.get("texto") or "").strip()
            tipo_loop = str(loop_hw.get("tipo") or "").strip()
            fechado_em = loop_hw.get("fechado_em_sequencia") if "fechado_em_sequencia" in loop_hw else loop_hw.get("fechado_em")
            if not pergunta_loop or not tipo_loop:
                erros.append(f"[ARQUITETO v4.0 HOLLYWOOD] Sequência {ordem} ('{nome_seq}') sem loop de retenção aberto.")
            else:
                if ultimo_tipo_loop and tipo_loop == ultimo_tipo_loop:
                    erros.append(
                        f"[ARQUITETO v4.0 HOLLYWOOD] Tipo de loop de retenção repetido em sequências seguidas ({ordem - 1} e {ordem}): '{tipo_loop}'."
                    )
                ultimo_tipo_loop = tipo_loop
                if fechado_em is None or not (ordem < int(fechado_em) <= 7):
                    erros.append(
                        f"[ARQUITETO v4.0 HOLLYWOOD] Loop da sequência {ordem} deve fechar em sequência posterior (fechado_em={fechado_em})."
                    )

        for beat in b.get("beats", []):
            loc_id = beat.get("locacao_id")
            if locacoes_validas and loc_id and loc_id not in locacoes_validas:
                erros.append(f"[ARQUITETO v4.0 HOLLYWOOD] Beat {beat.get('id')} usa locacao_id inexistente: '{loc_id}'.")

    if not esqueleto.get("desfecho_historico"):
        erros.append("[ARQUITETO v4.0 HOLLYWOOD] 'desfecho_historico' (como_sobreviveu_resumo + registro_historico_real) obrigatório.")

    return erros


def validar_esqueleto_arquiteto_v21(
    esqueleto: Dict[str, Any],
    entrada_arquiteto: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Validador determinístico em código para o Arquiteto de Estrutura (v4.0 / v3.0.0 / v2.2.0 / v2.1.0)."""
    ep_meta = esqueleto.get("episodio") or {}
    blocos = esqueleto.get("blocos", [])
    if (
        esqueleto.get("desfecho_historico")
        or ep_meta.get("contexto_sobrevivencia")
        or any(b.get("manobra") is not None or b.get("loop_hollywood") is not None for b in blocos)
        or (blocos and str(blocos[0].get("bloco") or "").startswith("Seq 0"))
    ):
        return validar_esqueleto_arquiteto_v40(esqueleto, entrada_arquiteto)
    if (
        ep_meta.get("perigo")
        or ep_meta.get("chance_base")
        or esqueleto.get("resultado")
        or (blocos and blocos[0].get("bloco") == "Entrada")
    ):
        return validar_esqueleto_arquiteto_v30(esqueleto, entrada_arquiteto)

    erros: List[str] = []
    blocos = esqueleto.get("blocos", [])

    if not blocos or blocos[0].get("bloco") is None:
        return erros

    # 1. Exatamente 9 blocos, na ordem oficial, com os nomes oficiais
    if len(blocos) != 9:
        erros.append(f"[ARQUITETO] Esperados exatamente 9 blocos (0 a 8), recebidos {len(blocos)}.")
    else:
        for idx, nome_esperado in enumerate(BLOCOS_OFICIAIS_V21):
            b = blocos[idx]
            if b.get("ordem") != idx or b.get("bloco") != nome_esperado:
                erros.append(
                    f"[ARQUITETO] Bloco na posição {idx} inválido: ordem={b.get('ordem')}, "
                    f"bloco='{b.get('bloco')}' (esperado '{nome_esperado}')."
                )

    # 2. Carimbo com no máximo 105 palavras e sem clichês nos primeiros 5 segundos
    if blocos:
        carimbo = blocos[0]
        palavras_carimbo = carimbo.get("palavras_alvo") or 0
        if palavras_carimbo > 105:
            erros.append(f"[ARQUITETO] Carimbo excede 105 palavras ({palavras_carimbo}).")
        cliches = (
            (entrada_arquiteto or {})
            .get("diagnostico_atencao", {})
            .get("cliches_proibidos_na_abertura", [])
        )
        beats_carimbo = carimbo.get("beats", [])
        if beats_carimbo and cliches:
            primeiro_beat_txt = str(beats_carimbo[0].get("situacao", "")).lower()
            for cl in cliches:
                if cl.lower() in primeiro_beat_txt:
                    erros.append(f"[ARQUITETO] Clichê proibido no 1º beat do Carimbo: '{cl}'.")

    # Checagem v2.2: Missão do episódio e Personagem Local (quando presentes)
    ep_meta = esqueleto.get("episodio") or {}
    missao = ep_meta.get("missao_do_episodio")
    if missao is not None:
        if not missao.get("objetivo"):
            erros.append("[ARQUITETO v2.2] 'missao_do_episodio.objetivo' vazio.")
        if int(missao.get("resolvida_em", 7)) not in (7, 8):
            erros.append("[ARQUITETO v2.2] 'missao_do_episodio.resolvida_em' deve ser na Parada 7 ou na Partida (8).")

    personagem_local = ep_meta.get("personagem_local")
    if personagem_local is not None:
        blocos_pres = personagem_local.get("blocos_presente") or []
        if len(set(blocos_pres)) < 3:
            erros.append(
                f"[ARQUITETO v2.2] 'personagem_local' ('{personagem_local.get('nome')}') deve aparecer em pelo menos 3 paradas (atual: {blocos_pres})."
            )

    if ep_meta.get("promessa_thumbnail") and not ep_meta.get("promessa_thumbnail_entregue_no_carimbo", True):
        erros.append("[ARQUITETO v2.2] A promessa da thumbnail deve ser entregue no Carimbo (primeiros 30s).")

    # 3. Fatos, Preços e Locações válidas
    fatos_validos = {
        str(f.get("id")) for f in (entrada_arquiteto or {}).get("fatos", []) if f.get("id")
    }
    precos_validos = {
        str(p.get("id")) for p in (entrada_arquiteto or {}).get("precos", []) if p.get("id")
    }
    locacoes_lista = esqueleto.get("locacoes") or []
    locacoes_validas = {str(loc.get("id")) for loc in locacoes_lista if loc.get("id")}
    usa_v22 = bool(locacoes_lista or missao or personagem_local)

    ultimo_tipo_loop: Optional[str] = None
    soma_palavras = 0
    soma_planos = 0
    total_shorts = 0

    for b in blocos:
        ordem = b.get("ordem", 0)
        soma_palavras += int(b.get("palavras_alvo") or 0)
        beats = b.get("beats", [])
        tem_preco_no_bloco = False
        ultimo_enquadramento: Optional[str] = None

        if usa_v22:
            if 1 <= ordem <= 7 and not b.get("curiosidade_bomba"):
                erros.append(f"[ARQUITETO v2.2] Parada {ordem} ('{b.get('bloco')}') sem 'curiosidade_bomba'.")
            if ordem in (4, 5) and not b.get("revelacao_meio_bloco"):
                erros.append(f"[ARQUITETO v2.2] Parada {ordem} ('{b.get('bloco')}') exige 'revelacao_meio_bloco' no meio dos 2,5 min.")

        for b_idx, beat in enumerate(beats):
            soma_planos += int(beat.get("planos_estimados") or 5)
            if beat.get("cortavel_para_short"):
                total_shorts += 1

            f_ids = beat.get("fato_ids", [])
            if not f_ids:
                erros.append(f"[ARQUITETO] Beat {beat.get('id')} no bloco {ordem} sem fato_ids.")
            elif fatos_validos and not all(fid in fatos_validos for fid in f_ids):
                erros.append(f"[ARQUITETO] Beat {beat.get('id')} referencia fato_id inexistente: {f_ids}.")

            p_ids = beat.get("preco_ids", [])
            if p_ids:
                tem_preco_no_bloco = True
                if precos_validos and not all(pid in precos_validos for pid in p_ids):
                    erros.append(f"[ARQUITETO] Beat {beat.get('id')} referencia preco_id inexistente: {p_ids}.")

            tito_acao = str(beat.get("nico_em_cena") or beat.get("tito_em_cena") or "").strip()
            if not tito_acao:
                erros.append(f"[ARQUITETO] Beat {beat.get('id')} sem 'nico_em_cena'/'tito_em_cena'.")
            elif re.search(r"\b(nico|tito)\s+(diz|fala|pergunta|grita|responde)\b", tito_acao.lower()):
                erros.append(f"[ARQUITETO] Beat {beat.get('id')} coloca Nico/Tito para falar: '{tito_acao}'.")

            # Regras de cena v2.2 (locacao_id, enquadramento, som_ambiente)
            enq = beat.get("enquadramento")
            if enq is not None:
                if b_idx == 0 and enq != "aberto":
                    erros.append(
                        f"[ARQUITETO v2.2] O 1º beat do bloco {ordem} ('{b.get('bloco')}') deve ter enquadramento 'aberto' (atual: '{enq}')."
                    )
                if ultimo_enquadramento and enq == ultimo_enquadramento:
                    erros.append(
                        f"[ARQUITETO v2.2] Enquadramento '{enq}' repetido em beats seguidos no bloco {ordem} (beat {beat.get('id')})."
                    )
                ultimo_enquadramento = enq

            loc_id = beat.get("locacao_id")
            if locacoes_validas and loc_id and loc_id not in locacoes_validas:
                erros.append(f"[ARQUITETO v2.2] Beat {beat.get('id')} usa locacao_id inexistente: '{loc_id}'.")

            if usa_v22 and not beat.get("som_ambiente"):
                erros.append(f"[ARQUITETO v2.2] Beat {beat.get('id')} sem 'som_ambiente'.")

        if ordem in (2, 3, 4) and not tem_preco_no_bloco:
            erros.append(f"[ARQUITETO] Parada econômica {ordem} ('{b.get('bloco')}') sem nenhum preco_id.")

        # 5 e 6. Loops abertos nos blocos 0 a 7 sem repetição consecutiva de tipo
        loop = b.get("loop_aberto")
        if ordem < 8:
            if not loop or not loop.get("texto") or not loop.get("tipo"):
                erros.append(f"[ARQUITETO] Bloco {ordem} ('{b.get('bloco')}') sem loop_aberto válido.")
            else:
                tipo_atual = loop.get("tipo")
                if ultimo_tipo_loop and tipo_atual == ultimo_tipo_loop:
                    erros.append(
                        f"[ARQUITETO] Tipo de loop_aberto repetido em blocos seguidos ({ordem - 1} e {ordem}): '{tipo_atual}'."
                    )
                ultimo_tipo_loop = tipo_atual
                fechado_em = loop.get("fechado_em")
                if fechado_em is None or not (ordem < int(fechado_em) <= 8):
                    erros.append(
                        f"[ARQUITETO] Bloco {ordem} tem fechado_em inválido ({fechado_em}); deve apontar para bloco > {ordem}."
                    )
        else:
            if loop and loop.get("fechado_em") is not None:
                erros.append("[ARQUITETO] Na Partida (bloco 8), fechado_em deve ser null.")

    if usa_v22 and not (2 <= total_shorts <= 3):
        erros.append(f"[ARQUITETO v2.2] Marque de 2 a 3 beats com cortavel_para_short=True (atual: {total_shorts}).")

    # Atualiza os totais calculados automaticamente por código
    if isinstance(ep_meta, dict):
        ep_meta["planos_totais_estimados"] = soma_planos

    alvo_ep = int(ep_meta.get("palavras_alvo") or 2200)
    if alvo_ep > 0 and abs(soma_palavras - alvo_ep) > (alvo_ep * 0.05):
        erros.append(
            f"[ARQUITETO] Soma de palavras dos blocos ({soma_palavras}) fora da margem de ±5% do alvo ({alvo_ep})."
        )

    return erros


PALAVRAS_PROIBIDAS_ROTEIRISTA_V3 = [
    "incrível",
    "chocante",
    "épico",
    "literalmente",
    "galera",
    "simplesmente",
    "basicamente",
    "você não vai acreditar",
]

GIRIAS_PROIBIDAS = [
    "e aí galera",
    "mano",
    "tipo assim",
    "você não vai acreditar",
    "curte e compartilha",
    "doidão",
    "top 10",
    "chocante",
    "bizarro",
    "sensacional",
    "incrível",
    "épico",
    "literalmente",
    "galera",
    "simplesmente",
    "basicamente",
]

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
    "você escolheria",
    "voce escolheria",
    "cinco segundos para escolher",
    "faça a sua conta",
    "comenta a sua porcentagem",
    "vida: cheia",
    "comida: cheia",
    "suas barras estão cheias",
]


def validar_bloco_roteirista_v40(
    bloco_v4: Dict[str, Any],
    palavras_alvo_bloco: Optional[int] = None,
    fatos_validos: Optional[set[str]] = None,
    eh_sequencia_acao: bool = True,
) -> List[str]:
    """Validador determinístico em código para o Roteirista v4.0 (Cinema de Sobrevivência de Hollywood · Zero Escolha A/B)."""
    erros: List[str] = []
    planos = bloco_v4.get("planos", [])
    if not planos:
        erros.append("[ROTEIRISTA v4.0 HOLLYWOOD] Sequência sem planos.")
        return erros

    primeiro_enq = planos[0].get("enquadramento")
    if primeiro_enq not in ("aberto", "pov_olho", "pov_maos"):
        erros.append(
            f"[ROTEIRISTA v4.0 HOLLYWOOD] O 1º plano da sequência {bloco_v4.get('bloco')} deve abrir em 'aberto', 'pov_olho' ou 'pov_maos' (atual: '{primeiro_enq}')."
        )

    ultimo_enquadramento: Optional[str] = None
    soma_palavras = 0
    movimentos_presentes: set[str] = set()
    tem_pov_maos_tatico = False

    for p in planos:
        pid = p.get("id", "?")
        texto = str(p.get("texto", "")).strip()
        texto_low = texto.lower()
        soma_palavras += int(p.get("palavras") or len(texto.split()))

        enq = p.get("enquadramento")
        graf_tipo = str((p.get("grafico") or {}).get("tipo") or "").lower()
        movimento = str(p.get("movimento") or "")
        movimentos_presentes.add(movimento)

        if enq == "escolha_ab" or graf_tipo == "escolha_ab" or movimento == "opcoes":
            erros.append(
                f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} usa mecânica proibida de múltipla escolha ('{enq}' / '{graf_tipo}' / '{movimento}')."
            )
        for frase_quiz in FRASES_QUIZ_PROIBIDAS_V4:
            if frase_quiz in texto_low:
                erros.append(
                    f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} contém pergunta/jargão de quiz proibido: '{frase_quiz}'."
                )

        if ultimo_enquadramento and enq == ultimo_enquadramento:
            erros.append(f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} repete o enquadramento '{enq}' do plano anterior.")
        ultimo_enquadramento = enq

        if enq == "pov_maos" and movimento in ("manobra_tatica", "payoff_chekhov"):
            tem_pov_maos_tatico = True

        for proibida in PALAVRAS_PROIBIDAS_ROTEIRISTA_V3:
            if re.search(r"\b" + re.escape(proibida) + r"\b", texto_low):
                erros.append(f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} contém palavra proibida: '{proibida}'.")

        f_ids = p.get("fato_ids") or []
        if not f_ids:
            erros.append(f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} sem fato_ids verificados.")
        elif fatos_validos and not all(fid in fatos_validos for fid in f_ids):
            erros.append(f"[ROTEIRISTA v4.0 HOLLYWOOD] Plano {pid} referencia fato_id inexistente: {f_ids}.")

    if eh_sequencia_acao:
        for mov_obrigatorio in ("erro_da_multidao", "manobra_tatica", "cliffhanger_loop"):
            if mov_obrigatorio not in movimentos_presentes:
                erros.append(
                    f"[ROTEIRISTA v4.0 HOLLYWOOD] Sequência de ação sem movimento obrigatório '{mov_obrigatorio}'."
                )
        if not tem_pov_maos_tatico:
            erros.append(
                "[ROTEIRISTA v4.0 HOLLYWOOD] Sequência de ação exige pelo menos 1 plano 'pov_maos' demonstrando a execução prática de 'manobra_tatica' ou 'payoff_chekhov'."
            )

    if palavras_alvo_bloco and palavras_alvo_bloco > 0:
        if abs(soma_palavras - palavras_alvo_bloco) > (palavras_alvo_bloco * 0.08):
            erros.append(
                f"[ROTEIRISTA v4.0 HOLLYWOOD] Soma de palavras ({soma_palavras}) fora de ±8% de palavras_alvo ({palavras_alvo_bloco})."
            )

    return erros


def validar_bloco_roteirista_v3(
    bloco_v3: Dict[str, Any],
    palavras_alvo_bloco: Optional[int] = None,
    fatos_validos: Optional[set[str]] = None,
) -> List[str]:
    """Validador determinístico em código para a saída por bloco em planos do Roteirista v3.0.0 (SOBREVIDA §8–§13)."""
    erros: List[str] = []
    planos = bloco_v3.get("planos", [])
    if not planos:
        erros.append("[ROTEIRISTA v3.0] Bloco sem planos.")
        return erros

    # 1. O bloco deve abrir com plano 'aberto'
    primeiro_enq = planos[0].get("enquadramento")
    if primeiro_enq != "aberto":
        erros.append(
            f"[ROTEIRISTA v3.0] O 1º plano do bloco {bloco_v3.get('bloco')} deve ter enquadramento 'aberto' (atual: '{primeiro_enq}')."
        )

    ultimo_enquadramento: Optional[str] = None
    soma_palavras = 0
    estados_validos = {"saudavel_nervoso", "sujo_faminto", "exausto_ferido"}
    corpos_validos = {"inteiro", "desgastado", "no_limite"}
    enquadramentos_pov_v31 = {"pov_olho", "pov_maos", "pov_baixo", "pov_companheiro", "reflexo", "escolha_ab"}
    usa_v31_pov = any(
        p.get("corpo_estado") is not None
        or p.get("pov_acao") is not None
        or p.get("enquadramento") in enquadramentos_pov_v31
        for p in planos
    )
    total_reflexos = 0

    for p in planos:
        pid = p.get("id", "?")
        texto = str(p.get("texto", "")).strip()
        palavras_plano = int(p.get("palavras") or len(texto.split()))
        soma_palavras += palavras_plano

        # 2. Nunca dois planos seguidos com o mesmo enquadramento
        enq = p.get("enquadramento")
        if ultimo_enquadramento and enq == ultimo_enquadramento:
            erros.append(
                f"[ROTEIRISTA v3.0] Plano {pid} repete o enquadramento '{enq}' do plano anterior."
            )
        ultimo_enquadramento = enq
        if enq == "reflexo":
            total_reflexos += 1

        # 3. Protagonista não fala e o estado do corpo/Nico deve ser válido
        acao_txt = p.get("pov_acao") if usa_v31_pov else p.get("nico_acao")
        if acao_txt and re.search(r"\b(nico|tito|você|voce)\s+(diz|fala|pergunta|grita|responde)\b", str(acao_txt).lower()):
            erros.append(f"[ROTEIRISTA v3.0] Plano {pid} coloca o protagonista para falar: '{acao_txt}'.")

        if usa_v31_pov:
            if enq in ("aberto", "detalhe") and p.get("pov_acao") is not None:
                erros.append(f"[ROTEIRISTA v3.1] Plano {pid} ('{enq}') deve ter pov_acao=null.")
            if enq not in ("aberto", "detalhe") and not str(p.get("pov_acao") or "").strip():
                erros.append(f"[ROTEIRISTA v3.1] Plano POV {pid} ('{enq}') exige pov_acao preenchido.")
            corpo_est = p.get("corpo_estado")
            if corpo_est not in corpos_validos:
                erros.append(f"[ROTEIRISTA v3.1] Plano {pid} com corpo_estado inválido: '{corpo_est}'.")
            else:
                hud_p = p.get("hud") or {}
                esp_c = _estado_corpo_esperado(int(hud_p.get("vida", 100)), int(hud_p.get("comida", 100)))
                if corpo_est != esp_c:
                    erros.append(
                        f"[ROTEIRISTA v3.1] Plano {pid} corpo_estado='{corpo_est}' incoerente com HUD ({esp_c})."
                    )
        else:
            nico_estado = p.get("nico_estado")
            if nico_estado not in estados_validos:
                erros.append(f"[ROTEIRISTA v3.0] Plano {pid} com nico_estado inválido: '{nico_estado}'.")

        # 4. Palavras proibidas na locução (TTS §9)
        texto_low = texto.lower()
        for proibida in PALAVRAS_PROIBIDAS_ROTEIRISTA_V3:
            if re.search(r"\b" + re.escape(proibida) + r"\b", texto_low):
                erros.append(f"[ROTEIRISTA v3.0] Plano {pid} contém palavra proibida: '{proibida}'.")

        # 5. Todo plano não-ritual precisa de fato_ids válidos
        movimento = p.get("movimento")
        f_ids = p.get("fato_ids") or []
        if movimento not in ("ritual",) and not f_ids:
            erros.append(f"[ROTEIRISTA v3.0] Plano {pid} (movimento='{movimento}') sem fato_ids.")
        elif fatos_validos and not all(fid in fatos_validos for fid in f_ids):
            erros.append(f"[ROTEIRISTA v3.0] Plano {pid} referencia fato_id fora do esqueleto: {f_ids}.")

        # 6. Planos de escolha_ab: simetrico, opções A e B curtas (≤ 5 palavras) e fórmula fixa com '[PAUSA 2s] Escolha a sua.'
        grafico = p.get("grafico") or {}
        if grafico.get("tipo") == "escolha_ab" or movimento == "opcoes":
            if grafico.get("tipo") == "escolha_ab":
                dados = grafico.get("dados") or {}
                txt_a = str(dados.get("A") or dados.get("opcao_a") or "").strip()
                txt_b = str(dados.get("B") or dados.get("opcao_b") or "").strip()
                if not txt_a or not txt_b:
                    erros.append(f"[ROTEIRISTA v3.0] Plano {pid} ('escolha_ab') deve trazer o texto curto de A e B em grafico.dados.")
                elif len(txt_a.split()) > 5 or len(txt_b.split()) > 5:
                    erros.append(f"[ROTEIRISTA v3.0] Plano {pid} ('escolha_ab') excede 5 palavras em grafico.dados (A='{txt_a}', B='{txt_b}').")
            if movimento == "opcoes" and "[PAUSA 2s] Escolha a sua." not in texto:
                erros.append(f"[ROTEIRISTA v3.0] Plano {pid} (movimento='opcoes') deve terminar com '[PAUSA 2s] Escolha a sua.'.")

    if total_reflexos > 1:
        erros.append(f"[ROTEIRISTA v3.1] No máximo 1 plano com enquadramento 'reflexo' (atual: {total_reflexos}).")

    # 7. Soma de palavras até ±5% de palavras_alvo do bloco
    if palavras_alvo_bloco and palavras_alvo_bloco > 0:
        if abs(soma_palavras - palavras_alvo_bloco) > (palavras_alvo_bloco * 0.05):
            erros.append(
                f"[ROTEIRISTA v3.0] Soma de palavras do bloco ({soma_palavras}) fora de ±5% de palavras_alvo ({palavras_alvo_bloco})."
            )

    return erros


@no_agente("roteiro.arquiteto_estrutura", categoria_modelo="LLM-R")
def arquiteto_estrutura_node(state: EstadoEpisodio) -> Dict[str, Any]:
    cliente = obter_cliente_modelo("LLM-R")
    prompt_sistema = _carregar_prompt_roteiro(
        "01-arquiteto-de-estrutura.md",
        "Construa o esqueleto dramático do episódio de sobrevivência histórica do canal SOBREVIDA (Você sobreviveria?).",
    )
    entradas_v21 = montar_entrada_arquiteto_v21(state)
    saida = cliente.gerar_estruturado(
        schema=ArquitetoEstruturaOutput,
        prompt_sistema=prompt_sistema,
        entradas=entradas_v21,
    )
    esqueleto_dump = saida.model_dump()
    erros_checklist = validar_esqueleto_arquiteto_v21(esqueleto_dump, entradas_v21)
    if erros_checklist:
        esqueleto_dump.setdefault("alertas", []).extend(erros_checklist)

    return {
        "roteiro": {
            "esqueleto": esqueleto_dump,
        }
    }


@no_agente("roteiro.roteirista", categoria_modelo="LLM-R")
def roteirista_node(state: EstadoEpisodio) -> Dict[str, Any]:
    versoes_anteriores = state.get("roteiro", {}).get("versoes", [])
    voltas = len(versoes_anteriores)
    versao = voltas + 1

    # Só aplica o caso de teste forçado na primeira versão (versão 1)
    forcar = state.get("roteiro", {}).get("_forcar_caso_teste") if voltas == 0 else None

    cliente = obter_cliente_modelo("LLM-R")
    prompt_sistema = _carregar_prompt_roteiro(
        "02-roteirista.md",
        "Escreva o roteiro em 2ª pessoa ('você') como narrador de jogo de sobrevivência do canal SOBREVIDA, sem gírias.",
    )
    saida = cliente.gerar_estruturado(
        schema=RoteiristaOutput,
        prompt_sistema=prompt_sistema,
        entradas={"roteiro": state.get("roteiro"), "pesquisa": state.get("pesquisa")},
        forcar_invalido=forcar,
    )

    blocos = [b.model_dump() for b in saida.blocos]
    # Injeta fontes canônicas por bloco conforme referência primária da pesquisa
    fontes_pesquisa = state.get("pesquisa", {}).get("fontes", [])
    canto_padrao = fontes_pesquisa[0].get("canto_verso", "Canto IX, 105-566") if fontes_pesquisa else "Canto IX, 105-566"

    for b in blocos:
        if not b.get("canto_verso"):
            b["canto_verso"] = canto_padrao

    nova_versao_registro = {"versao": versao, "total_blocos": len(blocos)}

    return {
        "roteiro": {
            "blocos": blocos,
            "versoes": versoes_anteriores + [nova_versao_registro],
            "voltas": voltas,
        }
    }


@no_agente("roteiro.editor_retencao", categoria_modelo="LLM-R")
def editor_retencao_node(state: EstadoEpisodio) -> Dict[str, Any]:
    blocos = state.get("roteiro", {}).get("blocos", [])
    notas_retencao: List[str] = []

    if blocos:
        tempo_gancho = blocos[0].get("tempo_estimado_s", 0.0)
        texto_gancho = blocos[0].get("texto", "").lower()
        # Checagem objetiva 1: Gancho inicial deve ter ≤ 45 segundos
        if tempo_gancho > 45.0:
            notas_retencao.append(
                f"[BLOQUEANTE] Gancho inicial excede 45 segundos (tempo: {tempo_gancho}s). Reprovado."
            )
        # Checagem objetiva 2: Proibição de abertura passiva/didática sem Erro de Previsão Sensorial
        elif texto_gancho.startswith("hoje vamos falar") or texto_gancho.startswith("neste vídeo"):
            notas_retencao.append(
                "[BLOQUEANTE] Gancho passivo sem Erro de Previsão (Prediction Error) ou Tensão Psicológica. Reprovado."
            )
        else:
            quiz_detectado = False
            for b in blocos:
                txt_b = str(b.get("texto", "")).lower()
                for frase_quiz in FRASES_QUIZ_PROIBIDAS_V4:
                    if frase_quiz in txt_b:
                        notas_retencao.append(
                            f"[BLOQUEANTE] Bloco {b.get('numero')}: mecânica de quiz/múltipla escolha proibida detectada ('{frase_quiz}'). "
                            "Substitua por sobrevivência prática e loops de retenção de Hollywood."
                        )
                        quiz_detectado = True
                        break
            if not quiz_detectado:
                notas_retencao.append(
                    f"[OK] Gancho inicial em {tempo_gancho}s (≤ 45s) com Cold Open In Media Res, Erro de Previsão e Loops de Retenção de Hollywood aprovados."
                )
    else:
        notas_retencao.append("[BLOQUEANTE] Roteiro sem blocos de texto.")

    notas_existentes = dict(state.get("roteiro", {}).get("notas", {}))
    notas_existentes["retencao"] = notas_retencao

    return {
        "roteiro": {
            "notas": notas_existentes,
        }
    }


@no_agente("roteiro.revisor_fidelidade", categoria_modelo="LLM-R")
def revisor_fidelidade_node(state: EstadoEpisodio) -> Dict[str, Any]:
    blocos = state.get("roteiro", {}).get("blocos", [])
    fatos_conhecidos = {f.get("id") for f in state.get("pesquisa", {}).get("fatos", [])}

    notas_fidelidade: List[str] = []
    tem_bloqueio = False

    for b in blocos:
        fatos_ref = b.get("fatos_referenciados", [])
        if not fatos_ref:
            notas_fidelidade.append(
                f"[BLOQUEANTE] Bloco {b.get('numero')}: nenhuma frase pode passar sem fato correspondente verificado."
            )
            tem_bloqueio = True
            continue

        for f_id in fatos_ref:
            if f_id not in fatos_conhecidos:
                notas_fidelidade.append(
                    f"[BLOQUEANTE] Bloco {b.get('numero')}: fato inventado ou não comprovado nas fontes ('{f_id}')."
                )
                tem_bloqueio = True

    if not tem_bloqueio:
        notas_fidelidade.append("[OK] Todas as afirmações, preços e costumes vinculados a fatos históricos verificados.")

    notas_existentes = dict(state.get("roteiro", {}).get("notas", {}))
    notas_existentes["fidelidade"] = notas_fidelidade

    return {
        "roteiro": {
            "notas": notas_existentes,
        }
    }


@no_agente("roteiro.revisor_tom", categoria_modelo="LLM-R")
def revisor_tom_node(state: EstadoEpisodio) -> Dict[str, Any]:
    blocos = state.get("roteiro", {}).get("blocos", [])
    notas_tom: List[str] = []
    tem_bloqueio = False

    for b in blocos:
        texto = b.get("texto", "").lower()
        for giria in GIRIAS_PROIBIDAS:
            if re.search(r"\b" + re.escape(giria) + r"\b", texto):
                notas_tom.append(
                    f"[BLOQUEANTE] Bloco {b.get('numero')}: tom informal / gíria proibida detectada ('{giria}')."
                )
                tem_bloqueio = True

    if not tem_bloqueio:
        notas_tom.append("[OK] Tom tenso e direto em 2ª pessoa do Narrador SOBREVIDA preservado, sem gírias ou clichês.")

    notas_existentes = dict(state.get("roteiro", {}).get("notas", {}))
    notas_existentes["tom"] = notas_tom

    return {
        "roteiro": {
            "notas": notas_existentes,
        }
    }


def roteador_ciclo_roteiro(state: EstadoEpisodio) -> Literal["roteiro.roteirista", "__end__"]:
    """Decide se refaz o roteiro ou se encerra o subgrafo (máximo 3 voltas)."""
    roteiro = state.get("roteiro", {})
    voltas = roteiro.get("voltas", 0)
    notas = roteiro.get("notas", {})

    tem_bloqueio = any(
        any("[BLOQUEANTE]" in str(n) or "REPROVADO" in str(n).upper() for n in lista_notas)
        for lista_notas in notas.values()
        if isinstance(lista_notas, list)
    )

    if tem_bloqueio and voltas < 3:
        return "roteiro.roteirista"

    return "__end__"


def construir_subgrafo_roteiro() -> StateGraph:
    """Compila o subgrafo de Roteiro com o ciclo de revisão."""
    builder = StateGraph(EstadoEpisodio)

    builder.add_node("roteiro.arquiteto_estrutura", arquiteto_estrutura_node)
    builder.add_node("roteiro.roteirista", roteirista_node)
    builder.add_node("roteiro.editor_retencao", editor_retencao_node)
    builder.add_node("roteiro.revisor_fidelidade", revisor_fidelidade_node)
    builder.add_node("roteiro.revisor_tom", revisor_tom_node)

    builder.add_edge(START, "roteiro.arquiteto_estrutura")
    builder.add_edge("roteiro.arquiteto_estrutura", "roteiro.roteirista")

    # Roteirista passa pelos 3 revisores
    builder.add_edge("roteiro.roteirista", "roteiro.editor_retencao")
    builder.add_edge("roteiro.editor_retencao", "roteiro.revisor_fidelidade")
    builder.add_edge("roteiro.revisor_fidelidade", "roteiro.revisor_tom")

    # Roteador de ciclo avalia os 3 revisores juntos
    builder.add_conditional_edges(
        "roteiro.revisor_tom",
        roteador_ciclo_roteiro,
        {"roteiro.roteirista": "roteiro.roteirista", "__end__": END},
    )

    return builder.compile()
