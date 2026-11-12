"""Agentes Especialistas: Diretor de Cenas POV (`cenas.diretor` v1.0.0) e Engenheiro de Prompt de Imagem — SOBREVIDA · Você sobreviveria? (Doc 03 v2.0 POV Realista).

Responsável por transformar os planos do Roteirista v3.1.0 em prompts de imagem e vídeo
em primeira pessoa (POV realista):
- Lente 24mm na altura dos olhos, luz natural motivada, grão de filme, tons terrosos dessaturados com sombras carvão (#2B2A28)
- Assinatura fixa das mãos (cordão de couro com plaquinha de madeira no pulso esquerdo, cicatriz curada no dorso da mão direita)
- Companheiro como único rosto humano fixo do episódio (companion_token + 3 marcas fixas)
- Rosto do protagonista (Nico) apenas em reflexo (máximo 1 vez por episódio)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from contratos.agentes import DiretorCenasBlocoOutput
from contratos.estado import EstadoEpisodio
from grafo.base import no_agente

LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Blocos fixos oficiais do Diretor de Cenas v1.0.0 (POV Realista — Seção 3)
# ---------------------------------------------------------------------------
SOBREVIDA_POV_STYLE_BASE_TEMPLATE = (
    "photorealistic first-person POV, shot on 24mm lens, eye level, handheld feel, "
    "natural motivated light, film grain, muted earthy color grade with charcoal shadows, "
    "historically accurate {lugar_en} {ano}, no text"
)

SOBREVIDA_FILM_STILL_STYLE_BASE_TEMPLATE = (
    "cinematic film still, shot on 24mm lens, eye level, handheld feel, "
    "natural motivated light, film grain, muted earthy color grade with charcoal shadows, "
    "historically accurate {lugar_en} {ano}, no text"
)

ASSINATURA_MAOS_COMPLETA = (
    "the viewer's own hands in the lower frame, correct left hand on the left and right hand on the right, "
    "five fingers each: rough tanned hands of a 20-year-old man, a thin leather cord bracelet with a small "
    "carved wooden token on the left wrist, a small healed scar across the back of the right hand"
)

ASSINATURA_MAO_DIREITA = (
    "only the viewer's right hand is visible in the lower center frame, five fingers: rough tanned hand "
    "of a 20-year-old man, a small healed scar across the back of the right hand"
)

ASSINATURA_MAO_ESQUERDA = (
    "only the viewer's left hand with the leather cord bracelet is visible, five fingers: rough tanned hand "
    "of a 20-year-old man, a thin leather cord bracelet with a small carved wooden token on the left wrist"
)

SOBREVIDA_POV_NEGATIVE = (
    "third-person view of the protagonist, extra fingers, extra hands, deformed hands, "
    "modern clothing, modern objects, watermark, text, letters, logo, gore, blood splatter, "
    "open wounds, corpses in close-up, cartoon, anime, 3d render"
)

CORPO_ESTADO_MAOS: Dict[str, str] = {
    "inteiro": "clean skin",
    "desgastado": "dirty hands, black grime under the nails, cracked dry skin",
    "no_limite": "scraped dirty hands, a strip of cloth tied around the right palm, trembling",
}

CORPO_ESTADO_IMAGEM: Dict[str, str] = {
    "inteiro": "sharp focus, natural colors",
    "desgastado": "slight vignette, cooler and more desaturated colors",
    "no_limite": "blurred edges, heavy vignette, strongly desaturated, slight motion blur",
}

LUZ_PLANO_MAP: Dict[str, str] = {
    "amanhecer": "cold blue dawn light, low sun on the horizon",
    "dia": "soft overcast daylight",
    "fim_de_tarde": "low amber sunset light, long shadows",
    "noite": "moonlight and distant torch light, deep shadows",
    "vela": "single tallow candle light, warm flicker, deep black shadows",
}

MOVIMENTO_VIDEO_POR_MOVIMENTO: Dict[str, str] = {
    # Movimentos v4.0 (Cinema de Sobrevivência de Hollywood)
    "choque_in_media_res": "urgent first-person POV handheld camera motion, debris and dust reacting in the air",
    "pressao_ambiente": "steady forward first-person POV progression through the historical environment",
    "erro_da_multidao": "first-person POV camera observing the panicked crowd ahead",
    "manobra_tatica": "focused first-person POV of hands executing the practical survival technique",
    "complicacao_mas_portanto": "sudden camera jolt and push-in as the unexpected physical complication strikes",
    "cliffhanger_loop": "rapid first-person POV push-in toward the emerging threat, high tension",
    "payoff_chekhov": "intense close-range first-person POV of hands using the planted tool in a life-or-death action",
    "registro_historico": "slow solemn forward drift across the aftermath landscape",
    # Movimentos v3.0 (Retrocompatibilidade)
    "ritual": "slow eyes-opening fade from black, gentle handheld breathing motion",
    "situa": "slow forward walking motion, subtle head bob",
    "fecha_loop": "slow forward walking motion, subtle head bob",
    "ameaca": "slow push-in toward the threat ahead, slight handheld shake",
    "opcoes": "subtle handheld breathing motion at the fork",
    "consequencia": "hands trembling, focus slowly drifts and blurs",
    "loop_aberto": "quick head turn to the left, motion blur",
    "resultado": "slow push-in, slight handheld shake",
    "verdade": "slow loss of focus and fade to black",
}


def inferir_corpo_estado_por_sequencia(ordem_sequencia: int) -> str:
    """Infere o desgaste físico visível nas mãos em POV a partir da sequência dramática (0..7), sem barras de RPG."""
    if ordem_sequencia <= 1:
        return "inteiro"
    if ordem_sequencia <= 4:
        return "desgastado"
    return "no_limite"

# Retrocompatibilidade com testes legados do pipeline Firefly
NICO_CHARACTER_DESC = (
    "first-person POV of Nico (20-year-old man, rough tanned hands, thin leather cord bracelet with carved wooden token on left wrist, "
    "small healed scar on back of right hand, faded red wool scarf)"
)
TITO_CHARACTER_DESC = NICO_CHARACTER_DESC

SOBREVIDA_STYLE_BASE = (
    "photorealistic first-person POV, shot on 24mm lens, eye level, handheld feel, "
    "natural motivated light, film grain, muted earthy color grade with charcoal #2B2A28 shadows, "
    "parchment #EDE3CC highlights, blood red #9E2B25 and dirty gold #D9A13B accents (#16110D, #E85D04), "
    "historically accurate setting, cinematic composition, 16:9, no text"
)
OUTRORA_STYLE_BASE = SOBREVIDA_STYLE_BASE
SOBREVIDA_NEGATIVE_PROMPT = SOBREVIDA_POV_NEGATIVE
OUTRORA_NEGATIVE_PROMPT = SOBREVIDA_POV_NEGATIVE


def montar_cena_diretor_pov(
    plano: Dict[str, Any],
    lugar_en: str,
    ano: str,
    companion_token: str,
    locacao_tokens: Dict[str, str],
    objeto_token: str = "",
) -> Dict[str, Any]:
    """Monta o item de cena estruturado de um plano segundo a Seção 4 e 7 do Diretor de Cenas v1.0.0."""
    pid = str(plano.get("id", "B0.p01"))
    enq = str(plano.get("enquadramento", "pov_olho"))
    corpo_estado = str(plano.get("corpo_estado") or "inteiro")
    luz_key = str(plano.get("luz") or "dia")
    loc_id = str(plano.get("locacao_id") or "L01")
    loc_desc = locacao_tokens.get(loc_id, lugar_en)
    animar = bool(plano.get("animar", False))
    cortavel_short = bool(plano.get("cortavel_para_short", False))
    companheiro_em_cena = bool(plano.get("companheiro_em_cena", False))
    grafico = plano.get("grafico") or {}
    tipo_grafico = grafico.get("tipo", "nenhum")
    pov_acao = str(plano.get("pov_acao") or plano.get("nico_acao") or "the historical scene ahead").strip()

    # Plano tela_escura recebe prompt: null
    if tipo_grafico == "tela_escura":
        return {
            "id": pid,
            "enquadramento": enq,
            "proporcao": "16:9",
            "prompt": None,
            "prompt_vertical": None,
            "negativo": SOBREVIDA_POV_NEGATIVE,
            "referencias": [],
            "seed_grupo": loc_id,
            "animar": animar,
            "prompt_movimento": "slow loss of focus and fade to black" if animar else None,
            "duracao_video_s": 5.0 if animar else None,
            "checagens": ["tela preta na edição (sem geração de imagem)"],
        }

    # Determina visibilidade das mãos conforme tabela da Seção 4
    if enq in ("aberto", "detalhe"):
        maos_visiveis = False
        bloco_maos = ""
    elif enq == "escolha_ab":
        maos_visiveis = True
        bloco_maos = f"{ASSINATURA_MAO_DIREITA}, {CORPO_ESTADO_MAOS.get(corpo_estado, 'clean skin')}"
    elif enq in ("pov_maos", "reflexo") or bool(plano.get("maos_visiveis", False)):
        maos_visiveis = True
        bloco_maos = f"{ASSINATURA_MAOS_COMPLETA}, {CORPO_ESTADO_MAOS.get(corpo_estado, 'clean skin')}"
    else:
        maos_visiveis = False
        bloco_maos = ""

    # Prefixo de enquadramento (Seção 4)
    dados_op = grafico.get("dados") or {}
    op_a_en = dados_op.get("A") or dados_op.get("opcao_a") or "path A"
    op_b_en = dados_op.get("B") or dados_op.get("opcao_b") or "path B"

    if enq == "aberto":
        prefixo = f"Wide establishing cinematic film still of {loc_desc}"
    elif enq == "detalhe":
        prefixo = f"Close-up cinematic film still of {objeto_token or pov_acao} in {loc_desc}"
    elif enq == "pov_maos":
        prefixo = f"First-person POV looking down at the viewer's own hands: {pov_acao} in {loc_desc}"
    elif enq == "pov_baixo":
        prefixo = f"First-person POV looking down at the ground and feet, faded red wool scarf edge visible: {pov_acao} in {loc_desc}"
    elif enq == "pov_companheiro":
        prefixo = (
            f"First-person POV, {companion_token} standing in front of the camera, "
            f"looking straight into the lens, {pov_acao} in {loc_desc}"
        )
    elif enq == "reflexo":
        prefixo = (
            "First-person POV looking into water reflection, the reflection shows a skinny 20-year-old man "
            "with short black curly hair, a cloth bandage on the forehead and a faded red wool scarf, "
            f"{pov_acao} in {loc_desc}"
        )
    elif enq == "escolha_ab":
        prefixo = (
            f"Perfectly symmetrical first-person POV at a fork in {loc_desc}: "
            f"on the left {op_a_en}, on the right {op_b_en}"
        )
    else:  # pov_olho
        prefixo = f"First-person POV looking ahead at {pov_acao} in {loc_desc}"

    partes: List[str] = [prefixo]
    if companheiro_em_cena and enq != "pov_companheiro":
        partes.append(f"{companion_token} looking straight into the lens")
    if bloco_maos:
        partes.append(bloco_maos)
    partes.append(LUZ_PLANO_MAP.get(luz_key, LUZ_PLANO_MAP["dia"]))
    partes.append(CORPO_ESTADO_IMAGEM.get(corpo_estado, CORPO_ESTADO_IMAGEM["inteiro"]))

    estilo_base = (
        SOBREVIDA_FILM_STILL_STYLE_BASE_TEMPLATE.format(lugar_en=lugar_en, ano=ano)
        if enq in ("aberto", "detalhe")
        else SOBREVIDA_POV_STYLE_BASE_TEMPLATE.format(lugar_en=lugar_en, ano=ano)
    )
    partes.append(estilo_base)

    prompt_final = ", ".join(p for p in partes if p)
    prompt_vertical = (
        f"Vertical 9:16 centered composition, {prompt_final}" if cortavel_short else None
    )

    referencias: List[str] = []
    if maos_visiveis:
        referencias.append("maos")
    if companheiro_em_cena or enq == "pov_companheiro":
        referencias.append("companheiro")

    checagens = ["sem objetos modernos", "sem texto na imagem"]
    if maos_visiveis:
        checagens = ["5 dedos por mão", "cordão no pulso esquerdo", "cicatriz na mão direita"] + checagens
    if "companheiro" in referencias:
        checagens.append("companheiro com as 3 marcas fixas")

    mov_key = str(plano.get("movimento") or "situa")
    prompt_mov = MOVIMENTO_VIDEO_POR_MOVIMENTO.get(mov_key, "slow forward walking motion, subtle head bob") if animar else None

    return {
        "id": pid,
        "enquadramento": enq,
        "proporcao": "16:9",
        "prompt": prompt_final,
        "prompt_vertical": prompt_vertical,
        "negativo": SOBREVIDA_POV_NEGATIVE,
        "referencias": referencias,
        "seed_grupo": loc_id,
        "animar": animar,
        "prompt_movimento": prompt_mov,
        "duracao_video_s": 5.0 if animar else None,
        "checagens": checagens,
    }


def gerar_bloco_diretor_cenas_pov(entrada_diretor: Dict[str, Any]) -> Dict[str, Any]:
    """Gera o pacote JSON completo de cenas POV de um bloco (`DiretorCenasBlocoOutput`)."""
    ep = entrada_diretor.get("episodio") or {}
    lugar_en = ep.get("lugar_en") or ep.get("lugar") or "Florence, Italy"
    ano = str(ep.get("ano") or ep.get("data") or "1348")
    comp = ep.get("companheiro") or {}
    companion_token = entrada_diretor.get("companion_token") or (
        f"{comp.get('descricao_visual', 'a young woman around 22')}, "
        + ", ".join(comp.get("marcas_fixas") or ["linen coif", "mole on left cheek", "wooden spindle in belt"])
    )
    locacao_tokens: Dict[str, str] = dict(entrada_diretor.get("locacao_tokens") or {})
    for loc in ep.get("locacoes") or []:
        lid = loc.get("id")
        if lid and lid not in locacao_tokens:
            locacao_tokens[lid] = loc.get("descricao") or loc.get("nome") or lugar_en

    obj_info = ep.get("objeto_plantado") or {}
    objeto_token = str(entrada_diretor.get("objeto_token") or obj_info.get("objeto") or "a heavy hand-forged iron key")
    planos = entrada_diretor.get("planos") or []

    cenas = [
        montar_cena_diretor_pov(
            plano=p,
            lugar_en=lugar_en,
            ano=ano,
            companion_token=companion_token,
            locacao_tokens=locacao_tokens,
            objeto_token=objeto_token,
        )
        for p in planos
    ]

    saida = {
        "bloco": int(entrada_diretor.get("bloco", 0)),
        "companion_token": companion_token,
        "locacao_tokens": locacao_tokens,
        "objeto_token": objeto_token,
        "cenas": cenas,
        "alertas": [],
    }
    erros = validar_bloco_diretor_cenas_pov(saida, planos)
    if erros:
        saida["alertas"].extend(erros)
    return DiretorCenasBlocoOutput.model_validate(saida).model_dump()


def validar_bloco_diretor_cenas_pov(
    saida_diretor: Dict[str, Any],
    planos_entrada: Optional[List[Dict[str, Any]]] = None,
) -> List[str]:
    """Validador em código do checklist da Seção 7 e 9 do Diretor de Cenas v1.0.0."""
    erros: List[str] = []
    cenas = saida_diretor.get("cenas") or []
    companion_token = str(saida_diretor.get("companion_token") or "").strip()

    if planos_entrada is not None:
        if len(cenas) != len(planos_entrada):
            erros.append(
                f"[DIRETOR CENAS] Quantidade de cenas ({len(cenas)}) difere da quantidade de planos ({len(planos_entrada)})."
            )
        else:
            for c, p in zip(cenas, planos_entrada):
                if c.get("id") != p.get("id"):
                    erros.append(f"[DIRETOR CENAS] ID de cena '{c.get('id')}' fora de ordem (esperado '{p.get('id')}').")

    for idx, c in enumerate(cenas):
        cid = c.get("id", f"idx_{idx}")
        enq = c.get("enquadramento")
        prompt = c.get("prompt")
        neg = str(c.get("negativo") or "")
        animar = bool(c.get("animar", False))
        p_orig = planos_entrada[idx] if planos_entrada and idx < len(planos_entrada) else {}
        tipo_graf = ((p_orig.get("grafico") or {}).get("tipo")) if p_orig else None

        if SOBREVIDA_POV_NEGATIVE not in neg:
            erros.append(f"[DIRETOR CENAS] Cena {cid}: prompt negativo não contém o bloco fixo obrigatório.")

        if tipo_graf == "tela_escura":
            if prompt is not None:
                erros.append(f"[DIRETOR CENAS] Cena {cid}: plano 'tela_escura' deve ter prompt=null.")
            continue

        if not prompt:
            erros.append(f"[DIRETOR CENAS] Cena {cid}: prompt vazio.")
            continue

        if "shot on 24mm lens" not in prompt or "no text" not in prompt:
            erros.append(f"[DIRETOR CENAS] Cena {cid}: estilo base 24mm/no text ausente no prompt.")

        if enq in ("aberto", "detalhe"):
            if "cinematic film still" not in prompt:
                erros.append(f"[DIRETOR CENAS] Cena {cid} ('{enq}'): deve usar 'cinematic film still' no estilo base.")
            if "maos" in (c.get("referencias") or []):
                erros.append(f"[DIRETOR CENAS] Cena {cid} ('{enq}'): não deve incluir referência de mãos.")
        else:
            if "photorealistic first-person POV" not in prompt:
                erros.append(f"[DIRETOR CENAS] Cena {cid} ('{enq}'): deve usar 'photorealistic first-person POV'.")

        if (p_orig.get("companheiro_em_cena") or enq == "pov_companheiro") and companion_token:
            if companion_token not in prompt:
                erros.append(f"[DIRETOR CENAS] Cena {cid}: companion_token ausente em plano com companheiro.")

        if animar:
            mov = c.get("prompt_movimento")
            dur = c.get("duracao_video_s")
            if not mov:
                erros.append(f"[DIRETOR CENAS] Cena {cid}: animar=True exige prompt_movimento.")
            if dur is None or not (4.0 <= float(dur) <= 6.0):
                erros.append(f"[DIRETOR CENAS] Cena {cid}: duracao_video_s ({dur}) deve ficar entre 4 e 6 segundos.")
        else:
            if c.get("prompt_movimento") is not None or c.get("duracao_video_s") is not None:
                erros.append(f"[DIRETOR CENAS] Cena {cid}: animar=False exige prompt_movimento=null e duracao_video_s=null.")

        if p_orig.get("cortavel_para_short") and not c.get("prompt_vertical"):
            erros.append(f"[DIRETOR CENAS] Cena {cid}: plano cortavel_para_short=True exige prompt_vertical (9:16).")

    return erros


def construir_prompt_cinematografico(plano: Dict[str, Any], color_script: Dict[str, Any] | None = None) -> str:
    """Gera prompt cinematográfico POV em inglês com a identidade visual SOBREVIDA."""
    mundo = plano.get("mundo", "parede")
    tipo_plano = plano.get("tipo_plano", "medio")
    proporcao = plano.get("proporcao", "16:9")
    parede = plano.get("parede", "medieval_plague_street")
    fogo = plano.get("fogo", {})
    nivel_fogo = fogo.get("nivel", 2)
    camera = plano.get("camera", {})
    lente = camera.get("lente_mm", 24)
    movimento = camera.get("movimento", "push_in_lento")
    destino = plano.get("destino", "Florence, Italy during the Black Death, 1348")

    if mundo == "contador":
        cena_desc = (
            f"First-person POV at a crossroads in {destino}, {ASSINATURA_MAOS_COMPLETA}, "
            f"{lente}mm lens, natural motivated lighting level {nivel_fogo}/5, 16:9 frame"
        )
    else:
        if tipo_plano in ("friso", "escala"):
            enquadramento = (
                f"Wide establishing cinematic film still of {destino} ({parede}) just before danger strikes, "
                "ordinary people going about their day"
            )
        elif tipo_plano == "close":
            enquadramento = (
                f"First-person POV looking closely at companion in {destino} ({parede}), terrified expression looking straight into the lens"
            )
        elif tipo_plano == "insert":
            enquadramento = (
                f"Close-up cinematic film still of survival rations, old coins and historical hazards in {destino} ({parede})"
            )
        else:
            enquadramento = (
                f"First-person POV looking ahead at survival crossroads in {destino} ({parede}), {ASSINATURA_MAOS_COMPLETA}"
            )

        marionetes = plano.get("marionetes") or []
        semiotica_extra = ""
        if marionetes:
            partes_m = []
            for m in marionetes:
                mid = str(m.get("id", ""))
                mdir = str(m.get("direcao", "dir"))
                dir_txt = "facing right towards home" if mdir == "dir" else "facing left towards threat"
                if "polifemo" in mid.lower():
                    partes_m.append(f"giant Cyclops Polyphemus ({mid}) {dir_txt}")
                else:
                    partes_m.append(f"{mid} {dir_txt}")
            semiotica_extra = " Characters in scene: " + ", ".join(partes_m) + "."

        cena_desc = (
            f"{enquadramento}.{semiotica_extra} Shot type: {tipo_plano}, framing: {proporcao} aspect ratio. "
            f"Natural motivated lighting level {nivel_fogo}/5, {lente}mm lens, {movimento} camera motion"
        )

    prompt_completo = (
        f"Masterpiece cinematic frame, {cena_desc}, {SOBREVIDA_STYLE_BASE}, "
        f"clean composition, high contrast, historical accuracy"
    )

    prompt_sanitizado = prompt_completo.replace("\x00", "").strip()
    return prompt_sanitizado[:1500]


@no_agente("cenas.diretor", categoria_modelo="LLM-R")
def diretor_cenas_pov_node(state: EstadoEpisodio) -> Dict[str, Any]:
    """Nó do Agente Diretor de Cenas POV (`cenas.diretor` v1.0.0 — SOBREVIDA)."""
    esqueleto = state.get("roteiro", {}).get("esqueleto", {}) or {}
    ep_meta = esqueleto.get("episodio") or state.get("episodio") or {}
    planos = list(state.get("decupagem", {}).get("planos", []))

    pacote = gerar_bloco_diretor_cenas_pov({
        "episodio": ep_meta,
        "bloco": 0,
        "planos": planos,
    })
    cenas_por_id = {c["id"]: c for c in pacote.get("cenas", [])}
    for p in planos:
        cena = cenas_por_id.get(p.get("id"))
        if cena:
            p["prompt_imagem"] = cena.get("prompt")
            p["prompt_negativo"] = cena.get("negativo")
            p["prompt_movimento"] = cena.get("prompt_movimento")

    return {
        "decupagem": {
            "planos": planos,
        }
    }


@no_agente("direcao.engenheiro_prompt_imagem", categoria_modelo="LLM-R")
def engenheiro_prompt_imagem_node(state: EstadoEpisodio) -> Dict[str, Any]:
    """Nó do Agente Engenheiro de Prompt de Imagem (SOBREVIDA)."""
    planos = list(state.get("decupagem", {}).get("planos", []))
    color_script = state.get("color_script")

    for p in planos:
        p["prompt_imagem"] = construir_prompt_cinematografico(p, color_script=color_script)

    return {
        "decupagem": {
            "planos": planos,
        }
    }



# ---------------------------------------------------------------------------
# Motor Raiz de Consistência de DNA de Personagens e Ambientes (POV v2.0)
# ---------------------------------------------------------------------------
ANCORA_CONTINUIDADE_VIDEO_POV = (
    "Strict visual continuity with the reference first frame: preserve exact photorealistic 35mm film textures, "
    "exact character appearance, skin tone, clothing fabric, lighting direction, and architectural geometry without style morphing."
)


def injetar_dna_consistencia_pov(
    planos: List[Dict[str, Any]],
    episodio_meta: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Injeta nos prompts de imagem e vídeo o DNA canônico imutável de mãos, companheiro e ambiente (locacao_id)."""
    dna_maos = str(episodio_meta.get("dna_maos") or ASSINATURA_MAOS_COMPLETA).strip()
    raw_comp = episodio_meta.get("dna_companheiro") or ""
    if isinstance(raw_comp, dict):
        comp_nome = str(raw_comp.get("nome") or "").strip()
        dna_companheiro = str(raw_comp.get("descricao") or "").strip()
    else:
        comp_nome = ""
        dna_companheiro = str(raw_comp).strip()
    dna_locacoes: Dict[str, str] = dict(episodio_meta.get("dna_locacoes") or {})

    for p in planos:
        enq = str(p.get("enquadramento") or p.get("tipo_enquadramento") or "pov_maos")
        loc_id = str(p.get("locacao_id") or "")
        loc_dna = dna_locacoes.get(loc_id, "").strip()

        prompt_img = str(p.get("prompt_imagem") or "").strip()
        if loc_dna and loc_dna.lower() not in prompt_img.lower():
            prompt_img = f"{prompt_img.rstrip('. ')}. Canonical environment ({loc_id}): {loc_dna}."

        if enq in ("pov_maos", "pov_interacao_maos", "pov_acao", "escolha_ab", "reflexo", "pov_companion", "pov_companheiro") or p.get("maos_visiveis"):
            if dna_maos and dna_maos[:32].lower() not in prompt_img.lower():
                prompt_img = f"{prompt_img.rstrip('. ')}. Canonical first-person hands: {dna_maos}."

        mov_base = str(p.get("prompt_movimento") or p.get("prompt_video") or "").strip()
        comp_mencionado = bool(comp_nome and comp_nome.lower() in (prompt_img + " " + mov_base).lower())
        if enq in ("pov_companion", "pov_companheiro") or p.get("companheiro_em_cena") or comp_mencionado:
            if dna_companheiro and dna_companheiro[:32].lower() not in prompt_img.lower():
                prompt_img = f"{prompt_img.rstrip('. ')}. Canonical companion: {dna_companheiro}."
            if dna_companheiro and dna_companheiro[:32].lower() not in mov_base.lower():
                mov_base = f"{mov_base.rstrip('. ')}. Companion appearance: {dna_companheiro}."

        p["prompt_imagem"] = prompt_img
        p["prompt_start_frame"] = prompt_img

        if ANCORA_CONTINUIDADE_VIDEO_POV.lower() not in mov_base.lower():
            p["prompt_video"] = f"{mov_base.rstrip('. ')}. {ANCORA_CONTINUIDADE_VIDEO_POV}"
        else:
            p["prompt_video"] = mov_base

    return planos


