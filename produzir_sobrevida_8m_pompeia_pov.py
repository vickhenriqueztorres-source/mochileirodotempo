"""Produção Completa 1:1 de 8m24s (504.0s) no Adobe Firefly — SOBREVIDA v2.0 (POV Realista).

Episódio: Você Sobreviveria às 18 Horas de Pompeia? (Pompeia, 24 de agosto de 79 d.C.)
ID: ep_sobrevida_8m_pompeia_pov
Duração Total: 504.00 segundos exatos (08m24s — 36 planos de 14.0s em paridade 1:1)
Estrutura Oficial: 9 Blocos (Entrada, Situação, As 5 Decisões, Resultado, Saída)
Voz Oficial: Fenrir (gemini-3.8-flash-tts + fallback resiliente, 48 kHz 24-bit, -14.0 LUFS)
Mixagem: Foley Diegético Real + BGM Orquestral em Atos + Sidechain Suave + Silêncio Dramático de 1.5s (428.50s–430.00s)
Visual: POV Realista em 1ª pessoa (lente 24mm, mãos do padeiro, Lúcio, HUD SOBREVIDA v2.0)
Animação: Adobe Firefly (Kling 2.5 Turbo, 1080p, 16:9, 24fps) — Política Zero-Reuso
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
    format="%(asctime)s | %(levelname)-5s | [POMPEIA POV ZERO-PAUSA] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("sobrevida_8m_pompeia_pov")

EPISODIO_ID = "ep_sobrevida_8m_pompeia_pov"
DURACAO_BLOCO_S = 14.0
NUM_BLOCOS = 36
DURACAO_TOTAL_S = DURACAO_BLOCO_S * NUM_BLOCOS
SR = 48000
TOTAL_SAMPLES = int(SR * DURACAO_TOTAL_S)

# Silêncio Dramático absoluto de 1.50s no clímax da Decisão 5 (final do plano p31)
SILENCIO_INICIO_S = 428.50
SILENCIO_FIM_S = 430.00

DNA_MAOS_POMPEIA = (
    "both weathered olive-tan Roman baker hands and bare muscular forearms visible in the lower frame "
    "(short-sleeved coarse undyed linen Roman tunica above the elbows, NO long sleeves, NO knitted wool sweater), "
    "faint healed oven burn scar on the right forearm, thin leather cord bracelet on the left wrist, "
    "five fingers each, dusted with white flour and grey volcanic ash"
)

DNA_COMPANHEIRO_LUCIO = (
    "Lucio, a 19-year-old young Roman bakery apprentice with short dark curly hair, clean-shaven youthful "
    "Mediterranean face (NO beard), small birthmark below left ear, wearing a short-sleeved olive-green linen tunic "
    "with rope belt, dusted with white flour and volcanic ash"
)

DNA_LOCACOES_POMPEIA: Dict[str, str] = {
    "L01_PADARIA": (
        "ancient Roman pistrinum bakery on Via dell'Abbondanza in Pompeii, 79 AD, brick wood-fired oven, "
        "basalt lava-stone grain mills, rough stone counter, cracked frescoed plaster walls, warm firelight and falling grey ash"
    ),
    "L02_VIA_ABBONDANZA": (
        "Via dell'Abbondanza stone street in Pompeii, 79 AD, pitch-black volcanic darkness under the Plinian ash cloud, "
        "raised basalt stepping stones, terracotta-roofed tabernae, flickering oil torches and falling white pumice gravel"
    ),
    "L03_ADEGA_PORTA_STABIA": (
        "heavy vaulted Roman stone cellar archway and Porta Stabia public stone fountain in Pompeii, 79 AD, "
        "pitch-black volcanic night lit only by flickering orange torchlight and red volcanic lightning"
    ),
    "L04_PRAIA_MOLHE": (
        "dark volcanic shoreline and wet black basalt stone pier south of Pompeii in pitch-black volcanic night, 79 AD, "
        "receded sea, wooden Roman rowboats in violent foaming surf, red volcanic lightning in the black ash clouds"
    ),
    "L05_COLINA_ESTABIA": (
        "high rocky hillside ridge near Stabiae overlooking the Sarno valley and buried plain of Pompeii, 79 AD, "
        "ancient dirt trail and low Roman stone wall below (NO modern roads or vehicles), ash-covered ground and smoking Mount Vesuvius"
    ),
}

EPISODIO_META: Dict[str, Any] = {
    "perigo": "Erupção do Monte Vesúvio",
    "lugar": "Pompeia, Império Romano",
    "data": "24 de agosto de 79 d.C.",
    "papel_do_jogador": "padeiro liberto de 22 anos na Via dell'Abbondanza",
    "serie": "Você Sobreviveria?",
    "duracao_alvo_min": 7.3,
    "titulo_opcoes": [
        "Você Sobreviveria às 18 Horas de Pompeia?",
        "Pompeia em 1ª Pessoa: Você Sairia Vivo?",
        "Quanto Tempo Você Duraria em Pompeia (79 d.C.)?",
    ],
    "promessa_thumbnail": "18 HORAS",
    "chance_base_pct": 68,
    "chance_final_pct": 27,
    "dna_maos": DNA_MAOS_POMPEIA,
    "dna_companheiro": DNA_COMPANHEIRO_LUCIO,
    "dna_locacoes": DNA_LOCACOES_POMPEIA,
    "personagens": [
        {
            "id": "voce_maos",
            "papel": "maos_do_jogador",
            "nome": "Você (Padeiro liberto, 22 anos)",
            "Prompt_Base_Maos": DNA_MAOS_POMPEIA,
            "Prompt_Base_Reflexo": (
                "reflected in dark water: 22-year-old Roman man with short dark curly hair covered in white volcanic ash, "
                "exhausted eyes red from sulfur smoke, wet linen cloth tied around the neck"
            ),
            "aparece_em_planos": [
                "p01", "p04", "p07", "p09", "p10", "p11", "p14", "p16", "p17",
                "p19", "p21", "p22", "p25", "p27", "p29", "p30", "p31", "p35",
            ],
        },
        {
            "id": "lucio",
            "papel": "companheiro",
            "nome": "Lúcio (Aprendiz da padaria, 19 anos)",
            "Prompt_Base": DNA_COMPANHEIRO_LUCIO,
            "aparece_em_planos": ["p05", "p12", "p18", "p21", "p24", "p31", "p34"],
        },
    ],
    "objetos_recorrentes": [
        {
            "id": "pano_linho_vinagre",
            "Prompt_Base": "coarse wet linen cloth soaked in water and vinegar, stained with grey volcanic ash",
            "aparece_em_planos": ["p05", "p11", "p31"],
        },
        {
            "id": "chave_ferro_adega",
            "Prompt_Base": "heavy ancient Roman forged iron cellar key on a leather cord",
            "aparece_em_planos": ["p06", "p18", "p33"],
        },
    ],
}

# =============================================================================
# 1. DECUPAGEM COMPLETA DE 36 PLANOS POV (14.0s CADA = 504.0s / 08m24s)
# =============================================================================
RAW_36_PLANOS_POMPEIA: List[Dict[str, Any]] = [
    # BLOCO 0 · ENTRADA (p01 a p03: 00:00 a 00:42)
    {
        "plano": 1,
        "id": "p01",
        "bloco": "Entrada",
        "enquadramento": "pov_maos",
        "relogio": "POMPEIA, 79 d.C. · 13h00 · FALTAM 18H",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "tap",
        "sfx_cue": "moedas",
        "texto": (
            "Pompeia, vinte e quatro de agosto do ano setenta e nove, uma hora da tarde. "
            "O chão da sua padaria treme tanto que a farinha salta da pedra sobre dezesseis ases de bronze — "
            "oitenta reais, tudo o que você tem na vida."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a Roman bakery in Pompeii, 79 AD. "
            "Both hands visible in the lower frame, young Roman baker's weathered hands around 22 years old, "
            "olive-tan Mediterranean skin, faint healed oven burn scar across the right forearm, flour dust under fingernails, "
            "coarse cream wool tunic sleeves rolled to the elbows, counting sixteen Roman bronze coins on a stone counter "
            "beside round scored loaves of bread, warm brick oven glow, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic first-person POV shot. Both hands count the bronze coins on the stone counter "
            "as a sudden seismic tremor makes white flour dust and a bronze coin vibrate across the table at 24fps."
        ),
    },
    {
        "plano": 2,
        "id": "p02",
        "bloco": "Entrada",
        "enquadramento": "ambiente",
        "relogio": "POMPEIA, 79 d.C. · 13h05 · COLUNA SUBINDO",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Ao norte da Via da Abundância, o Monte Vesúvio acaba de rasgar o céu do meio-dia. "
            "Uma coluna negra em forma de pinheiro sobe vinte quilômetros na estratosfera e engole o sol."
        ),
        "prompt_imagem": (
            "Cinematic film still, shot on 24mm lens at eye level on Via dell'Abbondanza in Pompeii, 79 AD. "
            "Stone Roman street with stepping stones and terracotta-roofed shops; in the background, Mount Vesuvius erupts "
            "with a colossal dark pine-tree shaped Plinian ash column blotting out the midday sun, frightened Roman citizens "
            "looking up in the street, realistic historical textures, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic historical scene. The colossal dark volcanic ash column billows upward into the sky "
            "as dark shadows sweep across the stone street of Pompeii at 24fps."
        ),
    },
    {
        "plano": 3,
        "id": "p03",
        "bloco": "Entrada",
        "enquadramento": "detalhe",
        "relogio": "POMPEIA, 79 d.C. · 13h15 · CHUVA DE PEDRAS",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": 68},
        "hud_evento": "tap",
        "sfx_cue": "pedras_telhado",
        "texto": (
            "Você tem dezoito horas antes que a montanha apague esta cidade do mapa. "
            "E esqueça os rios de lava: o que vai matar quem errar o primeiro passo cai direto do céu sobre os telhados."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens of Roman terracotta roof tiles in Pompeii, 79 AD. "
            "Porous white and grey volcanic pumice stones rain down from a darkening ash sky, bouncing and cracking "
            "the red clay tiles as fine grey dust settles in the grooves, dramatic chiaroscuro lighting, "
            "subtle 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this photorealistic close-up shot. White and grey pumice stones fall from the sky and bounce off "
            "the terracotta roof tiles, cracking clay fragments and raising puffs of grey ash at 24fps."
        ),
    },
    # BLOCO 1 · SITUAÇÃO (p04 a p07: 00:42 a 01:38)
    {
        "plano": 4,
        "id": "p04",
        "bloco": "Situação",
        "enquadramento": "pov_maos",
        "relogio": "BLOCO 1 · SITUAÇÃO · 13h20 · FORNO DA PADARIA",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "forno_madeira",
        "texto": (
            "Você é um padeiro liberto de vinte e dois anos. "
            "Suas mãos ainda têm as cicatrizes do forno de tijolos onde você assa oitenta pães por madrugada "
            "para pagar o aluguel da loja."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a dim Roman bakery in Pompeii, 79 AD. "
            "Both hands visible in the lower frame, young Roman baker's weathered hands with faint healed oven burn scar "
            "and flour dust, holding a long wooden baker's peel pulling round scored Roman bread loaves from a glowing brick oven, "
            "warm firelight against falling ash dust, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands pull the wooden peel with hot round bread loaves from the brick oven "
            "while orange embers flicker and dust falls from the ceiling rafters at 24fps."
        ),
    },
    {
        "plano": 5,
        "id": "p05",
        "bloco": "Situação",
        "enquadramento": "pov_companion",
        "relogio": "BLOCO 1 · SITUAÇÃO · 13h25 · LÚCIO NO BALCÃO",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "passos_cinza",
        "texto": (
            "Ao seu lado está Lúcio, seu aprendiz de dezenove anos. "
            "Com as mãos trêmulas, ele segura um jarro de água misturada com vinagre e uma tira grossa de linho cru "
            "para limpar o suor do forno."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a Roman bakery in Pompeii, 79 AD. "
            "Your right hand with a healed oven burn scar rests on the stone counter in the lower right frame, while Lucio — "
            "a 19-year-old Roman apprentice in an olive-green linen tunic dusted with flour and ash — looks straight into the camera "
            "lens with wide fearful eyes, holding a terracotta jug and a wet coarse linen cloth, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Lucio looks directly into the camera lens breathing rapidly in fear while clutching "
            "the terracotta jug and coarse linen cloth as ash drifts through the doorway at 24fps."
        ),
    },
    {
        "plano": 6,
        "id": "p06",
        "bloco": "Situação",
        "enquadramento": "detalhe",
        "relogio": "BLOCO 1 · SITUAÇÃO · 13h30 · A CHAVE DA ADEGA",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Pendurada num prego ao lado da escada, a pesada chave de ferro da adega abobadada bate contra o reboco "
            "a cada novo tremor da terra. Abaixo do piso, a adega tem paredes de meio metro de pedra."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens inside a Roman bakery in Pompeii, 79 AD. "
            "A heavy forged Roman iron cellar key hanging on a leather cord from an iron nail on a cracked frescoed plaster wall, "
            "trembling against the wall as plaster dust trickles down, warm oil lamp light, 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this close-up shot. The heavy iron key swings and taps against the cracked Roman plaster wall from a ground tremor "
            "as fine dust trickles down at 24fps."
        ),
    },
    {
        "plano": 7,
        "id": "p07",
        "bloco": "Situação",
        "enquadramento": "pov_acao",
        "relogio": "BLOCO 1 · SITUAÇÃO · 13h40 · IMPACTO NO TETO",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "pedras_telhado",
        "texto": (
            "De repente, o dia vira meia-noite. "
            "Um bloco de pedra-pomes atravessa o telhado da padaria como um projétil de catapulta e estilhaça "
            "a ânfora de barro aos seus pés."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action shot on 24mm lens inside a dark ash-filled Roman bakery in Pompeii, 79 AD. "
            "Both weathered hands with flour dust and cream wool sleeves shield the lower frame as a jagged grey volcanic rock "
            "smashes a terracotta amphora on the stone floor in front of you, shards and olive oil splashing in the dim firelight, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands flinch back in the lower frame as grey pumice debris and terracotta shards "
            "scatter across the stone floor under flickering oven light at 24fps."
        ),
    },
    # BLOCO 2 · DECISÃO 1 (p08 a p12: 01:38 a 02:48)
    {
        "plano": 8,
        "id": "p08",
        "bloco": "Decisão 1",
        "enquadramento": "ambiente",
        "relogio": "DECISÃO 1 · 13h45 · CHUVA DE PEDRA-POMES",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "vento_cinza",
        "texto": (
            "A chuva de pedra-pomes acumula quinze centímetros por hora na calçada. "
            "Sob o balcão de alvenaria está enterrado o cofre de bronze com todas as suas economias de seis meses de alforria."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens looking out from a Roman bakery doorway onto Via dell'Abbondanza in Pompeii, 79 AD. "
            "The midday sky is pitch black with swirling grey ash and falling white pumice stones; Roman figures with cloaks over "
            "their heads hurry past in the torchlight as pumice piles up on the cobblestones, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this cinematic wide shot. Dense white pumice stones rain down across the dark Roman street while cloaked citizens "
            "stumble through the accumulating ash under flickering torchlight at 24fps."
        ),
    },
    {
        "plano": 9,
        "id": "p09",
        "bloco": "Seq 2 · O Choque Inicial",
        "enquadramento": "pov_maos",
        "relogio": "13h50 · ARMADILHA DO COFRE DE BRONZE",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "O instinto imediato de quase todo comerciante na rua é se abaixar para desenterrar o cofre — "
            "mas cada minuto perdido ali dentro custa a única saída antes que as portas travem."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level inside a Roman bakery "
            "in Pompeii, 79 AD: on the left side of the room, the open wooden street door looking out to the ash-darkened street; "
            "on the right side, a heavy bronze strongbox half-buried under stone counter tiles. Both flour-dusted hands "
            "are open and tense in the lower foreground, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both open hands pull back from the buried strongbox toward the open street doorway "
            "as ash falls outside and oven firelight glints on the bronze strongbox at 24fps."
        ),
    },
    {
        "plano": 10,
        "id": "p10",
        "bloco": "Seq 2 · O Choque Inicial",
        "enquadramento": "pov_acao",
        "relogio": "14h00 · PORTAS SELADAS PELA PEDRA-POMES",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "16 Ases", "dinheiro_brl": 80, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Nos imóveis vizinhos, quem perdeu quarenta minutos cavando moedas ficou preso quando meio metro "
            "de pedra-pomes se acumulou na calçada e trancou as portas de madeira por fora."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens inside a dark Roman shop in Pompeii, 79 AD. "
            "Both ash-stained hands push desperately against heavy wooden folding shop doors that are jammed shut from the outside "
            "by a deep drift of white pumice gravel spilling through the gap, dim claustrophobic lighting, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands push hard against the jammed wooden doors as white pumice stones pour "
            "through the narrow gap and the timber groans under external weight at 24fps."
        ),
    },
    {
        "plano": 11,
        "id": "p11",
        "bloco": "Seq 2 · O Choque Inicial",
        "enquadramento": "pov_maos",
        "relogio": "14h05 · MANOBRA RÁPIDA · PANO E MOEDAS",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "moedas",
        "texto": (
            "Para escapar da armadilha, você abandona o cofre pesado no chão. "
            "Suas mãos varrem apenas seis ases soltos sobre a pedra — trinta reais — e arrancam o pano grosso de linho "
            "mergulhado no jarro de água e vinagre."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens at eye level in a Roman bakery in Pompeii, 79 AD. "
            "Your left hand sweeps six bronze coins off the stone counter while your right hand with the healed burn scar grabs "
            "the wet coarse linen cloth from the terracotta jug, ash falling through the air, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands swiftly grab the bronze coins and the dripping wet linen cloth from the counter "
            "as volcanic dust swirls in the warm oven light at 24fps."
        ),
    },
    {
        "plano": 12,
        "id": "p12",
        "bloco": "Seq 2 · O Choque Inicial",
        "enquadramento": "ambiente",
        "relogio": "14h15 · FUGA NA PRIMEIRA HORA",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": 72},
        "hud_evento": "tap",
        "sfx_cue": "passos_cinza",
        "texto": (
            "Você puxa Lúcio pela soleira antes que o cascalho bloqueie a passagem. "
            "Sair na primeira hora foi a manobra que separou os vivos dos mortos em Pompeia — "
            "mas lá fora o meio-dia já virou noite fechada."
        ),
        "prompt_imagem": (
            "Cinematic medium-wide shot on 24mm lens on Via dell'Abbondanza in Pompeii, 79 AD. "
            "Seen from behind at eye level, Lucio in his olive tunic hurries ahead through ankle-deep white pumice stones "
            "holding a flickering oil torch in the artificial midnight darkness of the eruption, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this cinematic shot. Lucio pushes forward through ankle-deep white pumice stones holding a flickering torch "
            "as volcanic ash rains down across the Roman street at 24fps."
        ),
    },
    # BLOCO 3 · DECISÃO 2 (p13 a p17: 02:48 a 03:58)
    {
        "plano": 13,
        "id": "p13",
        "bloco": "Decisão 2",
        "enquadramento": "detalhe",
        "relogio": "DECISÃO 2 · 15h30 · PROJÉTEIS A 180 KM/H",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "pedras_telhado",
        "texto": (
            "Três e meia da tarde. Junto com a pedra-pomes leve, o vulcão agora cospe fragmentos de rocha densa "
            "que caem a cento e oitenta quilômetros por hora, rachando crânios no meio da via."
        ),
        "prompt_imagem": (
            "Cinematic close-up shot on 24mm lens on a pumice-covered Roman street in Pompeii, 79 AD. "
            "A dented Roman bronze helmet lies half-buried in white pumice gravel beside a heavy dark basalt rock fragment "
            "that just struck the ground, glowing torchlight reflecting on the wet bronze, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this close-up shot. Heavy dark volcanic stones strike the white pumice gravel around the dented bronze helmet, "
            "kicking up clouds of grey dust at 24fps."
        ),
    },
    {
        "plano": 14,
        "id": "p14",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_maos",
        "relogio": "15h40 · O RISCO DOS BEIRAIS E MARQUISES",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "Sob o bombardeio de pedras, o impulso da multidão é correr colado embaixo dos beirais e marquises — "
            "sem perceber que a estrutura dos telhados está prestes a colapsar."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level on a dark street "
            "in Pompeii, 79 AD: on the left side, the open center of the street under falling pumice with a wool cushion in your left hand; "
            "on the right side, a covered timber overhang portico along the building wall groaning under weight. Both hands visible in the lower foreground, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Your left hand holds the coarse wool cushion while your right hand gestures "
            "away from the overloaded timber portico as pumice stones fall at 24fps."
        ),
    },
    {
        "plano": 15,
        "id": "p15",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "ambiente",
        "relogio": "15h50 · QUEDA DAS MARQUISES (400 KG/M2)",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Com quatrocentos quilos de pedra-pomes acumulados por metro quadrado, as vigas de madeira cedem "
            "e as marquises desabam inteiras sobre quem procurava abrigo nas calçadas."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens on a dark ash-filled street in Pompeii, 79 AD. "
            "A heavy wooden shop overhang loaded with a meter of white pumice stones collapses violently onto the sidewalk, "
            "sending timber beams, red roof tiles and clouds of ash crashing down, dramatic torchlight, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic scene. The overloaded timber roof overhang snaps and crashes down onto the stone walkway in a cloud "
            "of ash and broken terracotta tiles at 24fps."
        ),
    },
    {
        "plano": 16,
        "id": "p16",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_maos",
        "relogio": "16h05 · TÉCNICA DE PLÍNIO · ALMOFADA DE LÃ",
        "hud": {"vida": 100, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "oficina_madeira",
        "texto": (
            "Para atravessar a avenida vivo, você aplica a técnica registrada por Plínio, o Jovem: "
            "suas mãos largam a sacola de pães e amarram uma almofada grossa de lã sobre o crânio com corda de cânhamo."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens at eye level in Pompeii, 79 AD. "
            "Both ash-covered hands pull a thick hemp cord tight around a coarse stuffed wool cushion "
            "being raised toward the top of the frame, while a cloth bread sack lies dropped in the pumice below, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both hands knot the coarse hemp rope tightly around the wool cushion and lift it "
            "upward as fine ash rains down at 24fps."
        ),
    },
    {
        "plano": 17,
        "id": "p17",
        "bloco": "Seq 3 · Escalada e Improviso",
        "enquadramento": "pov_acao",
        "relogio": "16h30 · AVANÇO PELO CENTRO DA VIA",
        "hud": {"vida": 82, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": 58},
        "hud_evento": "tap",
        "sfx_cue": "passos_cinza",
        "texto": (
            "Avançando pelo centro aberto da rua, longe dos telhados que desmoronam, um fragmento de rocha raspa seu ombro esquerdo — "
            "mas a lã amortece o impacto letal na cabeça."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action shot on 24mm lens walking through knee-deep white pumice in the center of a Roman street "
            "in Pompeii, 79 AD. Your right hand clutches your bruised left shoulder in a torn ash-stained wool sleeve while collapsed roof beams "
            "burn faintly along the building walls on both sides, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Camera trudges forward with heavy handheld breathing as your right hand grips your bruised "
            "left shoulder amidst falling pumice at 24fps."
        ),
    },
    # BLOCO 4 · DECISÃO 3 · VIRADA (p18 a p22: 03:58 a 05:08)
    {
        "plano": 18,
        "id": "p18",
        "bloco": "Decisão 3 · Virada",
        "enquadramento": "pov_companion",
        "relogio": "DECISÃO 3 · VIRADA · 18h00 · ESCURIDÃO TOTAL",
        "hud": {"vida": 82, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Seis da tarde. A escuridão é tão densa que você não vê um palmo à frente sem tocha. "
            "Lúcio tosse cinza, puxa a chave de ferro do seu cinto e aponta a entrada de uma adega abobadada de pedra."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens at eye level in Pompeii, 79 AD. "
            "In the pitch-black volcanic night lit only by a dying torch and distant red lightning, Lucio — face covered in white ash — "
            "points urgently toward a heavy arched stone cellar entrance while your left hand holds the iron key in the lower frame, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Lucio coughs and points urgently toward the stone cellar archway as red volcanic lightning "
            "flashes in the dark sky behind him at 24fps."
        ),
    },
    {
        "plano": 19,
        "id": "p19",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "pov_maos",
        "relogio": "18h10 · A ILUSÃO DO ABRIGO SUBTERRÂNEO",
        "hud": {"vida": 82, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "Diante da escada da adega subterrânea, o chão dá um novo tranco. "
            "Parece o refúgio mais sólido da cidade — mas descer esses degraus agora é entrar numa sepultura de pedra."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level in Pompeii, 79 AD: "
            "on the left side, warm torchlit steps descending into a solid vaulted Roman stone cellar; on the right side, the "
            "dark street buried in deep pumice gravel. Both ash-covered hands are open in the lower foreground, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both ash-stained hands tense in the lower frame between the stone cellar "
            "steps on the left and the dark pumice-choked street on the right at 24fps."
        ),
    },
    {
        "plano": 20,
        "id": "p20",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "detalhe",
        "relogio": "18h20 · ARMADILHA MORTAL (38% DAS VÍTIMAS)",
        "hud": {"vida": 82, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "impacto_grave",
        "texto": (
            "Aqui está a grande armadilha de Pompeia: a adega parece um bunker perfeito, "
            "mas trinta e oito por cento de todos os mortos da cidade morreram trancados dentro de imóveis "
            "quando dois metros de pedra selaram as portas para sempre."
        ),
        "prompt_imagem": (
            "Cinematic close-up shot on 24mm lens inside a Roman stone cellar in Pompeii, 79 AD. "
            "Massive ceiling stone blocks crack under immense weight as a mountain of white pumice completely seals the narrow cellar "
            "window and stairway from outside, extinguishing a bronze oil lamp on the floor, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic close-up shot. White pumice pours down and completely blocks the cellar stairway while dust falls "
            "from cracking stone ceiling vaults at 24fps."
        ),
    },
    {
        "plano": 21,
        "id": "p21",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "pov_acao",
        "relogio": "18h30 · RECUSA DO ABRIGO E DESABAMENTO",
        "hud": {"vida": 82, "comida": 55, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "batidas_madeira",
        "texto": (
            "Você ouve o estalo da abóbada, recusa o abrigo subterrâneo e puxa Lúcio pelo braço de volta para a rua. "
            "Instantes depois, o prédio inteiro sobre aquela adega desaba num rugido de madeira e pedra."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV action shot on 24mm lens in Pompeii, 79 AD. "
            "Your left hand grips Lucio's olive-green sleeve in the lower frame, pulling him backward as the two-story Roman building "
            "ahead collapses inward in a massive cloud of ash, sparks and falling masonry, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV action shot. Camera steps backward rapidly as the Roman building ahead collapses in a billow "
            "of grey dust and glowing embers at 24fps."
        ),
    },
    {
        "plano": 22,
        "id": "p22",
        "bloco": "Seq 4 · A Grande Virada",
        "enquadramento": "reflexo",
        "relogio": "21h00 · PORTA STABIA · EXAUSTÃO E ENXOFRE",
        "hud": {"vida": 68, "comida": 40, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": 44},
        "hud_evento": "tap",
        "sfx_cue": "fogo_tocha",
        "texto": (
            "Na fonte pública perto da Porta Stabia, você molha o rosto na água escura. "
            "No reflexo tremendo sob a tocha, seus olhos estão vermelhos de enxofre e o ar fica cada vez mais ácido."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV looking down into a stone Roman public water basin in Pompeii at night, 79 AD, "
            "lit by a flickering torch. Both ash-covered hands hold the stone rim in the lower frame; reflected in the trembling dark water "
            "is the exhausted face of a 22-year-old Roman man with short dark curly hair covered in white volcanic ash and red-rimmed eyes, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV reflection shot. Ripples move across the dark water in the stone basin, distorting the ash-covered "
            "reflection of your face under flickering orange torchlight at 24fps."
        ),
    },
    # BLOCO 5 · DECISÃO 4 (p23 a p27: 05:08 a 06:18)
    {
        "plano": 23,
        "id": "p23",
        "bloco": "Decisão 4",
        "enquadramento": "ambiente",
        "relogio": "DECISÃO 4 · 01h00 · O MAR RECUOU",
        "hud": {"vida": 68, "comida": 40, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "ondas_mar",
        "texto": (
            "Uma da manhã do dia vinte e cinco. Vocês alcançam a praia ao sul da muralha, "
            "mas o terremoto empurrou o mar para trás: dezenas de peixes batem na areia vulcânica exposta."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of the dark shoreline near Pompeii at night, 79 AD. "
            "The sea has anomalously receded exposing wet black volcanic sand littered with stranded fish and wooden rowboats "
            "struggling in violent churning surf, red volcanic lightning illuminating the ash clouds above, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this cinematic wide shot. Dark churning waves crash in the distance while red volcanic lightning flickers across "
            "the wet exposed shoreline and wooden boats at 24fps."
        ),
    },
    {
        "plano": 24,
        "id": "p24",
        "bloco": "Decisão 4",
        "enquadramento": "pov_companion",
        "relogio": "DECISÃO 4 · 01h15 · LÚCIO CAI NO CAIS",
        "hud": {"vida": 68, "comida": 40, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Um novo abalo sísmico derruba Lúcio entre as pedras do molhe. "
            "O tornozelo dele dobra com um estalo seco, e ele estende a mão suja de cinza olhando direto nos seus olhos."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking down on the stone pier of Pompeii at night, 79 AD. "
            "Lucio lies fallen among wet basalt stones clutching his injured ankle with one hand and reaching his other ash-covered hand "
            "upward toward the camera lens, while your right hand reaches down in the lower frame, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Lucio reaches his trembling ash-stained hand up toward the camera while your right hand "
            "clasps his wrist in the torchlight at 24fps."
        ),
    },
    {
        "plano": 25,
        "id": "p25",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_maos",
        "relogio": "01h20 · ARMADILHA NO CAIS DE POMPEIA",
        "hud": {"vida": 68, "comida": 40, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "Na praia escura, dezenas de fugitivos disputam os botes de madeira na arrebentação — "
            "sem saber que o recuo sísmico do mar transformou a água rasa numa armadilha mortal."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level on the coast of Pompeii, "
            "79 AD: on the left side, wooden rowboats tossing violently in dark surf; on the right side, the southern coastal stone "
            "road leading toward distant hills. Both weathered hands visible in the lower foreground, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. On the left, wooden boats pitch in the dark surf; on the right, torchlight flickers "
            "along the southern road while your hands gesture toward the road at 24fps."
        ),
    },
    {
        "plano": 26,
        "id": "p26",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "ambiente",
        "relogio": "01h40 · BARCOS AFUNDADOS PELA PEDRA-POMES",
        "hud": {"vida": 68, "comida": 40, "dinheiro_epoca": "6 Ases", "dinheiro_brl": 30, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "ondas_mar",
        "texto": (
            "O vento forte contra a costa e o tapete denso de pedra-pomes flutuante viram os botes rasos "
            "e impedem até a esquadra militar de Plínio, o Velho, de encostar na praia."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens of the dark sea at Pompeii, 79 AD. "
            "A wooden Roman rowboat capsizes in the violent shallow surf under a hail of floating pumice stones and crashing waves, "
            "illuminated by orange torchlight on the shore, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this dramatic maritime shot. Heavy dark waves crash over the wooden rowboat amidst floating pumice mats at 24fps."
        ),
    },
    {
        "plano": 27,
        "id": "p27",
        "bloco": "Seq 5 · O Preço Humano",
        "enquadramento": "pov_maos",
        "relogio": "04h00 · ÚLTIMAS MOEDAS PELA ROTA DO SUL",
        "hud": {"vida": 50, "comida": 20, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": 34},
        "hud_evento": "tap",
        "sfx_cue": "moedas",
        "texto": (
            "Para salvar Lúcio sem cair na armadilha do mar, você entrega seus últimos seis ases por um cajado de madeira "
            "e meia cabaça de água, apoiando o peso dele pela estrada sul além do Rio Sarno."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens on the southern road from Pompeii, 79 AD. "
            "Your left hand drops the last six bronze coins into a muleteer's palm while your right hand grips a sturdy wooden walking staff, "
            "ash-covered road stretching ahead in the dark, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Your left hand hands over the bronze coins while your right hand tightens around the wooden "
            "staff under falling grey ash at 24fps."
        ),
    },
    # BLOCO 6 · PONTO SEM VOLTA (p28 a p31: 06:18 a 07:14)
    {
        "plano": 28,
        "id": "p28",
        "bloco": "Seq 6 · Ponto Sem Volta",
        "enquadramento": "ambiente",
        "relogio": "06h30 · COLAPSO DA COLUNA A 300 GRAUS",
        "hud": {"vida": 50, "comida": 20, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Seis e meia da manhã. O som que vem do Vesúvio não é mais trovão: "
            "a coluna de vinte quilômetros perde sustentação e desaba sobre si mesma. "
            "Uma avalanche negra a trezentos graus desce a montanha a cem quilômetros por hora."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens from the southern hills looking back toward Pompeii at dawn, 79 AD. "
            "The colossal volcanic column of Mount Vesuvius collapses downward into a terrifying glowing black pyroclastic surge wall "
            "Consuming the plain toward the city with arcs of red lightning, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this epic historical shot. The colossal black pyroclastic cloud surges rapidly down the mountain slope with internal "
            "flashes of orange heat and lightning at 24fps."
        ),
    },
    {
        "plano": 29,
        "id": "p29",
        "bloco": "Seq 6 · Ponto Sem Volta",
        "enquadramento": "pov_maos",
        "relogio": "06h40 · O VALE CONTRA A CRISTA ALTA",
        "hud": {"vida": 50, "comida": 20, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "tick",
        "sfx_cue": "batimento_escolha",
        "texto": (
            "A nuvem ardente avança pelo vale. O reflexo de quem está exausto na estrada é se agachar atrás dos muros baixos de pedra — "
            "exatamente na calha por onde o fluxo mortal vai escoar."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV, shot on 24mm lens at eye level near Stabiae, 79 AD: "
            "on the left side, a steep rocky hillside path rising above the valley with the wet linen cloth in your left hand; "
            "on the right side, a low Roman stone wall in the valley floor. Both hands visible in the lower frame, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Your left hand raises the wet linen cloth toward the steep hill path on the left "
            "as dark ash wind sweeps past the stone wall on the right at 24fps."
        ),
    },
    {
        "plano": 30,
        "id": "p30",
        "bloco": "Seq 6 · Ponto Sem Volta",
        "enquadramento": "pov_maos",
        "relogio": "06h45 · ONDA TÉRMICA NO FUNDO DO VALE",
        "hud": {"vida": 50, "comida": 20, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "vento_cinza",
        "texto": (
            "Mais densa que o ar, a nuvem piroclástica corre colada ao chão do vale como uma enxurrada de fornalha, "
            "engolindo os muros da estrada e matando em um único segundo de choque térmico."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens looking down from a ridge as a dense, glowing grey-black pyroclastic surge "
            "sweeps over a low Roman stone wall in the valley below, instantly burying the road in smoking ash, "
            "both dirty hands gripping the rocky ledge in the lower foreground, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. The dense dark pyroclastic cloud engulfs the stone wall in the valley below while your "
            "hands grip the rock ledge in the foreground at 24fps."
        ),
    },
    {
        "plano": 31,
        "id": "p31",
        "bloco": "Seq 6 · Ponto Sem Volta",
        "enquadramento": "pov_acao",
        "relogio": "06h50 · CRISTA ALTA · PANO COM VINAGRE",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "thud",
        "sfx_cue": "riser_silencio",
        "silencio_dramatico_s": 1.50,
        "texto": (
            "No limite das forças, vocês escalam a crista alta acima da corrente densa. "
            "Suas mãos rasgam ao meio o pano de linho com vinagre trazido da padaria e o pressionam contra o nariz de Lúcio e o seu "
            "quando a borda de cinza ardente passa abaixo."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens on a high rocky hillside above the Sarno valley, 79 AD. "
            "Both burned, ash-caked hands press a torn wet linen cloth toward the lower camera frame and toward Lucio beside you "
            "as a wall of dark gray ash sweeps through the valley below, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this tense first-person POV shot. Both hands press the wet linen cloth firmly toward the lens as hot grey ash wind "
            "whips past on the hillside at 24fps."
        ),
    },
    # BLOCO 7 · O DIA SEGUINTE E REGISTRO HISTÓRICO (p32 a p36)
    {
        "plano": 32,
        "id": "p32",
        "bloco": "Seq 7 · O Dia Seguinte",
        "enquadramento": "ambiente",
        "relogio": "08h00 · POMPEIA SOTERRADA SOB 4 METROS",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "impacto",
        "sfx_cue": "impacto_grave",
        "texto": (
            "Quando o vento baixa, o silêncio na encosta é absoluto. "
            "Lá embaixo, Pompeia não existe mais: quatro metros de pedra-pomes e cinza branca cobrem cada telhado da cidade."
        ),
        "prompt_imagem": (
            "Cinematic wide shot on 24mm lens at dawn after the eruption of 79 AD. "
            "Looking down from the hillside of Stabiae across a ghostlike monochrome landscape buried under four meters of pale grey-white "
            "volcanic ash, with only the top of the Pompeii amphitheater eave barely visible and Mount Vesuvius smoking in the distance, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this somber cinematic wide shot. Pale gray ash drifts gently in the eerie quiet air over the buried city of Pompeii "
            "while dark smoke rises from the shattered crater of Vesuvius at 24fps."
        ),
    },
    {
        "plano": 33,
        "id": "p33",
        "bloco": "Seq 7 · O Dia Seguinte",
        "enquadramento": "detalhe",
        "relogio": "08h10 · 1.150 MOLDES ESCAVADOS NA CINZA",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": None},
        "hud_evento": "none",
        "sfx_cue": "vento_cinza",
        "texto": (
            "Na terra aos seus pés está a chave de ferro de uma padaria que agora dorme seis metros debaixo da cinza. "
            "Nos moldes de gesso de Giuseppe Fiorelli, mais de mil e cem pessoas foram encontradas onde hesitaram."
        ),
        "prompt_imagem": (
            "Cinematic macro close-up shot on 24mm lens on the ash-covered ground of the hillside in 79 AD. "
            "The heavy forged Roman iron cellar key on its leather cord lies half-covered in fine white volcanic ash beside a burnt "
            "wooden walking staff, pale amber sunlight breaking through sulfur mist, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this close-up shot. Fine white volcanic ash blows gently across the forged iron cellar key resting on the ground "
            "in pale morning light at 24fps."
        ),
    },
    {
        "plano": 34,
        "id": "p34",
        "bloco": "Seq 7 · O Dia Seguinte",
        "enquadramento": "pov_companion",
        "relogio": "08h20 · EVIDÊNCIA DEMOGRÁFICA REAL",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": 27},
        "hud_evento": "tap",
        "sfx_cue": "fogo_tocha",
        "texto": (
            "Ao seu lado, Lúcio abaixa o pano de linho e respira fundo. "
            "Pelos estudos arqueológicos de Pompeia, nove em cada dez moradores que buscaram abrigo em telhados ou adegas "
            "não saíram vivos da cidade."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens on the hillside at dawn, 79 AD. "
            "Lucio sits on a rock at eye level covered in white ash, lowering the stained linen cloth from his face and looking straight "
            "into the camera lens with tear-streaked relief while your hand rests on his shoulder in the lower frame, "
            "16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this emotional first-person POV shot. Lucio lowers the ash-stained cloth and exhales deeply in relief while your "
            "weathered hand rests on his shoulder at 24fps."
        ),
    },
    {
        "plano": 35,
        "id": "p35",
        "bloco": "Seq 7 · O Dia Seguinte",
        "enquadramento": "pov_maos",
        "relogio": "08h30 · SOBREVIVENTE DE POMPEIA",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": 27},
        "hud_evento": "tap",
        "sfx_cue": "passos_cinza",
        "texto": (
            "Olhe para as suas mãos cobertas de cinza. "
            "Sem casa, sem forno e sem uma única moeda de bronze no bolso — mas cada manobra técnica na hora certa "
            "manteve o seu peito subindo e descendo."
        ),
        "prompt_imagem": (
            "Photorealistic first-person POV shot on 24mm lens at eye level from the hillside overlooking the buried plain of Pompeii at dawn, 79 AD. "
            "Both exhausted, ash-caked hands with the faint oven burn scar rest open on your knees, "
            "pale golden sunbeams piercing the volcanic haze in the valley below, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this first-person POV shot. Both ash-covered hands rest on your knees and slowly close into fists as golden dawn light "
            "breaks through the smoke over the valley at 24fps."
        ),
    },
    {
        "plano": 36,
        "id": "p36",
        "bloco": "Seq 7 · O Dia Seguinte",
        "enquadramento": "ambiente",
        "relogio": "BAÍA DE NÁPOLES · 25 DE AGOSTO DE 79 D.C.",
        "hud": {"vida": 22, "comida": 10, "dinheiro_epoca": "0 Ases", "dinheiro_brl": 0, "chance": 27},
        "hud_evento": "thud",
        "sfx_cue": "estrondo_vulcao",
        "texto": (
            "Foi assim que quem leu os sinais da montanha conseguiu sobreviver ao dia em que o Vesúvio apagou Pompeia do mapa. "
            "Mas na próxima época da história, o relógio será ainda mais implacável."
        ),
        "prompt_imagem": (
            "Cinematic wide film still on 24mm lens of the Bay of Naples and smoking Mount Vesuvius at dawn after the 79 AD eruption. "
            "Dark ash clouds hang over the quiet sea and buried coastline under a bruised amber and charcoal sky, "
            "historical realism, subtle 35mm film grain, 16:9 widescreen, no text, no watermark."
        ),
        "prompt_movimento": (
            "Animate this final cinematic wide shot. Slow atmospheric camera push-in toward the smoking crater of Mount Vesuvius "
            "over the ash-shrouded Bay of Naples at 24fps."
        ),
    },
]

def _locacao_id_por_plano(p_num: int) -> str:
    if p_num in (1, 4, 5, 6, 7, 9, 10, 11):
        return "L01_PADARIA"
    if p_num in (2, 3, 8, 12, 13, 14, 15, 16, 17):
        return "L02_VIA_ABBONDANZA"
    if p_num in (18, 19, 20, 21, 22):
        return "L03_ADEGA_PORTA_STABIA"
    if p_num in (23, 24, 25, 26, 27):
        return "L04_PRAIA_MOLHE"
    return "L05_COLINA_ESTABIA"


PLANOS_36_POV: List[Dict[str, Any]] = []
for _idx, _spec in enumerate(RAW_36_PLANOS_POMPEIA):
    _item = dict(_spec)
    _pnum = int(_item["plano"])
    _item["locacao_id"] = _locacao_id_por_plano(_pnum)
    _item["companheiro_em_cena"] = _item["id"] in ("p05", "p18", "p21", "p24", "p31", "p34")
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
        f"[CONTRATO POV v4.0 HOLLYWOOD + DNA APROVADO] 36 planos validados (0 erros, 1 único reflexo={reflexos[0]}, 0 quiz A/B)."
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

    # Fallback neural barítono caso todas as cotas RPM diárias do Gemini TTS saturem no meio dos 36 blocos
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
    tmp_16 = wav_path.parent / f"_tmp16_{wav_path.stem}_{int(start_s * 100)}.wav"
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
    tmp_s = wav_path.parent / f"_tmp_loop_{wav_path.stem}_{dur_samples}.wav"
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


def construir_audio_master_8m24s_pompeia(dirs_ep: Dict[str, Path]) -> Path:
    global DURACAO_TOTAL_S, TOTAL_SAMPLES, SILENCIO_INICIO_S, SILENCIO_FIM_S
    audio_dir = dirs_ep["root"] / "audio"
    blocos_voz_dir = audio_dir / "blocos_fenrir"
    sfx_reais_dir = audio_dir / "sfx_reais"
    blocos_voz_dir.mkdir(parents=True, exist_ok=True)
    master_wav = audio_dir / "master_sobrevida_8m_pompeia_fenrir.wav"

    # 1. Limpa e mede a duração exata de fala de cada um dos 36 blocos (zero pausas mortas!)
    amostras_por_plano: Dict[str, np.ndarray] = {}
    duracoes_fala_s: Dict[str, float] = {}

    for p in PLANOS_36_POV:
        p_num = int(p["plano"])
        pid = p["id"]
        wav_bloco = sintetizar_bloco_fenrir_resiliente(blocos_voz_dir, p)

        # Limite de fala por bloco para respeitar teto de 15.0s (incluindo 1.50s de silêncio dramático no p31)
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

    # 2. Calcula janelas dinâmicas coladas na fala (respiro de 0.20s entre takes, zero buracos!)
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

    # Pré-carrega os SFX reais orgânicos (48kHz Estéreo, zero senoides!)
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

        # Eventos táteis do HUD (orgânicos, sem senoides!)
        hud_ev = p.get("hud_evento", "none")
        if hud_ev == "tap":
            _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=win_start + 0.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-10.0)
        elif hud_ev == "tick":
            _adicionar_no_barramento(timeline_sfx, tick_hud, start_s=win_start + 0.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-8.5)
        elif hud_ev == "thud":
            _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=win_start + 0.04, fade_in_s=0.02, fade_out_s=0.28, pan=0.0, gain_db=-9.5)
        elif hud_ev == "impacto":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.03, fade_in_s=0.02, fade_out_s=0.80, pan=0.0, gain_db=-10.5)

        # Foley Diegético Real da Cena
        cue = p.get("sfx_cue", "")
        if cue == "moedas":
            _adicionar_no_barramento(timeline_sfx, sfx_moedas, start_s=win_start + 0.30, fade_in_s=0.05, fade_out_s=0.55, pan=-0.18, gain_db=-9.5)
        elif cue == "estrondo_vulcao":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.20, fade_in_s=0.10, fade_out_s=1.20, pan=0.15, gain_db=-11.0)
            _adicionar_no_barramento(timeline_sfx, sfx_vento, start_s=win_start + 0.85, fade_in_s=0.50, fade_out_s=1.20, pan=-0.15, gain_db=-12.5)
        elif cue == "pedras_telhado":
            _adicionar_no_barramento(timeline_sfx, sfx_chuva_pedras, start_s=win_start + 0.25, fade_in_s=0.35, fade_out_s=0.90, pan=0.18, gain_db=-10.5)
            _adicionar_no_barramento(timeline_sfx, sfx_batidas[: int(2.2 * SR)], start_s=win_start + 1.10, fade_in_s=0.05, fade_out_s=0.45, pan=-0.20, gain_db=-9.0)
        elif cue == "forno_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_forno, start_s=win_start + 0.20, fade_in_s=0.35, fade_out_s=0.80, pan=-0.15, gain_db=-10.0)
            _adicionar_no_barramento(timeline_sfx, sfx_oficina[: int(3.5 * SR)], start_s=win_start + 0.70, fade_in_s=0.20, fade_out_s=0.60, pan=0.20, gain_db=-15.5)
        elif cue == "passos_cinza":
            _adicionar_no_barramento(timeline_sfx, sfx_passos, start_s=win_start + 0.30, fade_in_s=0.15, fade_out_s=0.45, pan=-0.12, gain_db=-10.5)
            _adicionar_no_barramento(timeline_sfx, sfx_passos, start_s=win_start + 3.40, fade_in_s=0.15, fade_out_s=0.45, pan=0.12, gain_db=-11.0)
        elif cue == "vento_cinza":
            _adicionar_no_barramento(timeline_sfx, sfx_vento, start_s=win_start + 0.18, fade_in_s=0.45, fade_out_s=1.10, pan=-0.20, gain_db=-12.5)
            _adicionar_no_barramento(timeline_sfx, sfx_chuva_pedras[: int(5.0 * SR)], start_s=win_start + 1.30, fade_in_s=0.40, fade_out_s=0.90, pan=0.20, gain_db=-13.0)
        elif cue == "batimento_escolha":
            _adicionar_no_barramento(timeline_sfx, sfx_coracao, start_s=win_start + 0.80, fade_in_s=0.40, fade_out_s=0.45, pan=0.0, gain_db=-3.5)
            _adicionar_no_barramento(timeline_sfx, sfx_coracao, start_s=max(win_start + 2.5, win_end - 5.5), fade_in_s=0.30, fade_out_s=0.40, pan=0.0, gain_db=-2.5)
            _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=max(win_start + 1.0, win_end - 0.95), fade_in_s=0.02, fade_out_s=0.25, pan=0.0, gain_db=-9.0)
        elif cue == "batidas_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_batidas, start_s=win_start + 0.25, fade_in_s=0.05, fade_out_s=0.55, pan=0.22, gain_db=-5.5)
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 2.10, fade_in_s=0.05, fade_out_s=0.80, pan=-0.15, gain_db=-11.5)
        elif cue == "oficina_madeira":
            _adicionar_no_barramento(timeline_sfx, sfx_oficina, start_s=win_start + 0.25, fade_in_s=0.25, fade_out_s=0.70, pan=-0.18, gain_db=-14.5)
        elif cue == "impacto_grave":
            _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=win_start + 0.12, fade_in_s=0.02, fade_out_s=0.90, pan=0.0, gain_db=-9.5)
        elif cue == "fogo_tocha":
            _adicionar_no_barramento(timeline_sfx, sfx_forno, start_s=win_start + 0.20, fade_in_s=0.35, fade_out_s=0.85, pan=0.15, gain_db=-11.0)
        elif cue == "ondas_mar":
            _adicionar_no_barramento(timeline_sfx, sfx_ondas, start_s=win_start + 0.18, fade_in_s=0.50, fade_out_s=1.20, pan=0.15, gain_db=-11.0)
        elif cue == "riser_silencio":
            riser_st = max(win_start + 0.20, SILENCIO_INICIO_S - 4.45)
            _adicionar_no_barramento(timeline_sfx, sfx_riser, start_s=riser_st, fade_in_s=0.60, fade_out_s=0.05, pan=0.0, gain_db=-11.5)

    # =========================================================================
    # BARRAMENTO BGM ORQUESTRAL EM 5 MOVIMENTOS DINÂMICOS (EQ Pocket Vocal)
    # =========================================================================
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

    # =========================================================================
    # SIDECHAIN DUCKING ASSIMÉTRICO SUAVE + SILÊNCIO DRAMÁTICO (1.50s no p31)
    # =========================================================================
    env_bgm = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.30, attack_ms=25.0, release_ms=400.0)
    env_sfx = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.52, attack_ms=20.0, release_ms=320.0)

    mix_stereo = timeline_voz + (timeline_bgm * env_bgm) + (timeline_sfx * env_sfx)

    sil_i0 = int(SILENCIO_INICIO_S * SR)
    sil_i1 = int(SILENCIO_FIM_S * SR)
    fade_pre = int(0.04 * SR)
    if sil_i0 - fade_pre > 0:
        mix_stereo[sil_i0 - fade_pre : sil_i0] *= np.linspace(1.0, 0.0, fade_pre, dtype=np.float32)[:, None]
    mix_stereo[sil_i0:sil_i1] = 0.0

    # Impacto cinematográfico exatamente na reentrada pós-silêncio (início do p32)
    _adicionar_no_barramento(mix_stereo, sfx_impacto, start_s=SILENCIO_FIM_S + 0.02, fade_in_s=0.02, fade_out_s=0.90, pan=0.0, gain_db=-9.5)

    tmp_pre = audio_dir / "_pre_master_8m24s.wav"
    with wave.open(str(tmp_pre), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        pcm16 = np.clip(mix_stereo * 32767.0, -32767, 32767).astype(np.int16)
        wf.writeframes(pcm16.tobytes())

    # Calibração Linear EBU R128 em 2 passes para -14.0 LUFS e True Peak <= -1.0 dBTP
    lufs_pre = _medir_ebur128_lufs(tmp_pre)
    delta_db = (-14.0) - lufs_pre
    tmp_pass1 = audio_dir / "_pass1_master_8m24s.wav"
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
    logger.info(f"[MASTER DE ÁUDIO DINÂMICO FENRIR CONCLUÍDO] {master_wav} ({DURACAO_TOTAL_S:.2f}s, {lufs_final:.2f} LUFS, 48kHz 24-bit)")
    return master_wav


# =============================================================================
# 3. VALIDAÇÃO DOS 36 START FRAMES POV INÉDITOS (1920x1080 PNG)
# =============================================================================
def validar_ou_gerar_start_frames_36_pov() -> Dict[str, Path]:
    inicializar_e_indexar_acervo_legado()
    gerador = GeradorImagemCLI()
    for idx, p in enumerate(PLANOS_36_POV):
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
# 5. MONTAGEM MASTER DINÂMICA COM HUD SOBREVIDA v2.0 (ZERO REVERSE, CORTE SECO)
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


def conformar_take_14s_hud_sobrevida(
    src_mp4: Path,
    dst_mp4: Path,
    plano: Dict[str, Any],
    primeiro_take: bool = False,
    ultimo_take: bool = False,
) -> Path:
    """
    Conforma o take do Firefly para a duração exata da fala (`duracao_s`) em
    movimento 100% progressivo para frente (ZERO reverse/boomerang) e corte seco
    nos takes internos, com HUD SOBREVIDA.
    """
    dur_s = float(plano["duracao_s"])
    raw_dur = _ffprobe_duracao_arquivo(src_mp4)
    pts_factor = max(1.0, (dur_s + 0.25) / max(1.0, raw_dur))

    hud = plano["hud"]
    vida = int(hud["vida"])
    comida = int(hud["comida"])
    din_ep = _escape_drawtext(str(hud["dinheiro_epoca"]))
    din_brl = int(hud["dinheiro_brl"])
    relogio = _escape_drawtext(str(plano["relogio"]))

    cor_vida = "0x3B7A57" if vida > 60 else ("0xC99738" if vida >= 30 else "0x9E2B25")
    bloco_titulo = str(plano.get("bloco") or "SOBREVIVÊNCIA").upper()
    hud_txt = _escape_drawtext(f"POMPEIA, 79 D.C.   |   {bloco_titulo}   |   {din_ep} (R$ {din_brl})")
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

    # Movimento 100% progressivo para frente (ZERO reverse/boomerang!) + interpolação 24fps + push-in óptico sutil
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
        "drawbox=x=36:y=28:w=660:h=76:color=0x2B2A28@0.72:t=fill,"
        f"drawbox=x=36:y=28:w=8:h=76:color={cor_vida}@0.95:t=fill,"
        f"drawtext=expansion=none:font='Consolas':text='{hud_txt}':fontcolor=0xEDE3CC@0.96:fontsize=21:x=58:y=40,"
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


def montar_master_8m24s_sobrevida(dirs_ep: Dict[str, Path], audio_master: Path) -> Path:
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
                f"[HUD SOBREVIDA {num:02d}/36] Conformando '{pl['id']}' ({pl['duracao_s']:.2f}s, progressivo sem reverse, 1080p, 24fps)..."
            )
            conformar_take_14s_hud_sobrevida(r_mp4, d_cap, pl, primeiro_take=is_first, ultimo_take=is_last)

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
        f"[MASTER DINÂMICO SOBREVIDA CONCLUÍDO] {master_final} ({dur_master:.2f}s, {master_final.stat().st_size / (1024 * 1024):.2f} MB)"
    )
    return master_final


def main() -> None:
    t0 = time.time()
    dirs_ep = criar_diretorios_episodio_isolado(EPISODIO_ID)
    validar_decupagem_36_planos_pov()

    # 1. Áudio Master dinâmico sem pausas longas com voz Fenrir + Foley Real
    audio_master = construir_audio_master_8m24s_pompeia(dirs_ep)

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
    mapa_sf = validar_ou_gerar_start_frames_36_pov()

    # 3. Fila + Worker do Adobe Firefly (Kling 2.5 Turbo)
    enfileirar_36_planos_no_firefly(EPISODIO_ID, PLANOS_36_POV, mapa_sf)
    executar_worker_firefly_36_planos(EPISODIO_ID, PLANOS_36_POV, concurrency=3)

    # 4. Montagem Master Final com HUD SOBREVIDA (zero reverse, corte seco)
    master_mp4 = montar_master_8m24s_sobrevida(dirs_ep, audio_master)
    print("=" * 80)
    print(f"[SUCESSO] VÍDEO MASTER SOBREVIDA GERADO NO FIREFLY: {master_mp4}")
    print(f"Duração exata sem pausas: {DURACAO_TOTAL_S:.2f}s | Tempo execução: {time.time() - t0:.1f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()
