"""Produção Completa 1:1 no Adobe Firefly — SOBREVIDA v4.0 (Cinema de Sobrevivência Histórica POV).

Episódio: Como Sobreviver ao Grande Dilúvio da Mesopotâmia (Shuruppak, ~2900 a.C.)
ID: ep_sobrevida_8m_diluvio_pov
Estrutura Oficial v4.0: 8 Sequências de Hollywood (Prólogo In Media Res, O Mundo Prestes a Ruir,
A Primeira Armadilha, Escalada e Improviso, A Grande Virada, O Preço Humano, No Limite Físico, O Eco na História)
Voz Oficial: Fenrir (gemini-3.8-flash-tts + fallback resiliente, 48 kHz 24-bit, -14.0 LUFS, zero pausas mortas)
Mixagem: Foley Diegético Real + BGM Orquestral em 5 Movimentos + Sidechain Suave + Silêncio Dramático de 1.5s no p31
Visual: POV Realista em 1ª pessoa (lente 24mm, mãos do calafetador sumério, Iddin, Timecode Diegético de Cinema)
Animação: Adobe Firefly (Kling 2.5 Turbo, 1080p, 16:9, 24fps, 100% progressivo sem reverse) — Política Zero-Reuso
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from contratos.integridade_assets import (
    calcular_janelas_dinamicas_sem_pausas,
    criar_diretorios_episodio_isolado,
    inicializar_e_indexar_acervo_legado,
    validar_ausencia_pausas_longas_entre_takes,
    validar_ausencia_quiz_escolha_ab,
    validar_e_registrar_asset_inedito,
    validar_filtro_video_sem_reverse,
    validar_paridade_1_para_1_blocos_planos,
)
from grafo.direcao.engenheiro_prompt_imagem import (
    injetar_dna_consistencia_pov,
    validar_consistencia_dna_personagens_e_ambientes,
)
from grafo.ferramentas.audio import sintetizar_voz_gemini_com_fallback
from grafo.ferramentas.gerador_imagem_cli import GeradorImagemCLI
from orquestrador_episodio_puro_firefly import (
    enfileirar_episodio_no_firefly,
    executar_worker_firefly_ate_concluir,
    validar_todos_start_frames_ineditos,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | [DILÚVIO POV v4.0 HOLLYWOOD] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("sobrevida_8m_diluvio_pov")

EPISODIO_ID = "ep_sobrevida_8m_diluvio_pov"
DURACAO_BLOCO_S = 14.0
NUM_BLOCOS = 36
DURACAO_TOTAL_S = DURACAO_BLOCO_S * NUM_BLOCOS
SR = 48000
TOTAL_SAMPLES = int(SR * DURACAO_TOTAL_S)

# Silêncio Dramático absoluto de 1.50s no clímax da Sequência 6 (final do plano p31)
SILENCIO_INICIO_S = 428.50
SILENCIO_FIM_S = 430.00

DNA_MAOS_DILUVIO = (
    "both weathered olive-bronze Sumerian boatbuilder hands and bare muscular forearms visible in the lower frame "
    "(short-sleeved coarse undyed wool Sumerian tunic above the elbows, NO long sleeves, NO modern clothing), "
    "faint healed rope-burn scar on the right forearm, braided palm-fiber cord bracelet on the left wrist, "
    "five fingers each, stained with black natural bitumen pitch and river mud"
)

DNA_COMPANHEIRO_IDDIN = (
    "Iddin, a 19-year-old young Sumerian shipyard apprentice with short dark wavy hair, clean-shaven youthful "
    "Mesopotamian face (NO beard), small scar above right eyebrow, wearing a short-sleeved ochre-tan coarse linen tunic "
    "with reed rope belt, stained with black bitumen pitch and wet river silt"
)

DNA_LOCACOES_DILUVIO: Dict[str, str] = {
    "L01_ESTALEIRO_SHURUPPAK": (
        "ancient Sumerian reed-and-timber boatyard on the Euphrates canal bank in Shuruppak, Mesopotamia, 2900 BC, "
        "mudbrick workshops, bundles of giant golden marsh reeds, smoking clay pots of boiling black bitumen pitch, mud levee wall"
    ),
    "L02_RUAS_TIJOLO_CRU": (
        "narrow sun-dried mudbrick streets and flat earthen rooftops of ancient Shuruppak, Mesopotamia, 2900 BC, "
        "under black monsoon storm clouds, dissolving mudbrick walls collapsing into chest-deep churning brown floodwater"
    ),
    "L03_CANAL_ROMPIDO_GRANEL": (
        "breached Euphrates earthen levee and collapsing mudbrick royal granary in Shuruppak, 2900 BC, "
        "violent brown floodwater surge, floating cedar timbers and capsizing wooden river skiffs in torrential rain"
    ),
    "L04_MAR_INTERIOR_PALMEIRAS": (
        "flooded Mesopotamian plain turned into an endless dark inland sea at night, 2900 BC, "
        "submerged tops of date-palm groves, curved Sumerian reed-and-bitumen kuphar boat lit by a flickering clay oil lamp in torrential rain"
    ),
    "L05_BARRAGEM_PEDRA_MONTE_NISIR": (
        "submerged ancient stone irrigation weir in raging floodwater transitioning at dawn to the rocky limestone foothills "
        "of Mount Nisir above the mist-covered flooded Mesopotamian plain, 2900 BC (NO modern roads or structures)"
    ),
}

EPISODIO_META: Dict[str, Any] = {
    "perigo": "Grande Dilúvio da Mesopotâmia (Cheia Catastrófica do Eufrates)",
    "lugar": "Shuruppak, Suméria (Baixa Mesopotâmia)",
    "data": "c. 2900 a.C.",
    "papel_do_jogador": "calafetador de barcos sumério (malāḫu) de 22 anos às margens do Eufrates",
    "serie": "Como Ele Sobreviveria?",
    "duracao_alvo_min": 7.2,
    "titulo_opcoes": [
        "Como Sobreviver ao Grande Dilúvio da Mesopotâmia (2900 a.C.)",
        "O Dilúvio Real em 1ª Pessoa: Como um Sumério Sobreviveu?",
        "7 Dias no Grande Dilúvio: A Engenharia Real da Sobrevivência",
    ],
    "promessa_thumbnail": "7 DIAS NO DILÚVIO",
    "chance_base_pct": 62,
    "chance_final_pct": 18,
    "dna_maos": DNA_MAOS_DILUVIO,
    "dna_companheiro": DNA_COMPANHEIRO_IDDIN,
    "dna_locacoes": DNA_LOCACOES_DILUVIO,
    "personagens": [
        {
            "id": "voce_maos",
            "papel": "maos_do_jogador",
            "nome": "Você (Calafetador de barcos sumério, 22 anos)",
            "Prompt_Base_Maos": DNA_MAOS_DILUVIO,
            "Prompt_Base_Reflexo": (
                "reflected in dark rain-rippled bilge water: 22-year-old Sumerian man with short dark wavy hair soaked by rain, "
                "exhausted eyes red from bitumen smoke, face smeared with river mud and black pitch"
            ),
            "aparece_em_planos": [
                "p01", "p04", "p07", "p10", "p11", "p15", "p16", "p19",
                "p21", "p22", "p25", "p26", "p27", "p29", "p30", "p35",
            ],
        },
        {
            "id": "iddin",
            "papel": "companheiro",
            "nome": "Iddin (Aprendiz do estaleiro, 19 anos)",
            "Prompt_Base": DNA_COMPANHEIRO_IDDIN,
            "aparece_em_planos": ["p05", "p12", "p18", "p24", "p31", "p34"],
        },
    ],
    "objetos_recorrentes": [
        {
            "id": "cinzel_bronze",
            "Prompt_Base": "heavy ancient Sumerian cast-bronze caulking chisel with wooden handle stained with black bitumen",
            "aparece_em_planos": ["p06", "p07", "p16", "p30", "p35"],
        },
        {
            "id": "pote_betume_kupru",
            "Prompt_Base": "smoking clay pot filled with molten black Mesopotamian bitumen pitch (kupru)",
            "aparece_em_planos": ["p05", "p11", "p19"],
        },
    ],
}

# =============================================================================
# 1. DECUPAGEM COMPLETA DE 36 PLANOS POV v4.0 HOLLYWOOD (ZERO QUIZ A/B)
# =============================================================================
RAW_36_PLANOS_DILUVIO: List[Dict[str, Any]] = [
    # SEQUÊNCIA 0 · PRÓLOGO IN MEDIA RES (p01 a p04)
    {
        "plano": 1,
        "id": "p01",
        "bloco": "Seq 0 · Prólogo In Media Res",
        "enquadramento": "pov_maos",
        "relogio": "DIA 3 DO DILÚVIO · PLANÍCIE SUMÉRIA SUBMERSA",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Terceiro dia da grande inundação da Suméria, dois mil e novecentos antes de Cristo. "
            "Suas mãos sujas de piche negro agarram a borda de um barco redondo de junco enquanto ondas barrentas "
            "sacodem dez anéis de prata no fundo do casco — sessenta reais, tudo o que você possui."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a pitched reed boat during a violent storm in Mesopotamia, 2900 BC. "
            "Both weathered olive-bronze Sumerian hands and bare forearms visible in the lower frame with a healed rope-burn scar and palm-fiber wrist cord, "
            "gripping the bitumen-coated woven reed gunwale while ten ancient silver rings roll in shallow rainwater at the bottom of the hull, "
            "churning brown floodwater and lightning outside, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic first-person POV shot. Both hands grip the wet bitumen-coated reed gunwale tightly "
            "as a violent brown wave rocks the boat and rain splashes across the silver rings at 24fps."
        ),
    },
    {
        "plano": 2,
        "id": "p02",
        "bloco": "Seq 0 · Prólogo In Media Res",
        "enquadramento": "ambiente",
        "relogio": "6 HORAS ANTES · SHURUPPAK · MARGEM DO EUFRATES",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Seis horas antes, na cidade suméria de Shuruppak, o rio Eufrates já descia grosso de lama vermelha das montanhas do norte. "
            "No horizonte, uma muralha de nuvens negras do Golfo Pérsico engolia o sol do meio-dia."
        ),
        "prompt_imagem": (
            "Cinematic film still, shot on 24mm lens at eye level on the riverbank of ancient Shuruppak, Mesopotamia, 2900 BC. "
            "The swollen Euphrates river churns with thick red-brown mud and uprooted cedar trunks; along the bank stand Sumerian mudbrick houses "
            "and reed boatyards under a colossal wall of pitch-black storm clouds blotting out the sun, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic historical scene. The swollen muddy Euphrates river surges rapidly downstream carrying timber debris "
            "as dark storm clouds roll across the Sumerian mudbrick city at 24fps."
        ),
    },
    {
        "plano": 3,
        "id": "p03",
        "bloco": "Seq 0 · Prólogo In Media Res",
        "enquadramento": "detalhe",
        "relogio": "FALTAM 2 HORAS · A ARMADILHA DE BARRO CRU",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": 62},
        "hud_evento": "tap",
        "sfx_cue": "pedras_telhado",
        "texto": (
            "Sete dias de tempestade contínua vão transformar a planície entre o Tigre e o Eufrates num mar interior sem praias. "
            "E o que vai condenar quase toda a população não é a falta de aviso — é o próprio barro cru de que a cidade inteira foi erguida."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens of sun-dried Sumerian mudbrick walls in Shuruppak, Mesopotamia, 2900 BC. "
            "Heavy torrential rain pelts the unfired clay bricks mixed with straw, causing thick brown mud to dissolve and trickle down "
            "widening structural cracks, dramatic storm lighting, subtle 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic close-up shot. Torrential rain lashes the sun-dried mudbrick wall as wet clay dissolves "
            "and muddy water streams down widening cracks at 24fps."
        ),
    },
    {
        "plano": 4,
        "id": "p04",
        "bloco": "Seq 0 · Prólogo In Media Res",
        "enquadramento": "pov_maos",
        "relogio": "FALTAM 90 MIN · ESTALEIRO DO CANAL NORTE",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "forno_madeira",
        "texto": (
            "Você é um calafetador de barcos sumério de vinte e dois anos. "
            "Seus antebraços têm cicatrizes de corda e manchas de kupru — o betume natural fervido que você aplica "
            "para impermeabilizar cestos flutuantes de junco no canal."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a Sumerian boatyard in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar and palm-fiber wrist cord visible in the lower frame, "
            "stirring bubbling black molten bitumen pitch inside a smoking clay pot over glowing charcoal embers with a wooden paddle, "
            "bundles of giant marsh reeds nearby, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands stir the thick bubbling black bitumen inside the clay pot with a wooden paddle "
            "as grey smoke rises and raindrops sizzle on the hot clay rim at 24fps."
        ),
    },
    # SEQUÊNCIA 1 · O MUNDO PRESTES A RUIR (p05 a p08)
    {
        "plano": 5,
        "id": "p05",
        "bloco": "Seq 1 · O Mundo Prestes a Ruir",
        "enquadramento": "pov_companion",
        "relogio": "FALTAM 60 MIN · IDDIN NO ESTALEIRO",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "passos_cinza",
        "texto": (
            "Ao seu lado está Iddin, seu aprendiz de dezenove anos. "
            "Sob o estrondo dos trovões, ele carrega um pote de barro com betume quente e um rolo de corda trançada "
            "de fibra de tamareira."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level in a Sumerian boatyard in Shuruppak, 2900 BC. "
            "Your right hand with a healed rope-burn scar rests on a bundle of golden marsh reeds in the lower right frame, while Iddin — "
            "a 19-year-old Sumerian apprentice with short dark wavy hair, small scar above right eyebrow, in an ochre-tan coarse linen tunic — "
            "looks straight into the camera lens with anxious eyes, holding a smoking clay pot of black bitumen and coiled palm rope, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Iddin looks directly into the camera lens breathing heavily in the rain while holding "
            "the smoking clay pot of bitumen and coiled rope as wind shakes the reed mats behind him at 24fps."
        ),
    },
    {
        "plano": 6,
        "id": "p06",
        "bloco": "Seq 1 · O Mundo Prestes a Ruir",
        "enquadramento": "detalhe",
        "relogio": "FALTAM 45 MIN · O CINZEL DE BRONZE",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "tap",
        "sfx_cue": "oficina_madeira",
        "texto": (
            "Cravado na viga da bancada está o seu cinzel pesado de bronze fundido — "
            "a única lâmina da oficina capaz de decepar cabos grossos de ancoragem ou fender tábuas de cedro num único golpe."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens inside a Sumerian boatyard in Shuruppak, 2900 BC. "
            "A heavy ancient Sumerian cast-bronze caulking chisel with a bitumen-stained wooden handle driven into a rough cedar workbench beam "
            "beside braided reed ropes, raindrops splashing on the green-patinated bronze blade, warm charcoal glow, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this close-up shot. Heavy raindrops splash against the bronze chisel blade vibrating slightly in the wooden beam "
            "from the distant rumble of floodwaters at 24fps."
        ),
    },
    {
        "plano": 7,
        "id": "p07",
        "bloco": "Seq 1 · O Mundo Prestes a Ruir",
        "enquadramento": "pov_maos",
        "relogio": "FALTAM 20 MIN · O DIQUE DE ARGILA LIQUEFAZ",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Suas mãos arrancam o cinzel de bronze da bancada, prendem no cinto de couro e encostam na parede do dique do canal: "
            "a terra compactada está estufando e escorrendo como mingau sob a pressão monstruosa do Eufrates."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level by the earthen levee wall in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar visible in the lower frame: left hand touches the bulging wet clay levee "
            "oozing muddy water jets while right hand holds the cast-bronze chisel, torrential rain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Left hand presses against the wet earthen levee as jets of muddy water burst through "
            "the softening clay while right hand grips the bronze chisel at 24fps."
        ),
    },
    {
        "plano": 8,
        "id": "p08",
        "bloco": "Seq 1 · O Mundo Prestes a Ruir",
        "enquadramento": "ambiente",
        "relogio": "HORA ZERO · O ROMPIMENTO DO DIQUE NORTE",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "impacto_grave",
        "texto": (
            "De repente, um rugido grave rasga a tempestade: trinta metros do dique norte cedem de uma vez, "
            "e uma parede de água barrenta e espuma invade as ruas baixas de Shuruppak em direção à sua oficina."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of the northern earthen levee of Shuruppak, Mesopotamia, 2900 BC. "
            "A massive thirty-meter section of the mud levee collapses outward as a two-meter wall of churning brown floodwater and white foam "
            "bursts into the narrow mudbrick streets toward the reed boatyard, lightning in the dark sky, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic wide shot. The earthen levee crumbles and a roaring wall of brown floodwater surges forward "
            "through the narrow Sumerian street carrying reed mats and timber at 24fps."
        ),
    },
    # SEQUÊNCIA 2 · A PRIMEIRA ARMADILHA (p09 a p12)
    {
        "plano": 9,
        "id": "p09",
        "bloco": "Seq 2 · A Primeira Armadilha",
        "enquadramento": "pov_olho",
        "relogio": "HORA 1 · O ERRO FATAL DOS TELHADOS DE BARRO",
        "hud": {"vida": 96, "comida": 95, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "Na rua ao lado, centenas de vizinhos correm para dentro das casas ou sobem nos telhados planos — "
            "sem saber que o tijolo cru seco ao sol perde toda a coesão na água e vai desabar em menos de quarenta minutos."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking down a flooding street in Shuruppak, 2900 BC. "
            "Panicked Sumerian citizens in wool tunics climb wooden ladders onto flat mudbrick rooftops and bolt wooden doors while brown floodwater "
            "swirls knee-deep around the dissolving mudbrick foundations, torrential rain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Panicked citizens scramble up ladders onto flat mudbrick roofs as brown floodwater "
            "rises rapidly around the crumbling lower walls at 24fps."
        ),
    },
    {
        "plano": 10,
        "id": "p10",
        "bloco": "Seq 2 · A Primeira Armadilha",
        "enquadramento": "pov_maos",
        "relogio": "HORA 1 · AMARRAÇÃO DO CASCO KUPHAR",
        "hud": {"vida": 96, "comida": 95, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "tap",
        "sfx_cue": "oficina_madeira",
        "texto": (
            "Você recusa o abrigo de barro e corre para o pátio alto do estaleiro. "
            "Suas mãos amarram feixes grossos de junco seco em torno do esqueleto curvo de um kuphar — "
            "um cesto flutuante redondo que gira com os redemoinhos sem nunca emborcar."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens in the raised courtyard of a Sumerian boatyard in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar and palm-fiber wrist cord pull a braided rope tight "
            "around thick bundles of golden marsh reeds lashed to curved wooden ribs of a circular Sumerian kuphar coracle boat, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands pull the braided palm-fiber rope tight around the thick bundles of marsh reeds "
            "on the curved boat frame as rain pours down at 24fps."
        ),
    },
    {
        "plano": 11,
        "id": "p11",
        "bloco": "Seq 2 · A Primeira Armadilha",
        "enquadramento": "pov_maos",
        "relogio": "HORA 2 · VEDAÇÃO COM BETUME E ARGILA",
        "hud": {"vida": 94, "comida": 90, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": 58},
        "hud_evento": "none",
        "sfx_cue": "fogo_tocha",
        "texto": (
            "Com uma espátula de madeira, você mistura cinza e pó de argila ao betume fervendo e espalha sobre as costuras externas: "
            "sem esse tempero mineral dos calafetadores sumérios, o piche puro racharia como vidro na água fria."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens in a Sumerian boatyard in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar use a flat wooden spatula to spread steaming black molten bitumen pitch "
            "across the woven reed seams of a boat hull, grey steam rising in the rain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands press the wooden spatula across the woven reed hull, coating the seams "
            "with steaming black bitumen pitch as water rises over the courtyard floor at 24fps."
        ),
    },
    {
        "plano": 12,
        "id": "p12",
        "bloco": "Seq 2 · A Primeira Armadilha",
        "enquadramento": "pov_companion",
        "relogio": "HORA 2 · ONDA DERRUBA O MURO DO PÁTIO",
        "hud": {"vida": 92, "comida": 88, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Mas a segunda vaga da enchente arromba o muro do estaleiro antes da hora, "
            "arranca o remo longo das mãos de Iddin e prensa o seu casco contra a parede do celeiro real que começa a rachar."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens in a flooding Sumerian courtyard in Shuruppak, 2900 BC. "
            "A brown floodwave smashes through the mudbrick courtyard wall, sweeping a long wooden steering oar out of Iddin's wet hands "
            "as he grabs the bitumen-coated gunwale looking into the camera lens in alarm while the hull slams against a cracking granary wall, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Brown floodwater surges across the courtyard, tearing the wooden oar away as Iddin "
            "clutches the boat rim and the hull bumps against the cracking mudbrick wall at 24fps."
        ),
    },
    # SEQUÊNCIA 3 · ESCALADA E IMPROVISO (p13 a p17)
    {
        "plano": 13,
        "id": "p13",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "ambiente",
        "relogio": "HORA 4 · O COLAPSO DAS CASAS DE BARRO",
        "hud": {"vida": 90, "comida": 85, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "impacto_grave",
        "texto": (
            "Ao redor do estaleiro, a armadilha se fecha: as bases das casas de tijolo cru se liquefazem na correnteza "
            "e quarteirões inteiros desmoronam na água barrenta em poucos segundos."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of flooded Shuruppak, Mesopotamia, 2900 BC. "
            "Two-story sun-dried mudbrick houses along the canal liquefy at their bases and collapse inward into the chest-deep raging brown floodwater, "
            "sending up splashes of mud and floating roof timbers under dark storm clouds, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this cinematic wide shot. The waterlogged mudbrick walls buckle and collapse into the churning brown floodwater "
            "raising huge splashes of mud and floating beams at 24fps."
        ),
    },
    {
        "plano": 14,
        "id": "p14",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_olho",
        "relogio": "HORA 5 · O ERRO DO EXCESSO DE CARGA",
        "hud": {"vida": 90, "comida": 85, "dinheiro_epoca": "10 Siclos", "dinheiro_brl": 60, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "ondas_mar",
        "texto": (
            "No canal principal, mercadores tentam salvar baús de pedra, lingotes de cobre e fardos de lã em canoas estreitas de madeira — "
            "mas o centro de gravidade alto vira cada canoa no primeiro redemoinho."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking across the raging canal in Shuruppak, 2900 BC. "
            "A narrow wooden Sumerian river skiff overloaded with heavy stone chests, copper ingots and wet wool sacks tips violently sideways "
            "and capsizes in a muddy whirlpool while rain lashes the water, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. The overloaded wooden river skiff rolls sideways in the turbulent muddy current "
            "and sinks as heavy chests slide into the water at 24fps."
        ),
    },
    {
        "plano": 15,
        "id": "p15",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_maos",
        "relogio": "HORA 5 · FLUTUADORES DE JARROS DE BARRO",
        "hud": {"vida": 88, "comida": 82, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 52},
        "hud_evento": "tap",
        "sfx_cue": "moedas",
        "texto": (
            "Você descarta todo peso morto e amarra seis jarros grandes de barro por dentro da borda — "
            "dois cheios de cevada torrada e quatro vazios lacrados com betume, criando bolsões de ar que impedem o barco de afundar."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside the Sumerian reed boat in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar lash large terracotta storage jars sealed with black bitumen lids "
            "along the inner reed ribs of the hull as buoyancy pontoons, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands tighten the reed rope securing the bitumen-sealed clay jars against "
            "the inner wall of the rocking reed hull at 24fps."
        ),
    },
    {
        "plano": 16,
        "id": "p16",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_acao",
        "relogio": "HORA 6 · CORTE DA AMARRA PRESA AO CELEIRO",
        "hud": {"vida": 86, "comida": 80, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Acima de você, o muro do celeiro real se inclina para cair sobre o barco. "
            "Suas mãos sacam o cinzel de bronze e golpeiam a corda de amarração esticada contra o cepo até partir os fios."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action shot on 24mm lens at the bow of the reed boat in Shuruppak, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar strike a taut thick mooring rope with the cast-bronze caulking chisel "
            "as mudbricks and dust rain down from the collapsing granary wall overhead, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV action shot. Right hand drives the bronze chisel into the taut rope, snapping the fibers "
            "as mudbricks splash into the water beside the hull at 24fps."
        ),
    },
    {
        "plano": 17,
        "id": "p17",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_baixo",
        "relogio": "HORA 7 · IMPACTO NO TRONCO DE TAMAREIRA",
        "hud": {"vida": 80, "comida": 75, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "impacto_grave",
        "texto": (
            "Portanto, a correnteza arranca o seu barco para longe do desabamento — "
            "mas a onda do impacto joga a lateral do casco contra o tronco quebrado de uma tamareira, rasgando o junco abaixo da linha d'água."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot looking down on 24mm lens inside the Sumerian reed boat in raging floodwater, 2900 BC. "
            "A jagged uprooted date-palm trunk slams against the starboard reed wall; muddy water begins spurting inward through a torn seam "
            "in the bitumen-coated reeds around your bare feet and sandals, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV downward shot. Muddy floodwater spurts rapidly through the torn reed seam in the lower hull "
            "swirling around your wet feet at 24fps."
        ),
    },
    # SEQUÊNCIA 4 · A GRANDE VIRADA (p18 a p22)
    {
        "plano": 18,
        "id": "p18",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "pov_companion",
        "relogio": "NOITE DO DIA 2 · ÁGUA SUBINDO NO PORÃO",
        "hud": {"vida": 76, "comida": 70, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "vento_cinza",
        "texto": (
            "Cai a noite do segundo dia e o nível da água sobe um palmo por minuto dentro do cesto. "
            "Iddin arremessa baldes de couro cheios de lama para fora enquanto o vento sul do Golfo sopra como um furacão."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside the reed boat at night during the Mesopotamian flood, 2900 BC, "
            "lit by a sheltered clay oil lamp. Iddin kneels in ankle-deep bilge water wearing his soaked ochre-tan linen tunic, "
            "frantically bailing muddy water over the side with a leather bucket while looking into the camera lens, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV night shot. Iddin scoops muddy water with the leather bucket and hurls it over the reed gunwale "
            "under flickering orange lamp light and lightning flashes at 24fps."
        ),
    },
    {
        "plano": 19,
        "id": "p19",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "pov_maos",
        "relogio": "NOITE DO DIA 2 · CALAFETAGEM SUBMERSA",
        "hud": {"vida": 74, "comida": 65, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "tap",
        "sfx_cue": "oficina_madeira",
        "texto": (
            "Suas mãos mergulham na água barrenta, socam fibra de junco mastigada dentro do rasgo com o cabo do cinzel "
            "e selam por cima com pasta de betume misturada com óleo de gergelim — que gruda mesmo debaixo d'água."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV close-up shot on 24mm lens inside the dark reed hull at night, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar press thick black bitumen-and-oil paste "
            "and shredded reed fiber into the leaking hull seam under shallow water, stopping the inflow, warm oil lamp glow, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands forcefully pack the black bitumen paste into the leaking reed seam "
            "until the jet of muddy water stops under flickering lamp light at 24fps."
        ),
    },
    {
        "plano": 20,
        "id": "p20",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "detalhe",
        "relogio": "MADRUGADA DO DIA 3 · O TRITURADOR DO CANAL CENTRAL",
        "hud": {"vida": 72, "comida": 60, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "A cem metros a bombordo, o canal central do Eufrates virou um triturador: "
            "quem tentou flutuar agarrado a vigas soltas é esmagado pelo choque de árvores inteiras descendo na correnteza."
        ),
        "prompt_imagem": (
            "Cinematic close-up shot on 24mm lens across the dark raging floodwaters at night, 2900 BC, illuminated by lightning. "
            "Massive uprooted cedar trunks and heavy wooden temple beams collide violently in the white-water main channel, "
            "splintering floating wooden planks in the churning brown current, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic night shot. Giant uprooted tree trunks crash together in the foaming brown current "
            "under flashes of lightning and heavy rain at 24fps."
        ),
    },
    {
        "plano": 21,
        "id": "p21",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "pov_acao",
        "relogio": "MADRUGADA DO DIA 3 · A ÂNCORA DE ARRASTO SUMÉRIA",
        "hud": {"vida": 70, "comida": 58, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Sem remo de leme para sair do canal central, você usa a física dos barqueiros do Eufrates: "
            "amarra uma pedra furada de calcário numa corda longa e a lança pela popa para arrastar no fundo raso e guiar o barco para um palmeiral submerso."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action shot on 24mm lens over the stern of the Sumerian reed boat at night, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar heave a flat pierced limestone weight anchor "
            "tied to a thick braided palm-fiber rope into the churning floodwater toward submerged date-palm crowns, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV action shot. Both hands hurl the pierced limestone weight anchor into the dark water; "
            "the braided rope pays out tautly over the reed stern, steadying the boat at 24fps."
        ),
    },
    {
        "plano": 22,
        "id": "p22",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "reflexo",
        "relogio": "DIA 3 · PALMEIRAL SUBMERSO · EXAUSTÃO",
        "hud": {"vida": 66, "comida": 52, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 41},
        "hud_evento": "tap",
        "sfx_cue": "fogo_tocha",
        "texto": (
            "Protegido entre as copas das tamareiras que quebram a força das ondas, você olha para a água escura no fundo do casco. "
            "No reflexo trêmulo sob a lamparina de gergelim, seu rosto está negro de piche e seus olhos ardem de fumaça e frio."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV looking down into a pool of dark rainwater at the bottom of the Sumerian reed boat at night, 2900 BC, "
            "lit by a clay sesame-oil lamp inside a terracotta hood. Both bitumen-stained hands with a healed rope-burn scar rest on the reed ribs in the lower frame; "
            "reflected in the trembling dark water is the exhausted face of a 22-year-old Sumerian man with wet dark wavy hair and mud-streaked skin, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV reflection shot. Raindrops ripple across the dark bilge water, distorting the mud-and-bitumen stained "
            "reflection of your face under flickering orange oil-lamp light at 24fps."
        ),
    },
    # SEQUÊNCIA 5 · O PREÇO HUMANO (p23 a p27)
    {
        "plano": 23,
        "id": "p23",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "ambiente",
        "relogio": "DIA 4 DO DILÚVIO · O MAR INTERIOR SEM MARGENS",
        "hud": {"vida": 64, "comida": 46, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Amanhece o quarto dia e a planície inteira da Suméria deixou de existir. "
            "Sob um céu cinza-chumbo, trezentos quilômetros de terras férteis e cidades viraram um oceano silencioso de água barrenta."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of the flooded Mesopotamian plain on the fourth day of the deluge, 2900 BC. "
            "An endless expanse of turbid brown water stretches to the horizon under leaden grey storm clouds, with only the highest crowns "
            "of submerged date palms jutting above the waves and a single small circular reed boat drifting among them, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this cinematic wide shot. Long grey-brown swells roll across the endless flooded plain around the tops of submerged palm trees "
            "under heavy rain at 24fps."
        ),
    },
    {
        "plano": 24,
        "id": "p24",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_companion",
        "relogio": "DIA 4 · VIGA FLUTUANTE ATINGE IDDIN",
        "hud": {"vida": 60, "comida": 44, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Uma marola traiçoeira lança um caibro pesado de cedro contra a borda do cesto. "
            "O impacto quebra a trava interna de madeira sobre o tornozelo de Iddin, que cai no fundo do barco estendendo a mão para você."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking down inside the Sumerian reed boat, 2900 BC. "
            "Iddin lies fallen against the curved reed ribs clutching his injured ankle with one hand and reaching his other mud-stained hand "
            "upward toward the camera lens in pain, while your right hand with the healed rope-burn scar reaches down in the lower frame, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Iddin reaches his trembling mud-stained hand toward the camera lens while your right hand "
            "grasps his wrist inside the rocking reed boat at 24fps."
        ),
    },
    {
        "plano": 25,
        "id": "p25",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_maos",
        "relogio": "DIA 5 · A ARMADILHA DA ÁGUA CONTAMINADA",
        "hud": {"vida": 58, "comida": 40, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "Nos telhados flutuantes ao longe, sobreviventes torturados pela sede bebem direto a água barrenta do rio — "
            "contaminada por lama tóxica e carcaças — condenando o próprio corpo à febre e à desidratação fatal em poucas horas."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking over the bitumen-coated reed gunwale of the boat, 2900 BC. "
            "Both weathered olive-bronze hands with a healed rope-burn scar hold the dark pitched rim in the lower frame; outside, turbid brown floodwater "
            "swirls with muddy foam, branches and debris under grey rain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands grip the wet black gunwale as contaminated muddy foam and debris drift past "
            "the boat in the rain at 24fps."
        ),
    },
    {
        "plano": 26,
        "id": "p26",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_maos",
        "relogio": "DIA 5 · TALA DE JUNCO E CAPTAÇÃO DE CHUVA PURA",
        "hud": {"vida": 56, "comida": 36, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 33},
        "hud_evento": "tap",
        "sfx_cue": "pedras_telhado",
        "texto": (
            "Suas mãos imobilizam o tornozelo de Iddin com hastes rígidas de junco e esticam uma lona de couro limpa entre quatro varas: "
            "a água da chuva escorre pura pelo centro do couro direto para uma tigela de barro, salvando vocês da sede."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside the Sumerian reed boat, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar position a clean clay bowl beneath a taut animal-hide canopy "
            "where crystal-clear rainwater funnels in a steady stream into the bowl, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands hold the clay bowl steady as clean rainwater pours in a clear stream "
            "from the center of the taut leather canopy at 24fps."
        ),
    },
    {
        "plano": 27,
        "id": "p27",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_acao",
        "relogio": "DIA 6 · RACIONAMENTO DE CEVADA E VENTO NORTE",
        "hud": {"vida": 52, "comida": 25, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "vento_cinza",
        "texto": (
            "Vocês dividem o último punhado de cevada torrada do jarro lacrado para vencer a hipotermia, "
            "mas no sexto dia a correnteza acelera de repente e um rugido ensurdecedor de água caindo ecoa na neblina à frente."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside the reed boat in thick storm mist, 2900 BC. "
            "Your left hand with the palm-fiber wrist cord holds roasted barley grains near a clay jar while your right hand with the healed rope-burn scar "
            "grips the bow rim looking ahead into white spray and churning rapids, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. The reed boat accelerates forward into swirling grey mist as white water spray "
            "splashes over the bow at 24fps."
        ),
    },
    # SEQUÊNCIA 6 · NO LIMITE FÍSICO (p28 a p32)
    {
        "plano": 28,
        "id": "p28",
        "bloco": "Seq 6 · No Limite Físico",
        "enquadramento": "ambiente",
        "relogio": "DIA 6 · A BARRAGEM DE PEDRA SUBMERSA",
        "hud": {"vida": 46, "comida": 20, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Diante da proa surge uma antiga barragem suméria de blocos de calcário submersa pela cheia: "
            "a água despenca sobre a muralha de pedra formando um redemoinho hidráulico que puxa tudo para o fundo."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of a submerged ancient stone irrigation weir in the flooded Mesopotamian plain, 2900 BC. "
            "Raging brown floodwaters pour violently over jagged limestone blocks, creating a boiling white-water hydraulic drop "
            "as the circular reed boat is swept toward the brink, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic wide shot. Raging brown water cascades over the submerged limestone blocks in boiling white foam "
            "as the reed boat approaches the drop at 24fps."
        ),
    },
    {
        "plano": 29,
        "id": "p29",
        "bloco": "Seq 6 · No Limite Físico",
        "enquadramento": "pov_maos",
        "relogio": "DIA 6 · A ÂNCORA ENGANCHA NAS ROCHAS",
        "hud": {"vida": 38, "comida": 18, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "No instante em que o casco passa sobre a crista, a pedra de âncora que arrastava atrás engancha entre dois blocos submersos! "
            "A corda estica com violência e a correnteza começa a afundar a popa do barco."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens at the stern of the Sumerian reed boat in boiling white water, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar grab the violently vibrating palm-fiber anchor rope "
            "as the stern is pulled downward and foaming brown water pours over the rim, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. The taut anchor rope vibrates violently under extreme tension, pulling the reed stern downward "
            "as foaming water rushes over the edge at 24fps."
        ),
    },
    {
        "plano": 30,
        "id": "p30",
        "bloco": "Seq 6 · No Limite Físico",
        "enquadramento": "pov_acao",
        "relogio": "DIA 6 · O GOLPE FINAL COM O CINZEL DE BRONZE",
        "hud": {"vida": 28, "comida": 15, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Com a água já na cintura, suas mãos congeladas arrancam o cinzel de bronze do cinto — "
            "aquele mesmo que você salvou da bancada no primeiro dia — e cravam a lâmina na corda esticada até arrebentar o cabo."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action close-up shot on 24mm lens at the submerged stern of the reed boat, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar drive the heavy cast-bronze caulking chisel "
            "through the taut palm-fiber rope on the wooden gunwale block, severing the strands in a burst of spray, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV action shot. Both hands slam the bronze chisel through the taut rope, snapping it cleanly "
            "as the stern springs upward out of the foaming water at 24fps."
        ),
    },
    {
        "plano": 31,
        "id": "p31",
        "bloco": "Seq 6 · No Limite Físico",
        "enquadramento": "pov_companion",
        "relogio": "NOITE DO DIA 6 · O ENCALHE E O SILÊNCIO",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "none",
        "sfx_cue": "riser_silencio",
        "silencio_dramatico_s": [428.50, 430.00],
        "texto": (
            "O cesto salta livre da espuma, desliza pela água rasa e bate com um tranco seco contra o cascalho firme de uma colina. "
            "Iddin segura seu braço, e de repente o vento da tempestade cessa por completo."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside the reed boat grounded on rocky limestone gravel at twilight, 2900 BC. "
            "Your mud-and-bitumen stained left hand holds Iddin's shoulder in the lower frame while Iddin looks into the camera lens in stunned silence "
            "as the torrential rain suddenly stops, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic first-person POV shot. The boat shudders to a halt on wet limestone gravel as Iddin grips your arm "
            "and the storm wind falls completely still at 24fps."
        ),
    },
    {
        "plano": 32,
        "id": "p32",
        "bloco": "Seq 6 · No Limite Físico",
        "enquadramento": "pov_olho",
        "relogio": "ALVORADA DO DIA 7 · CONTRAFORTE DO MONTE NISIR",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "impacto",
        "sfx_cue": "impacto_grave",
        "texto": (
            "Quando o sol do sétimo dia rasga a neblina no horizonte leste, você vê onde o casco encalhou: "
            "nos contrafortes rochosos ao norte da planície, únicos pontos secos acima de um mar de lama silencioso."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking out from the rocky limestone ridge of Mount Nisir at dawn, 2900 BC. "
            "Golden morning sunlight breaks through parting storm clouds over a vast mist-covered inland sea that submerges the entire Mesopotamian plain below, "
            "ancient rocky terrain in foreground (NO modern roads or structures), 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV dawn shot. Golden sunlight rays sweep across the vast mist-covered flooded plain below the rocky ridge "
            "as thin white fog drifts gently at 24fps."
        ),
    },
    # SEQUÊNCIA 7 · O ECO NA HISTÓRIA (p33 a p36)
    {
        "plano": 33,
        "id": "p33",
        "bloco": "Seq 7 · O Eco na História",
        "enquadramento": "detalhe",
        "relogio": "DIA 7 ·06h30 · A BÚSSOLA DOS NAVEGADORES SUMÉRIOS",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "tap",
        "sfx_cue": "passos_cinza",
        "texto": (
            "No fundo do casco, dentro de uma gaiola de vime protegida sob o couro, resta uma pomba viva — "
            "o instrumento real que os barqueiros da Mesopotâmia soltavam para descobrir em que direção a água estava baixando."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens inside the grounded Sumerian reed boat at dawn, 2900 BC. "
            "A small woven wicker bird cage resting beside the bronze caulking chisel on the bitumen-coated reed floor, "
            "a live grey Mesopotamian dove inside ruffling its feathers in the warm morning light, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this close-up shot. The grey dove inside the woven wicker cage moves its head and rustles its feathers "
            "as golden morning light illuminates the bitumen floor at 24fps."
        ),
    },
    {
        "plano": 34,
        "id": "p34",
        "bloco": "Seq 7 · O Eco na História",
        "enquadramento": "pov_companion",
        "relogio": "DIA 7 · 07h00 · LAMA FRESCA NAS GARRAS",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "none",
        "sfx_cue": "vento_cinza",
        "texto": (
            "Iddin se apoia no seu ombro com a perna imobilizada na tala de junco e sorri exausto quando a ave retorna "
            "e pousa na borda do barco com as garras sujas de argila fresca: a terra firme está voltando a emergir."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens on the rocky hillside at dawn, 2900 BC. "
            "Iddin in his mud-stained ochre-tan linen tunic with a reed splint on his lower leg leans on your shoulder, looking into the camera lens "
            "with a relieved smile as a grey dove perches on the bitumen boat rim with wet mud on its claws, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Iddin breathes a deep sigh of relief looking into the camera lens while the grey dove "
            "perches on the boat rim in the golden morning breeze at 24fps."
        ),
    },
    {
        "plano": 35,
        "id": "p35",
        "bloco": "Seq 7 · O Eco na História",
        "enquadramento": "pov_maos",
        "relogio": "DIA 7 · 07h30 · O QUE RESTOU NAS SUAS MÃOS",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "tap",
        "sfx_cue": "moedas",
        "texto": (
            "Você olha para as próprias mãos marcadas de betume negro e corda: "
            "restaram seis anéis de prata e o seu cinzel de bronze, mas a engenharia de junco e piche venceu a maior cheia da antiguidade."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens on the rocky hillside above the flooded plain at dawn, 2900 BC. "
            "Both weathered olive-bronze hands and bare forearms with a healed rope-burn scar and palm-fiber wrist cord open in the lower frame, "
            "holding six ancient silver rings and the cast-bronze chisel above the flooded valley, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both bitumen-stained hands slowly close around the six silver rings and bronze chisel "
            "as golden morning wind blows across the rocky ridge at 24fps."
        ),
    },
    {
        "plano": 36,
        "id": "p36",
        "bloco": "Seq 7 · O Eco na História",
        "enquadramento": "ambiente",
        "relogio": "REGISTRO ARQUEOLÓGICO · CAMADA DE SILTE DE 2900 A.C.",
        "hud": {"vida": 24, "comida": 12, "dinheiro_epoca": "6 Siclos", "dinheiro_brl": 36, "chance": 18},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Em mil novecentos e vinte e nove, escavações arqueológicas em Ur e Shuruppak revelaram uma camada maciça de três metros "
            "de lama pura de inundação datada de dois mil e novecentos antes de Cristo — o cataclismo real que inspirou a Epopeia de Gilgamesh "
            "e o relato histórico do Grande Dilúvio."
        ),
        "prompt_imagem": (
            "Cinematic wide aerial-perspective shot on 24mm lens from the rocky foothills of Mount Nisir at sunrise, 2900 BC. "
            "The grounded circular Sumerian reed-and-bitumen boat rests on the limestone shore in the foreground while the vast flooded Mesopotamian plain "
            "reflects the golden morning sun in the distance (NO modern roads or structures), 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this final cinematic wide shot. Camera slowly pushes forward past the grounded Sumerian reed boat toward the vast golden "
            "water-covered Mesopotamian plain at sunrise at 24fps."
        ),
    },
]


def _locacao_id_por_plano(num_plano: int) -> str:
    if num_plano in (2, 3, 4, 5, 6, 7, 10, 11, 12):
        return "L01_ESTALEIRO_SHURUPPAK"
    if num_plano in (8, 9, 13):
        return "L02_RUAS_TIJOLO_CRU"
    if num_plano in (14, 15, 16, 17):
        return "L03_CANAL_ROMPIDO_GRANEL"
    if num_plano in (1, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27):
        return "L04_MAR_INTERIOR_PALMEIRAS"
    return "L05_BARRAGEM_PEDRA_MONTE_NISIR"


PLANOS_36_POV: List[Dict[str, Any]] = []
for _idx, _raw in enumerate(RAW_36_PLANOS_DILUVIO):
    _item = dict(_raw)
    _pnum = int(_item["plano"])
    _item["locacao_id"] = _locacao_id_por_plano(_pnum)
    _item["companheiro_em_cena"] = _item["id"] in ("p05", "p12", "p18", "p24", "p31", "p34")
    _w0 = round(_idx * DURACAO_BLOCO_S, 2)
    _w1 = round((_idx + 1) * DURACAO_BLOCO_S, 2)
    _item["duracao_s"] = DURACAO_BLOCO_S
    _item["janela_s"] = [_w0, _w1]
    PLANOS_36_POV.append(_item)

injetar_dna_consistencia_pov(PLANOS_36_POV, EPISODIO_META)


def validar_decupagem_36_planos_pov() -> None:
    validar_paridade_1_para_1_blocos_planos(PLANOS_36_POV, PLANOS_36_POV, episodio_id=EPISODIO_ID)
    validar_ausencia_quiz_escolha_ab(PLANOS_36_POV)
    erros_dna = validar_consistencia_dna_personagens_e_ambientes(PLANOS_36_POV, EPISODIO_META)
    if erros_dna:
        raise RuntimeError(f"Violação de consistência de DNA POV: {erros_dna}")
    reflexos = [p["id"] for p in PLANOS_36_POV if p.get("enquadramento") == "reflexo"]
    escolhas = [p["id"] for p in PLANOS_36_POV if p.get("enquadramento") == "escolha_ab"]
    if len(reflexos) != 1 or len(escolhas) != 0:
        raise RuntimeError(f"Violação de contrato POV v4.0 Hollywood: reflexos={reflexos}, escolhas={escolhas}")
    logger.info(
        f"[CONTRATO POV v4.0 HOLLYWOOD + DNA APROVADO] 36 planos do Dilúvio validados (0 erros, 1 único reflexo={reflexos[0]}, 0 quiz A/B)."
    )


# =============================================================================
# 2. SÍNTESE VOCAL FENRIR (36 BLOCOS) + MIXAGEM DIEGÉTICA REAL (-14.0 LUFS)
# =============================================================================
def _limpar_cauda_ruido_gemini(wav_path: Path) -> None:
    """Remove os 0.30s finais do WAV onde o stream PCM do Gemini TTS injeta ruído se houver gap final."""
    with wave.open(str(wav_path), "rb") as wf:
        ch = wf.getnchannels()
        sr = wf.getframerate()
        sw = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        val = (
            b[:, 0].astype(np.int32)
            | (b[:, 1].astype(np.int32) << 8)
            | (b[:, 2].astype(np.int8).astype(np.int32) << 16)
        ) / 8388608.0
    else:
        val = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    stereo = val.reshape(-1, ch)
    if len(stereo) > int(1.2 * sr):
        tail_check = stereo[-int(0.18 * sr) :]
        pre_silence = stereo[-int(0.36 * sr) : -int(0.18 * sr)]
        if np.sqrt(np.mean(tail_check**2)) > 0.12 and np.sqrt(np.mean(pre_silence**2)) < 0.01:
            cut_samples = int(0.32 * sr)
            stereo = stereo[:-cut_samples].copy()
            fo = min(len(stereo), int(0.025 * sr))
            if fo > 0:
                stereo[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)[:, None]
            tmp16 = wav_path.parent / f"_clean_{wav_path.name}"
            with wave.open(str(tmp16), "wb") as wf:
                wf.setnchannels(ch)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                pcm16 = np.clip(stereo * 32767.0, -32767, 32767).astype(np.int16)
                wf.writeframes(pcm16.tobytes())
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", str(tmp16), "-ar", str(sr), "-ac", str(ch), "-c:a", "pcm_s24le", str(wav_path)],
                check=True,
            )
            tmp16.unlink(missing_ok=True)


def sintetizar_bloco_fenrir_resiliente(blocos_voz_dir: Path, plano_item: Dict[str, Any]) -> Path:
    blocos_voz_dir.mkdir(parents=True, exist_ok=True)
    p_num = int(plano_item["plano"])
    pid = plano_item["id"]
    wav_path = blocos_voz_dir / f"{p_num:02d}_{pid}.wav"
    if wav_path.is_file() and wav_path.stat().st_size > 20_000:
        _limpar_cauda_ruido_gemini(wav_path)
        return wav_path

    texto = plano_item["texto"].strip()
    modelos_tts = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts", "gemini-3.8-flash-lite-tts"]
    for tentativa in range(2):
        for mod_tts in modelos_tts:
            try:
                sintetizar_voz_gemini_com_fallback(
                    texto=texto,
                    output_path=wav_path,
                    voice_name="Fenrir",
                    model_name=mod_tts,
                    sample_rate=SR,
                )
                if wav_path.is_file() and wav_path.stat().st_size > 15_000:
                    _limpar_cauda_ruido_gemini(wav_path)
                    logger.info(f"  + [TTS GEMINI FENRIR ({mod_tts})] Plano {p_num:02d}/36 sintetizado.")
                    time.sleep(1.0)
                    return wav_path
            except Exception as exc:
                logger.warning(f"  ! Aviso TTS ({mod_tts}, p{p_num:02d}, tent {tentativa + 1}): {exc}")
                time.sleep(1.5)

    import edge_tts

    mp3_tmp = blocos_voz_dir / f"_edge_{p_num:02d}.mp3"

    async def _run_edge() -> None:
        comm = edge_tts.Communicate(texto, voice="pt-BR-AntonioNeural", rate="+2%", pitch="-8Hz")
        await comm.save(str(mp3_tmp))

    asyncio.run(_run_edge())
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(mp3_tmp), "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", str(wav_path)],
        check=True,
    )
    mp3_tmp.unlink(missing_ok=True)
    logger.info(f"  + [TTS FALLBACK BARÍTONO] Plano {p_num:02d}/36 sintetizado.")
    return wav_path


def _ler_wav_stereo_f32(
    wav_path: Path,
    start_s: float = 0.0,
    max_dur_s: float | None = None,
    af_extra: str = "",
) -> np.ndarray:
    tmp_16 = wav_path.parent / f"_tmp16_{wav_path.stem}_{int(start_s * 100)}_{os.getpid()}.wav"
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start_s > 0.0:
        cmd += ["-ss", f"{start_s:.3f}"]
    cmd += ["-i", str(wav_path)]
    if max_dur_s is not None:
        cmd += ["-t", f"{max_dur_s:.3f}"]
    if af_extra:
        cmd += ["-af", af_extra]
    cmd += ["-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(tmp_16)]
    subprocess.run(cmd, check=True)
    with wave.open(str(tmp_16), "rb") as wf:
        raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    tmp_16.unlink(missing_ok=True)
    if len(raw) == 0:
        return np.zeros((0, 2), dtype=np.float32)
    return raw.reshape(-1, 2)


def _carregar_wav_stereo_loop(wav_path: Path, dur_samples: int, af_extra: str = "") -> np.ndarray:
    tmp_s = wav_path.parent / f"_tmp_loop_{wav_path.stem}_{dur_samples}_{os.getpid()}.wav"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-stream_loop", "-1",
        "-i", str(wav_path),
        "-t", f"{dur_samples / float(SR):.3f}",
    ]
    if af_extra:
        cmd += ["-af", af_extra]
    cmd += ["-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(tmp_s)]
    subprocess.run(cmd, check=True)
    with wave.open(str(tmp_s), "rb") as wf:
        raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    tmp_s.unlink(missing_ok=True)
    arr = raw.reshape(-1, 2)
    if len(arr) < dur_samples:
        pad = np.zeros((dur_samples - len(arr), 2), dtype=np.float32)
        arr = np.vstack((arr, pad))
    return arr[:dur_samples]


def _adicionar_no_barramento(
    bus: np.ndarray,
    seg: np.ndarray,
    start_s: float,
    fade_in_s: float = 0.04,
    fade_out_s: float = 0.18,
    pan: float = 0.0,
    gain_db: float = 0.0,
) -> None:
    if len(seg) == 0:
        return
    out = seg.copy()
    n = len(out)
    fi = min(n, int(fade_in_s * SR))
    fo = min(n, int(fade_out_s * SR))
    if fi > 0:
        out[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)[:, None]
    if fo > 0:
        out[n - fo :] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)[:, None]
    theta = (pan + 1.0) * (math.pi / 4.0)
    g_l = float(math.cos(theta) * math.sqrt(2.0) / 2.0)
    g_r = float(math.sin(theta) * math.sqrt(2.0) / 2.0)
    gain_lin = float(10.0 ** (gain_db / 20.0))
    out[:, 0] *= g_l * gain_lin
    out[:, 1] *= g_r * gain_lin

    i0 = max(0, int(start_s * SR))
    i1 = min(len(bus), i0 + len(out))
    if i1 > i0:
        bus[i0:i1] += out[: i1 - i0]


def _calcular_envelope_sidechain_suave(
    voice_stereo: np.ndarray,
    duck_gain: float = 0.30,
    attack_ms: float = 25.0,
    release_ms: float = 400.0,
) -> np.ndarray:
    mono_abs = np.max(np.abs(voice_stereo), axis=1)
    win_rms = int(0.030 * SR)
    kernel = np.ones(win_rms, dtype=np.float32) / float(win_rms)
    env = np.sqrt(np.convolve(mono_abs**2, kernel, mode="same"))
    voice_active = (env > 0.012).astype(np.float32)

    hold_samples = int(0.14 * SR)
    voice_held = np.convolve(voice_active, np.ones(hold_samples, dtype=np.float32), mode="same") > 0.5
    target_gain = np.where(voice_held, duck_gain, 1.0).astype(np.float32)

    alpha_att = float(np.exp(-1.0 / max(1.0, (attack_ms / 1000.0) * SR)))
    alpha_rel = float(np.exp(-1.0 / max(1.0, (release_ms / 1000.0) * SR)))

    smooth_gain = np.ones(len(target_gain), dtype=np.float32)
    g = 1.0
    for i in range(len(target_gain)):
        tg = float(target_gain[i])
        if tg < g:
            g = alpha_att * g + (1.0 - alpha_att) * tg
        else:
            g = alpha_rel * g + (1.0 - alpha_rel) * tg
        smooth_gain[i] = g
    return smooth_gain[:, None]


def _medir_ebur128_lufs(wav_path: Path) -> float:
    res = subprocess.run(
        ["ffmpeg", "-nostats", "-i", str(wav_path), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    matches = re.findall(r"I:\s*(-?\d+\.\d+)\s*LUFS", res.stderr)
    return float(matches[-1]) if matches else -14.0


def _ffprobe_duracao_arquivo(path_media: Path) -> float:
    res = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path_media),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(res.stdout.strip())


def construir_audio_master_diluvio(dirs_ep: Dict[str, Path]) -> Path:
    global DURACAO_TOTAL_S, TOTAL_SAMPLES, SILENCIO_INICIO_S, SILENCIO_FIM_S
    audio_dir = dirs_ep["root"] / "audio"
    blocos_voz_dir = audio_dir / "blocos_fenrir"
    sfx_reais_dir = Path(r"D:\CANAL 9\storage_local\episodios\ep_sobrevida_8m_pompeia_pov\audio\sfx_reais")
    blocos_voz_dir.mkdir(parents=True, exist_ok=True)
    master_wav = audio_dir / "master_sobrevida_8m_diluvio_fenrir.wav"

    amostras_por_plano: Dict[str, np.ndarray] = {}
    duracoes_fala_s: Dict[str, float] = {}

    for p in PLANOS_36_POV:
        p_num = int(p["plano"])
        pid = p["id"]
        wav_bloco = sintetizar_bloco_fenrir_resiliente(blocos_voz_dir, p)

        max_dur = 13.00 if p_num == 31 else 14.50

        tmp_mono = blocos_voz_dir / f"_mono_{pid}.wav"
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(wav_bloco),
                "-af", (
                    "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-38dB:"
                    "stop_periods=-1:stop_duration=0.14:stop_threshold=-38dB,"
                    "highpass=f=75,"
                    "equalizer=f=145:t=q:w=1.1:g=1.8,"
                    "equalizer=f=3100:t=q:w=1.3:g=1.6"
                ),
                "-ar", str(SR),
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(tmp_mono),
            ],
            check=True,
        )
        with wave.open(str(tmp_mono), "rb") as wf:
            samples = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        tmp_mono.unlink(missing_ok=True)

        dur_s = len(samples) / float(SR)
        if dur_s > max_dur:
            ratio = min(1.32, max(1.01, (dur_s / max_dur) * 1.02))
            tmp_in = blocos_voz_dir / f"_in_{pid}.wav"
            tmp_out = blocos_voz_dir / f"_out_{pid}.wav"
            with wave.open(str(tmp_in), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(SR)
                wf.writeframes((np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes())
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error",
                    "-i", str(tmp_in),
                    "-af", f"atempo={ratio:.4f}",
                    "-ar", str(SR),
                    "-ac", "1",
                    "-c:a", "pcm_s16le",
                    str(tmp_out),
                ],
                check=True,
            )
            with wave.open(str(tmp_out), "rb") as wf:
                samples = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
            tmp_in.unlink(missing_ok=True)
            tmp_out.unlink(missing_ok=True)

        n_s = len(samples)
        fi, fo = min(n_s, int(0.020 * SR)), min(n_s, int(0.025 * SR))
        if fi > 0:
            samples[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
        if fo > 0:
            samples[n_s - fo :] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
        rms = float(np.sqrt(np.mean(samples**2)) + 1e-9)
        samples = np.clip(samples * ((10.0 ** (-17.8 / 20.0)) / rms), -0.88, 0.88)

        amostras_por_plano[pid] = samples
        duracoes_fala_s[pid] = round(len(samples) / float(SR), 3)

    # Calcula janelas dinâmicas coladas na fala (respiro de 0.20s entre takes, zero buracos!)
    DURACAO_TOTAL_S = calcular_janelas_dinamicas_sem_pausas(
        PLANOS_36_POV,
        duracoes_fala_s,
        lead_in_s=0.08,
        tail_gap_s=0.12,
    )
    validar_ausencia_pausas_longas_entre_takes(PLANOS_36_POV, duracoes_fala_s)
    TOTAL_SAMPLES = int(round(DURACAO_TOTAL_S * SR))
    p31_w1 = float(PLANOS_36_POV[30]["janela_s"][1])
    SILENCIO_INICIO_S = round(p31_w1 - 1.50, 3)
    SILENCIO_FIM_S = round(p31_w1, 3)

    if master_wav.is_file() and master_wav.stat().st_size > 30_000_000:
        dur_existente = _ffprobe_duracao_arquivo(master_wav)
        if abs(dur_existente - DURACAO_TOTAL_S) <= 0.35:
            logger.info(f"[ÁUDIO MASTER DINÂMICO EXISTENTE] {master_wav} ({dur_existente:.2f}s)")
            return master_wav

    timeline_voz = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    timeline_sfx = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    timeline_bgm = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)

    tap_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_hud_tap_organico.wav", max_dur_s=0.45, af_extra="lowpass=f=3200")
    tick_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_hud_tick_mecanico.wav", max_dur_s=0.35, af_extra="lowpass=f=3600")
    thud_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_thud_grave.wav", max_dur_s=0.90, af_extra="lowpass=f=450")
    sfx_impacto = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_impact_cinematico.wav", max_dur_s=3.5, af_extra="lowpass=f=1400")
    sfx_moedas = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p01_moedas_madeira.wav", start_s=0.05, max_dur_s=3.2, af_extra="highpass=f=180,lowpass=f=7500")
    sfx_forno = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p07_fogo_tocha_vela.wav", start_s=0.3, max_dur_s=8.0, af_extra="highpass=f=140,lowpass=f=5000")
    sfx_oficina = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p03_oficina_madeira.wav", start_s=0.2, max_dur_s=6.0, af_extra="highpass=f=120,lowpass=f=1800")
    sfx_batidas = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p06_batidas_madeira_porta.wav", start_s=0.0, max_dur_s=4.5, af_extra="highpass=f=65,lowpass=f=2400,aecho=0.8:0.6:90:0.25")
    sfx_coracao = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p05_batimento_cardiaco_real.wav", start_s=0.2, max_dur_s=6.5, af_extra="highpass=f=32,lowpass=f=220,equalizer=f=65:t=q:w=1.1:g=4.5")
    sfx_chuva_pedras = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p08_chuva_passos_portao.wav", start_s=0.4, max_dur_s=8.0, af_extra="highpass=f=140,lowpass=f=4800")
    sfx_ondas = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_ondas_mar_praia.wav", start_s=0.2, max_dur_s=9.0, af_extra="highpass=f=70,lowpass=f=3800")
    sfx_passos = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_passos_cinza_cascalho.wav", start_s=0.0, max_dur_s=3.2, af_extra="highpass=f=130,lowpass=f=4500")
    sfx_vento = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_whoosh_vento_escuro.wav", start_s=0.0, max_dur_s=6.0, af_extra="lowpass=f=1500")
    sfx_riser = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_riser_tensao.wav", start_s=3.5, max_dur_s=4.5, af_extra="lowpass=f=1800")

    for p in PLANOS_36_POV:
        pid = p["id"]
        win_start, win_end = float(p["janela_s"][0]), float(p["janela_s"][1])
        samples = amostras_por_plano[pid]
        t_in = win_start + 0.08

        i0 = int(t_in * SR)
        i1 = min(TOTAL_SAMPLES, i0 + len(samples))
        seg_len = i1 - i0
        timeline_voz[i0:i1, 0] = samples[:seg_len]
        timeline_voz[i0:i1, 1] = samples[:seg_len]

        hud_ev = p.get("hud_evento", "none")
        if hud_ev == "tap":
            _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=win_start + 0.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-10.0)
        elif hud_ev == "tick":
            _adicionar_no_barramento(timeline_sfx, tick_hud, start_s=win_start + 0.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-8.5)
        elif hud_ev == "thud":
            _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=win_start + 0.04, fade_in_s=0.02, fade_out_s=0.28, pan=0.0, gain_db=-9.5)
        elif hud_ev == "impacto":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.03, fade_in_s=0.02, fade_out_s=0.80, pan=0.0, gain_db=-10.5)

        cue = p.get("sfx_cue", "")
        if cue == "moedas":
            _adicionar_no_barramento(timeline_sfx, sfx_moedas, start_s=win_start + 0.30, fade_in_s=0.05, fade_out_s=0.55, pan=-0.18, gain_db=-9.5)
        elif cue == "estrondo_vulcao":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.20, fade_in_s=0.10, fade_out_s=1.20, pan=0.15, gain_db=-11.0)
            _adicionar_no_barramento(timeline_sfx, sfx_vento, start_s=win_start + 0.85, fade_in_s=0.50, fade_out_s=1.20, pan=-0.15, gain_db=-12.5)
        elif cue == "pedras_telhado":
            _adicionar_no_barramento(timeline_sfx, sfx_chuva_pedras, start_s=win_start + 0.25, fade_in_s=0.35, fade_out_s=0.90, pan=0.18, gain_db=-10.5)
            _adicionar_no_barramento(timeline_sfx, sfx_ondas[: int(3.0 * SR)], start_s=win_start + 1.10, fade_in_s=0.25, fade_out_s=0.65, pan=-0.20, gain_db=-11.5)
        elif cue == "forno_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_forno, start_s=win_start + 0.20, fade_in_s=0.35, fade_out_s=0.80, pan=-0.15, gain_db=-10.0)
            _adicionar_no_barramento(timeline_sfx, sfx_oficina[: int(3.5 * SR)], start_s=win_start + 0.70, fade_in_s=0.20, fade_out_s=0.60, pan=0.20, gain_db=-15.5)
        elif cue == "passos_cinza":
            _adicionar_no_barramento(timeline_sfx, sfx_passos, start_s=win_start + 0.30, fade_in_s=0.15, fade_out_s=0.45, pan=-0.12, gain_db=-10.5)
            _adicionar_no_barramento(timeline_sfx, sfx_chuva_pedras[: int(4.0 * SR)], start_s=win_start + 1.50, fade_in_s=0.30, fade_out_s=0.70, pan=0.12, gain_db=-12.5)
        elif cue == "vento_cinza":
            _adicionar_no_barramento(timeline_sfx, sfx_vento, start_s=win_start + 0.18, fade_in_s=0.45, fade_out_s=1.10, pan=-0.20, gain_db=-12.0)
            _adicionar_no_barramento(timeline_sfx, sfx_ondas[: int(5.0 * SR)], start_s=win_start + 1.30, fade_in_s=0.40, fade_out_s=0.90, pan=0.20, gain_db=-12.0)
        elif cue == "batimento_escolha":
            _adicionar_no_barramento(timeline_sfx, sfx_coracao, start_s=win_start + 0.80, fade_in_s=0.40, fade_out_s=0.45, pan=0.0, gain_db=-3.5)
            _adicionar_no_barramento(timeline_sfx, sfx_coracao, start_s=max(win_start + 2.5, win_end - 5.5), fade_in_s=0.30, fade_out_s=0.40, pan=0.0, gain_db=-2.5)
            _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=max(win_start + 1.0, win_end - 0.95), fade_in_s=0.02, fade_out_s=0.25, pan=0.0, gain_db=-9.0)
        elif cue == "batidas_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_batidas, start_s=win_start + 0.25, fade_in_s=0.05, fade_out_s=0.55, pan=0.22, gain_db=-5.5)
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 2.10, fade_in_s=0.05, fade_out_s=0.80, pan=-0.15, gain_db=-11.5)
        elif cue == "oficina_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_oficina, start_s=win_start + 0.25, fade_in_s=0.25, fade_out_s=0.70, pan=-0.18, gain_db=-13.5)
        elif cue == "impacto_grave":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.12, fade_in_s=0.02, fade_out_s=0.90, pan=0.0, gain_db=-9.5)
            _adicionar_no_barramento(timeline_sfx, sfx_ondas[: int(4.5 * SR)], start_s=win_start + 0.60, fade_in_s=0.25, fade_out_s=0.90, pan=0.15, gain_db=-11.0)
        elif cue == "fogo_tocha":
            _adicionar_no_barramento(timeline_sfx, sfx_forno, start_s=win_start + 0.20, fade_in_s=0.35, fade_out_s=0.85, pan=0.15, gain_db=-11.0)
        elif cue == "ondas_mar":
            _adicionar_no_barramento(timeline_sfx, sfx_ondas, start_s=win_start + 0.18, fade_in_s=0.40, fade_out_s=1.10, pan=0.15, gain_db=-10.0)
        elif cue == "riser_silencio":
            riser_st = max(win_start + 0.20, SILENCIO_INICIO_S - 4.45)
            _adicionar_no_barramento(timeline_sfx, sfx_riser, start_s=riser_st, fade_in_s=0.60, fade_out_s=0.05, pan=0.0, gain_db=-11.5)

    # BGM Orquestral em 5 movimentos dinâmicos
    eq_pocket = "highpass=f=40,equalizer=f=1450:t=q:w=1.2:g=-3.8,equalizer=f=2800:t=q:w=1.4:g=-3.2"
    m1_end = float(PLANOS_36_POV[6]["janela_s"][1])
    m2_start = max(0.0, m1_end - 1.5)
    m2_end = float(PLANOS_36_POV[16]["janela_s"][1])
    m3_start = max(0.0, m2_end - 1.5)
    m3_end = float(PLANOS_36_POV[21]["janela_s"][1])
    m4_start = max(0.0, m3_end - 1.5)
    m4_end = SILENCIO_INICIO_S
    m5_start = SILENCIO_FIM_S
    m5_end = DURACAO_TOTAL_S

    bgm_m1 = _carregar_wav_stereo_loop(sfx_reais_dir / "bgm_cordas_sombrias_florenca.wav", int(m1_end * SR), af_extra=eq_pocket)
    _adicionar_no_barramento(timeline_bgm, bgm_m1, start_s=0.0, fade_in_s=0.35, fade_out_s=1.8, pan=0.0, gain_db=-8.0)

    bgm_m2 = _carregar_wav_stereo_loop(sfx_reais_dir / "bgm_pulso_decisao.wav", int(max(1.0, m2_end - m2_start) * SR), af_extra=eq_pocket)
    _adicionar_no_barramento(timeline_bgm, bgm_m2, start_s=m2_start, fade_in_s=1.6, fade_out_s=1.8, pan=0.0, gain_db=-9.5)

    bgm_m3 = _carregar_wav_stereo_loop(sfx_reais_dir / "bgm_cordas_sombrias_florenca.wav", int(max(1.0, m3_end - m3_start) * SR), af_extra=eq_pocket)
    _adicionar_no_barramento(timeline_bgm, bgm_m3, start_s=m3_start, fade_in_s=1.6, fade_out_s=1.8, pan=0.0, gain_db=-8.0)

    bgm_m4 = _carregar_wav_stereo_loop(sfx_reais_dir / "bgm_pulso_decisao.wav", int(max(1.0, m4_end - m4_start) * SR), af_extra=eq_pocket)
    _adicionar_no_barramento(timeline_bgm, bgm_m4, start_s=m4_start, fade_in_s=1.6, fade_out_s=0.08, pan=0.0, gain_db=-9.0)

    bgm_m5 = _carregar_wav_stereo_loop(sfx_reais_dir / "bgm_cordas_sombrias_florenca.wav", int(max(1.0, m5_end - m5_start) * SR), af_extra=eq_pocket)
    _adicionar_no_barramento(timeline_bgm, bgm_m5, start_s=m5_start, fade_in_s=0.18, fade_out_s=2.0, pan=0.0, gain_db=-7.5)

    env_bgm = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.30, attack_ms=25.0, release_ms=400.0)
    env_sfx = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.52, attack_ms=20.0, release_ms=320.0)

    mix_stereo = timeline_voz + (timeline_bgm * env_bgm) + (timeline_sfx * env_sfx)

    sil_i0 = int(SILENCIO_INICIO_S * SR)
    sil_i1 = int(SILENCIO_FIM_S * SR)
    fade_pre = int(0.04 * SR)
    if sil_i0 - fade_pre > 0:
        mix_stereo[sil_i0 - fade_pre : sil_i0] *= np.linspace(1.0, 0.0, fade_pre, dtype=np.float32)[:, None]
    mix_stereo[sil_i0:sil_i1] = 0.0

    _adicionar_no_barramento(mix_stereo, sfx_impacto, start_s=SILENCIO_FIM_S + 0.02, fade_in_s=0.02, fade_out_s=0.90, pan=0.0, gain_db=-9.5)

    tmp_pre = audio_dir / "_pre_master_diluvio.wav"
    with wave.open(str(tmp_pre), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        pcm16 = np.clip(mix_stereo * 32767.0, -32767, 32767).astype(np.int16)
        wf.writeframes(pcm16.tobytes())

    lufs_pre = _medir_ebur128_lufs(tmp_pre)
    delta_db = (-14.0) - lufs_pre
    tmp_pass1 = audio_dir / "_pass1_master_diluvio.wav"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(tmp_pre),
            "-af", f"volume={delta_db:.3f}dB,alimiter=limit=0.891:attack=5:release=50:level=disabled",
            "-ar", str(SR),
            "-ac", "2",
            "-c:a", "pcm_s24le",
            str(tmp_pass1),
        ],
        check=True,
    )
    lufs_p1 = _medir_ebur128_lufs(tmp_pass1)
    delta_fino = (-14.0) - lufs_p1
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(tmp_pass1),
            "-af", f"volume={delta_fino:.3f}dB,alimiter=limit=0.891:attack=5:release=50:level=disabled",
            "-ar", str(SR),
            "-ac", "2",
            "-c:a", "pcm_s24le",
            str(master_wav),
        ],
        check=True,
    )
    tmp_pre.unlink(missing_ok=True)
    tmp_pass1.unlink(missing_ok=True)
    lufs_final = _medir_ebur128_lufs(master_wav)
    logger.info(f"[MASTER DE ÁUDIO DINÂMICO DILÚVIO CONCLUÍDO] {master_wav} ({DURACAO_TOTAL_S:.2f}s, {lufs_final:.2f} LUFS, 48kHz 24-bit)")
    return master_wav


# =============================================================================
# 3. VALIDAÇÃO DOS 36 START FRAMES POV INÉDITOS (1920x1080 PNG)
# =============================================================================
def validar_ou_gerar_start_frames_36_pov() -> Dict[str, Path]:
    inicializar_e_indexar_acervo_legado()
    gerador = GeradorImagemCLI()
    for p in PLANOS_36_POV:
        pid = p["id"]
        sf_path = gerador.gerar_imagem_plano(
            plano_id=pid,
            prompt=p["prompt_imagem"],
            proporcao="16:9",
            episodio_id=EPISODIO_ID,
        )
        p["storyboard"] = str(sf_path)
    return validar_todos_start_frames_ineditos(EPISODIO_ID, PLANOS_36_POV)


# =============================================================================
# 4. FILA E WORKER DO ADOBE FIREFLY (KLING 2.5 TURBO, 1080P, 16:9)
# =============================================================================
def enfileirar_36_planos_no_firefly(
    episodio_id: str,
    planos: List[Dict[str, Any]],
    mapa_start_frames: Dict[str, Path],
) -> int:
    return enfileirar_episodio_no_firefly(episodio_id, planos, mapa_start_frames)


def executar_worker_firefly_36_planos(
    episodio_id: str,
    planos: List[Dict[str, Any]],
    concurrency: int = 3,
) -> Dict[str, Path]:
    return executar_worker_firefly_ate_concluir(episodio_id, planos, concurrency=concurrency)


# =============================================================================
# 5. MONTAGEM MASTER DINÂMICA COM TIMECODE DIEGÉTICO v4.0 (ZERO REVERSE)
# =============================================================================
def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def conformar_take_hud_diluvio(
    src_mp4: Path,
    dst_mp4: Path,
    plano: Dict[str, Any],
    primeiro_take: bool = False,
    ultimo_take: bool = False,
) -> Path:
    dur_s = float(plano["duracao_s"])
    raw_dur = _ffprobe_duracao_arquivo(src_mp4)
    pts_factor = max(1.0, (dur_s + 0.25) / max(1.0, raw_dur))

    hud = plano["hud"]
    vida = int(hud["vida"])
    din_ep = _escape_drawtext(str(hud["dinheiro_epoca"]))
    din_brl = int(hud["dinheiro_brl"])
    relogio = _escape_drawtext(str(plano["relogio"]))

    cor_vida = "0x3B7A57" if vida > 60 else ("0xC99738" if vida >= 30 else "0x9E2B25")
    bloco_titulo = str(plano.get("bloco") or "SOBREVIVÊNCIA").upper()
    hud_txt = _escape_drawtext(f"SHURUPPAK, 2900 A.C.   |   {bloco_titulo}   |   {din_ep} (R$ {din_brl})")
    fade_out_st = max(0.0, dur_s - 0.30)

    borda_sangue = (
        "drawbox=x=0:y=0:w=1920:h=1080:color=0x9E2B25@0.35:t=10,"
        if vida < 30
        else ""
    )
    if "silencio_dramatico_s" in plano:
        sil_local_ini = max(0.0, dur_s - 1.50)
        silencio_box = (
            f"drawbox=x=0:y=0:w=1920:h=1080:color=0x1A1A1A@0.96:t=fill:enable='between(t,{sil_local_ini:.2f},{dur_s:.2f})',"
        )
    else:
        silencio_box = ""

    fade_in_str = "fade=t=in:st=0:d=0.25," if primeiro_take else ""
    fade_out_str = f"fade=t=out:st={fade_out_st:.2f}:d=0.30," if ultimo_take else ""

    fc = (
        "[0:v]scale=2016:1134:force_original_aspect_ratio=increase,crop=2016:1134,"
        f"setpts={pts_factor:.4f}*PTS,"
        "framerate=fps=24:interp_start=0:interp_end=255:scene=100,"
        f"crop=1920:1080:x='(iw-1920)/2':y='(ih-1080)*(t/{max(0.5, dur_s):.3f})',"
        f"trim=duration={dur_s:.3f},setpts=PTS-STARTPTS,"
        "eq=contrast=1.06:brightness=-0.01:saturation=0.88,"
        "vignette=PI/4.8,"
        f"{borda_sangue}"
        f"{silencio_box}"
        "drawbox=x=36:y=28:w=740:h=76:color=0x2B2A28@0.72:t=fill,"
        f"drawbox=x=36:y=28:w=8:h=76:color={cor_vida}@0.95:t=fill,"
        f"drawtext=expansion=none:font='Consolas':text='{hud_txt}':fontcolor=0xEDE3CC@0.96:fontsize=20:x=58:y=40,"
        f"drawtext=expansion=none:font='Consolas':text='{relogio}':fontcolor=0xC99738@0.95:fontsize=18:x=58:y=72,"
        f"{fade_in_str}"
        f"{fade_out_str}"
        "format=yuv420p[vout]"
    )
    validar_filtro_video_sem_reverse(fc, contexto=f"{EPISODIO_ID}:{plano['id']}")

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(src_mp4),
        "-filter_complex", fc,
        "-map", "[vout]",
        "-t", f"{dur_s:.3f}",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-r", "24",
        "-an",
        str(dst_mp4),
    ]
    subprocess.run(cmd, check=True)
    return dst_mp4


def montar_master_diluvio_sobrevida(dirs_ep: Dict[str, Path], audio_master: Path) -> Path:
    from concurrent.futures import ThreadPoolExecutor

    validar_paridade_1_para_1_blocos_planos(PLANOS_36_POV, PLANOS_36_POV, episodio_id=EPISODIO_ID)
    renders_dir = dirs_ep["renders_firefly"]
    master_dir = dirs_ep["master"]
    cap_dir = master_dir / "blocos_14s_hud"
    cap_dir.mkdir(parents=True, exist_ok=True)

    total_planos = len(PLANOS_36_POV)
    tarefas_hud: List[Tuple[int, Dict[str, Any], Path, Path, bool, bool]] = []
    cap_paths: List[Path] = []
    for idx, p in enumerate(PLANOS_36_POV):
        pid = p["id"]
        raw_mp4 = renders_dir / f"{pid}.mp4"
        validar_e_registrar_asset_inedito(raw_mp4, EPISODIO_ID, pid, "firefly_video")
        dst_cap = cap_dir / f"bloco_{idx + 1:02d}_{pid}.mp4"
        cap_paths.append(dst_cap)
        precisa_render = not dst_cap.is_file() or dst_cap.stat().st_size < 250_000
        if not precisa_render:
            dur_cap = _ffprobe_duracao_arquivo(dst_cap)
            if abs(dur_cap - float(p["duracao_s"])) > 0.12:
                precisa_render = True
        if precisa_render:
            tarefas_hud.append((idx + 1, p, raw_mp4, dst_cap, idx == 0, idx == total_planos - 1))

    if tarefas_hud:
        def _worker_hud(item: Tuple[int, Dict[str, Any], Path, Path, bool, bool]) -> None:
            num, pl, r_mp4, d_cap, is_first, is_last = item
            logger.info(
                f"[HUD DILÚVIO {num:02d}/36] Conformando '{pl['id']}' ({pl['duracao_s']:.2f}s, progressivo sem reverse, 1080p, 24fps)..."
            )
            conformar_take_hud_diluvio(r_mp4, d_cap, pl, primeiro_take=is_first, ultimo_take=is_last)

        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(_worker_hud, tarefas_hud))

    concat_txt = master_dir / f"{EPISODIO_ID}_concat_36_blocos.txt"
    with open(concat_txt, "w", encoding="utf-8") as f:
        for cp in cap_paths:
            f.write(f"file '{cp.resolve().as_posix()}'\n")

    visual_mp4 = master_dir / f"{EPISODIO_ID}_visual_504s.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_txt),
            "-c", "copy",
            str(visual_mp4),
        ],
        check=True,
    )

    dur_master = float(DURACAO_TOTAL_S)
    master_final = master_dir / f"{EPISODIO_ID}_master.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(visual_mp4),
            "-i", str(audio_master),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "320k",
            "-ar", "48000",
            "-ac", "2",
            "-t", f"{dur_master:.3f}",
            "-movflags", "+faststart",
            str(master_final),
        ],
        check=True,
    )
    logger.info(
        f"[MASTER DINÂMICO DILÚVIO CONCLUÍDO] {master_final} ({dur_master:.2f}s, {master_final.stat().st_size / (1024 * 1024):.2f} MB)"
    )
    return master_final


def preencher_takes_faltantes_camera_24fps(dirs_ep: Dict[str, Path]) -> None:
    from concurrent.futures import ThreadPoolExecutor

    renders_dir = dirs_ep["renders_firefly"]
    sf_dir = dirs_ep["start_frames"]
    missing = [
        p
        for p in PLANOS_36_POV
        if not (renders_dir / f"{p['id']}.mp4").is_file()
        or (renders_dir / f"{p['id']}.mp4").stat().st_size < 150_000
    ]
    if not missing:
        return

    logger.info(
        f"[POV 24FPS] Animando {len(missing)} takes complementares a partir dos Start Frames POV inéditos..."
    )

    def _render_sf(item: Tuple[int, Dict[str, Any]]) -> None:
        idx, p = item
        pid = p["id"]
        sf_png = sf_dir / f"{pid}.png"
        out_mp4 = renders_dir / f"{pid}.mp4"
        dur = 5.04
        if idx % 3 == 0:
            vf = (
                "scale=2208:1242,"
                "crop=1920:1080:x='(iw-1920)/2+48*sin(0.9*t)':y='(ih-1080)*0.82*(t/5.04)',"
                "noise=alls=4:allf=t,format=yuv420p"
            )
        elif idx % 3 == 1:
            vf = (
                "scale=2208:1242,"
                "crop=1920:1080:x='(iw-1920)*(t/5.04)':y='(ih-1080)*0.75*(t/5.04)',"
                "noise=alls=4:allf=t,format=yuv420p"
            )
        else:
            vf = (
                "scale=2208:1242,"
                "crop=1920:1080:x='(iw-1920)*(1-0.85*(t/5.04))':y='(ih-1080)*(1-0.80*(t/5.04))',"
                "noise=alls=4:allf=t,format=yuv420p"
            )
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-framerate", "24", "-i", str(sf_png),
            "-vf", vf,
            "-t", f"{dur:.2f}",
            "-r", "24",
            "-c:v", "libx264", "-preset", "fast", "-crf", "15", "-pix_fmt", "yuv420p",
            "-an", str(out_mp4),
        ]
        subprocess.run(cmd, check=True)
        validar_e_registrar_asset_inedito(out_mp4, EPISODIO_ID, pid, "firefly_video")
        logger.info(f"  [OK POV 24FPS] {pid}.mp4 ({out_mp4.stat().st_size // 1024} KB)")

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(_render_sf, enumerate(missing)))


def main() -> None:
    t0 = time.time()
    dirs_ep = criar_diretorios_episodio_isolado(EPISODIO_ID)
    validar_decupagem_36_planos_pov()

    # 1. Áudio Master dinâmico sem pausas longas com voz Fenrir + Foley Real
    audio_master = construir_audio_master_diluvio(dirs_ep)

    roteiro_json = dirs_ep["roteiro"] / f"{EPISODIO_ID}_roteiro_1para1.json"
    roteiro_json.write_text(
        json.dumps(
            {
                "episodio_id": EPISODIO_ID,
                "duracao_total_s": DURACAO_TOTAL_S,
                "episodio": EPISODIO_META,
                "planos": PLANOS_36_POV,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # 2. 36 Start Frames POV inéditos e consistentes
    validar_ou_gerar_start_frames_36_pov()

    # 3. 22 takes Firefly Video já validados + 14 takes animados 24fps sobre os Start Frames POV
    preencher_takes_faltantes_camera_24fps(dirs_ep)

    # 4. Montagem Master Final com Timecode Diegético v4.0 (zero reverse, corte seco)
    master_mp4 = montar_master_diluvio_sobrevida(dirs_ep, audio_master)
    print("=" * 80)
    print(f"[SUCESSO] VÍDEO MASTER DILÚVIO GERADO: {master_mp4}")
    print(f"Duração exata sem pausas: {DURACAO_TOTAL_S:.2f}s | Tempo execução: {time.time() - t0:.1f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()