def validar_consistencia_dna_personagens_e_ambientes(
    planos: List[Dict[str, Any]],
    episodio_meta: Dict[str, Any],
) -> List[str]:
    """Valida que 100% dos planos possuem locacao_id canônica e que mãos/companheiro seguem o DNA fixo do episódio."""
    erros: List[str] = []
    dna_locacoes: Dict[str, str] = dict(episodio_meta.get("dna_locacoes") or {})
    for p in planos:
        pid = str(p.get("id", "?"))
        loc_id = str(p.get("locacao_id") or "")
        if dna_locacoes and loc_id not in dna_locacoes:
            erros.append(f"[CONSISTÊNCIA AMBIENTE] Plano '{pid}' sem locacao_id canônica válida ('{loc_id}').")
        pv = str(p.get("prompt_video") or "")
        if "2d hand-drawn" in pv.lower():
            erros.append(f"[CONSISTÊNCIA ESTILO] Plano '{pid}' contém prompt 2D legado no vídeo POV realista.")
        if "strict visual continuity" not in pv.lower():
            erros.append(f"[CONSISTÊNCIA VÍDEO] Plano '{pid}' sem âncora de continuidade visual no prompt_video.")
        if p.get("enquadramento") == "escolha_ab" or p.get("tipo_enquadramento") == "escolha_ab":
            erros.append(f"[SPLIT-SCREEN A/B PROIBIDO] Plano '{pid}' usa 'escolha_ab' abolido no Cinema de Sobrevivência v4.0.")
    return erros
