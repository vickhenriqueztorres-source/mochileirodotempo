"""Produção Completa de Episódio de 60 Segundos no Adobe Firefly — SOBREVIDA v2.0 (POV Realista).

Episódio: Você Sobreviveria à Peste Negra? (Florença, abril de 1348)
ID: ep_sobrevida_60s_peste_pov
Duração: 60.00 segundos exatos (10 planos de 6.0s em paridade 1:1)
Voz Oficial: Fenrir (gemini-3.8-flash-tts, ~142 PPM, 48 kHz 24-bit, -14.0 LUFS)
Visual: POV Realista em 1ª pessoa (lente 24mm, mãos do Nico, Bettina, HUD de sobrevivência)
Animação: Adobe Firefly (Kling 2.5 Turbo, 1080p, 16:9, 24fps) — Política Zero-Reuso
"""

from __future__ import annotations

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
from typing import Any, Dict, List

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from contratos.integridade_assets import (
    criar_diretorios_episodio_isolado,
    inicializar_e_indexar_acervo_legado,
    validar_e_registrar_asset_inedito,
    validar_filtro_video_sem_reverse,
    validar_paridade_1_para_1_blocos_planos,
)
from grafo.direcao.engenheiro_prompt_imagem import (
    gerar_bloco_diretor_cenas_pov,
    injetar_dna_consistencia_pov,
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
    format="%(asctime)s | %(levelname)-5s | [SOBREVIDA 60S FIREFLY] %(message)s",
)
logger = logging.getLogger("sobrevida_60s_firefly")

EPISODIO_ID = "ep_sobrevida_60s_peste_pov"
SR = 48000
DURACAO_TOTAL_S = 60.0
TOTAL_SAMPLES = int(SR * DURACAO_TOTAL_S)


# =============================================================================
# 1. ESPECIFICAÇÃO DO EPISÓDIO E DOS 10 PLANOS POV (60.0s = 10 x 6.0s)
# =============================================================================
EPISODIO_META: Dict[str, Any] = {
    "perigo": "Peste Negra",
    "lugar": "Florença, Itália",
    "lugar_en": "Florence, Italy",
    "data": "abril de 1348",
    "ano": "1348",
    "papel_do_jogador": "tecelão de lã, 20 anos",
    "companheiro": {
        "nome": "Bettina",
        "descricao_visual": "a young woman around 22, olive skin, dark braided hair under a cream linen coif, dark brown eyes, worn terracotta tunic",
        "marcas_fixas": ["linen coif", "small mole on left cheek", "wooden spindle in belt"],
    },
    "objeto_plantado": {
        "objeto": "a wax-sealed guild safe-conduct pass on folded parchment",
    },
    "locacoes": [
        {
            "id": "L01",
            "descricao": "dim medieval wool workshop in 1348 Florence, wooden looms, coarse wool bales, dusty morning shafts",
        },
        {
            "id": "L02",
            "descricao": "narrow stone alley in 1348 Florence, timber overhangs, wooden doors marked with red crosses, pale fog",
        },
        {
            "id": "L03",
            "descricao": "dark wooden stairwell inside a medieval tenement in Florence, stone steps, a copper water basin on a stool",
        },
        {
            "id": "L04",
            "descricao": "muddy southern city gate of 1348 Florence under evening rain, flickering torches, armed commune guards",
        },
        {
            "id": "L05",
            "descricao": "muddy hillside overlooking medieval Florence at dusk, distant Duomo dome and smoke rising from the city",
        },
    ],
}

PLANOS_60S_POV: List[Dict[str, Any]] = [
    {
        "id": "p01_abertura_hud",
        "beat_id": "B0.1",
        "movimento": "ritual",
        "texto": "Florença, abril de mil trezentos e quarenta e oito. Vida: cheia. Comida: cheia. Suas barras estão cheias. Por enquanto.",
        "palavras": 19,
        "duracao_s": 6.0,
        "janela_s": [0.0, 6.0],
        "enquadramento": "pov_maos",
        "pov_acao": "both hands open a worn leather pouch on a rough wooden table, counting twelve medieval silver coins",
        "maos_visiveis": True,
        "corpo_estado": "inteiro",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L01",
        "relogio": "DIA 1 · FALTAM 6 SEMANAS",
        "luz": "amanhecer",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 SOLDOS", "dinheiro_brl": 60},
        "hud_bip": True,
        "fato_ids": ["F01"],
    },
    {
        "id": "p02_beco_sinos",
        "beat_id": "B1.1",
        "movimento": "situa",
        "texto": "Metade da cidade vai morrer até agosto. Sua chance base de sair vivo é de quarenta e cinco por cento.",
        "palavras": 20,
        "duracao_s": 6.0,
        "janela_s": [6.0, 12.0],
        "enquadramento": "aberto",
        "pov_acao": None,
        "maos_visiveis": False,
        "corpo_estado": "inteiro",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L02",
        "relogio": "DIA 2 · CHANCE BASE 45%",
        "luz": "amanhecer",
        "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 SOLDOS", "dinheiro_brl": 60},
        "hud_bip": True,
        "fato_ids": ["F01"],
    },
    {
        "id": "p03_fardos_la",
        "beat_id": "B2.1",
        "movimento": "ameaca",
        "texto": "Olhe para as suas mãos no tear: a lã crua que chegou hoje do porto está viva de pulgas.",
        "palavras": 19,
        "duracao_s": 6.0,
        "janela_s": [12.0, 18.0],
        "enquadramento": "pov_maos",
        "pov_acao": "both hands untying coarse hemp rope around a dusty bale of raw wool on a workbench",
        "maos_visiveis": True,
        "corpo_estado": "inteiro",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L01",
        "relogio": "DIA 5 · OFICINA DE LÃ",
        "luz": "dia",
        "hud": {"vida": 100, "comida": 95, "dinheiro_epoca": "12 SOLDOS", "dinheiro_brl": 60},
        "hud_bip": False,
        "fato_ids": ["F02"],
    },
    {
        "id": "p04_bettina_medo",
        "beat_id": "B2.1",
        "movimento": "ameaca",
        "texto": "Ao seu lado, Bettina para o tear com a mão trêmula. O mestre da oficina acabou de cair com febre.",
        "palavras": 20,
        "duracao_s": 6.0,
        "janela_s": [18.0, 24.0],
        "enquadramento": "pov_companheiro",
        "pov_acao": "your right hand rests on the wooden loom frame while Bettina looks straight into your eyes in fear",
        "maos_visiveis": True,
        "corpo_estado": "inteiro",
        "animar": True,
        "companheiro_em_cena": True,
        "locacao_id": "L01",
        "relogio": "DIA 5 · DECISÃO CHEGANDO",
        "luz": "dia",
        "hud": {"vida": 95, "comida": 90, "dinheiro_epoca": "12 SOLDOS", "dinheiro_brl": 60},
        "hud_bip": False,
        "fato_ids": ["F02"],
    },
    {
        "id": "p05_escolha_ab",
        "beat_id": "B2.2",
        "movimento": "opcoes",
        "texto": "Você tem duas opções. Opção A: largar a oficina. Opção B: continuar batendo a lã. Escolha a sua.",
        "palavras": 18,
        "duracao_s": 6.0,
        "janela_s": [24.0, 30.0],
        "enquadramento": "escolha_ab",
        "pov_acao": "both hands open and hesitant in the lower frame: on the left the bright door to the alley, on the right the dusty wool loom",
        "maos_visiveis": True,
        "corpo_estado": "inteiro",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L01",
        "relogio": "DECISÃO · A: SAIR | B: FICAR",
        "luz": "dia",
        "hud": {"vida": 95, "comida": 90, "dinheiro_epoca": "12 SOLDOS", "dinheiro_brl": 60},
        "hud_bip": True,
        "fato_ids": ["F02"],
    },
    {
        "id": "p06_consequencia_beco",
        "beat_id": "B3.1",
        "movimento": "consequencia",
        "texto": "Você larga o tear e perde o aluguel. Na rua, guardas trancam casas inteiras com as famílias dentro.",
        "palavras": 18,
        "duracao_s": 6.0,
        "janela_s": [30.0, 36.0],
        "enquadramento": "pov_olho",
        "pov_acao": "left hand pulls a coarse grey linen sleeve over nose and mouth while stepping backward in the narrow stone alley",
        "maos_visiveis": True,
        "corpo_estado": "desgastado",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L02",
        "relogio": "SEMANA 2 · VIDA -15 | COMIDA -25",
        "luz": "fim_de_tarde",
        "hud": {"vida": 80, "comida": 65, "dinheiro_epoca": "8 SOLDOS", "dinheiro_brl": 40},
        "hud_bip": True,
        "fato_ids": ["F03"],
    },
    {
        "id": "p07_reflexo_bacia",
        "beat_id": "B4.1",
        "movimento": "ameaca",
        "texto": "Trancar a janela não salva ninguém: as pulgas descem do forro de palha. Na água, seu rosto já está exausto.",
        "palavras": 20,
        "duracao_s": 6.0,
        "janela_s": [36.0, 42.0],
        "enquadramento": "reflexo",
        "pov_acao": "both dirty hands hold the rim of a copper water basin on the dark stairs, looking down at your pale reflection in the trembling water",
        "maos_visiveis": True,
        "corpo_estado": "desgastado",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L03",
        "relogio": "SEMANA 4 · VIRADA DO FORRO",
        "luz": "vela",
        "hud": {"vida": 45, "comida": 40, "dinheiro_epoca": "6 SOLDOS", "dinheiro_brl": 30},
        "hud_bip": True,
        "fato_ids": ["F05"],
    },
    {
        "id": "p08_portao_salvo_conduto",
        "beat_id": "B6.1",
        "movimento": "consequencia",
        "texto": "Com a Vida em vinte e cinco, sua mão trêmula ergue o salvo-conduto de cera no portão sul.",
        "palavras": 18,
        "duracao_s": 6.0,
        "janela_s": [42.0, 48.0],
        "enquadramento": "pov_maos",
        "pov_acao": "trembling bruised right hand holding up a wax-sealed parchment pass toward a rain-soaked guard torch at the city gate",
        "maos_visiveis": True,
        "corpo_estado": "no_limite",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L04",
        "relogio": "SEMANA 5 · PONTO SEM VOLTA",
        "luz": "noite",
        "hud": {"vida": 25, "comida": 20, "dinheiro_epoca": "2 SOLDOS", "dinheiro_brl": 10},
        "hud_bip": True,
        "silencio_dramatico_s": [47.20, 48.10],
        "fato_ids": ["F04"],
    },
    {
        "id": "p09_porta_bettina",
        "beat_id": "B8.1",
        "movimento": "verdade",
        "texto": "Cinquenta mil pessoas morreram em Florença. Quem ficou na oficina fechada teve menos de trinta por cento de chance.",
        "palavras": 19,
        "duracao_s": 6.0,
        "janela_s": [48.0, 54.0],
        "enquadramento": "detalhe",
        "pov_acao": None,
        "maos_visiveis": False,
        "corpo_estado": "no_limite",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L02",
        "relogio": "DADOS REAIS · 50 MIL MORTOS",
        "luz": "fim_de_tarde",
        "hud": {"vida": 25, "comida": 20, "dinheiro_epoca": "2 SOLDOS", "dinheiro_brl": 10},
        "hud_bip": False,
        "fato_ids": ["F01", "F03"],
    },
    {
        "id": "p10_colina_resultado",
        "beat_id": "B8.2",
        "movimento": "resultado",
        "texto": "Sua chance final: trinta e um por cento. Comenta a sua porcentagem. O próximo perigo pode não ser tão gentil.",
        "palavras": 20,
        "duracao_s": 6.0,
        "janela_s": [54.0, 60.0],
        "enquadramento": "pov_olho",
        "pov_acao": "dirty exhausted hands resting on muddy knees in the lower frame while looking down from a hill at Florence under smoke at dusk",
        "maos_visiveis": True,
        "corpo_estado": "no_limite",
        "animar": True,
        "companheiro_em_cena": False,
        "locacao_id": "L05",
        "relogio": "SUA CHANCE FINAL: 31%",
        "luz": "fim_de_tarde",
        "hud": {"vida": 25, "comida": 20, "dinheiro_epoca": "2 SOLDOS", "dinheiro_brl": 10},
        "hud_bip": True,
        "fato_ids": ["F01"],
    },
]


# =============================================================================
# 2. GERAÇÃO DOS PROMPTS DE IMAGEM E MOVIMENTO (cenas.diretor v1.0.0)
# =============================================================================
def preparar_cenas_diretor_pov() -> List[Dict[str, Any]]:
    entrada_diretor = {
        "bloco": 1,
        "episodio": EPISODIO_META,
        "planos": PLANOS_60S_POV,
    }
    pacote_cenas = gerar_bloco_diretor_cenas_pov(entrada_diretor)
    cenas_Por_id = {c["id"]: c for c in pacote_cenas["cenas"]}

    for p in PLANOS_60S_POV:
        cid = p["id"]
        cena = cenas_Por_id[cid]
        p["prompt_imagem"] = cena["prompt"]
        # Prompt de movimento realista 24fps seguro para o Kling 2.5 Turbo no Firefly
        p["prompt_video"] = (
            "Photorealistic first-person POV 24mm cinematic shot in 1348 Florence. "
            f"{cena.get('prompt_movimento') or 'Subtle handheld camera breathing, natural flickering candlelight and drifting dust motes at 24fps.'} "
            "Realistic historical textures, subtle 35mm film grain, no text."
        )
    return PLANOS_60S_POV


# =============================================================================
# 3. SÍNTESE VOCAL NEURAL (FENRIR) + MIXAGEM DIEGÉTICA REAL (-14.0 LUFS, 60.0s)
# =============================================================================
def _ler_wav_stereo_f32(
    wav_path: Path,
    start_s: float = 0.0,
    max_dur_s: float | None = None,
    af_extra: str = "",
) -> np.ndarray:
    """Lê WAV em 48kHz Estéreo float32 [-1.0, 1.0], aplicando filtros FFmpeg opcionais."""
    tmp_16 = wav_path.parent / f"_tmp16_{wav_path.stem}_{int(start_s*100)}.wav"
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


def _aplicar_fade_e_pan(
    stereo: np.ndarray,
    fade_in_s: float = 0.04,
    fade_out_s: float = 0.18,
    pan: float = 0.0,
    gain_db: float = 0.0,
) -> np.ndarray:
    """Aplica fade-in/out suaves, pan estéreo (-1.0=L, +1.0=R) e ganho em dB."""
    if len(stereo) == 0:
        return stereo
    out = stereo.copy()
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
    return out


def _adicionar_no_barramento(
    bus: np.ndarray,
    seg: np.ndarray,
    start_s: float,
    fade_in_s: float = 0.04,
    fade_out_s: float = 0.18,
    pan: float = 0.0,
    gain_db: float = 0.0,
) -> None:
    """Insere segmento estéreo no barramento de 60.0s com fades e pan."""
    if len(seg) == 0:
        return
    proc = _aplicar_fade_e_pan(seg, fade_in_s=fade_in_s, fade_out_s=fade_out_s, pan=pan, gain_db=gain_db)
    i0 = max(0, int(start_s * SR))
    i1 = min(TOTAL_SAMPLES, i0 + len(proc))
    if i1 > i0:
        bus[i0:i1] += proc[: i1 - i0]


def _calcular_envelope_sidechain_suave(
    voice_stereo: np.ndarray,
    duck_gain: float = 0.32,
    attack_ms: float = 25.0,
    release_ms: float = 380.0,
) -> np.ndarray:
    """Calcula curva suave de sidechain ducking assimétrico (attack rápido, release lento sem bombeamento)."""
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
    """Mede o Integrated Loudness (I) em LUFS via filtro ebur128 do FFmpeg."""
    res = subprocess.run(
        ["ffmpeg", "-nostats", "-i", str(wav_path), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    matches = re.findall(r"I:\s*(-?\d+\.\d+)\s*LUFS", res.stderr)
    return float(matches[-1]) if matches else -14.0


def construir_audio_master_60s_fenrir(dirs_ep: Dict[str, Path]) -> Path:
    audio_dir = dirs_ep["root"] / "audio"
    blocos_voz_dir = audio_dir / "blocos_fenrir"
    sfx_reais_dir = audio_dir / "sfx_reais"
    blocos_voz_dir.mkdir(parents=True, exist_ok=True)
    master_wav = audio_dir / "master_sobrevida_60s_fenrir.wav"

    if master_wav.is_file() and master_wav.stat().st_size > 5_000_000:
        logger.info(f"[ÁUDIO MASTER EXISTENTE] {master_wav}")
        return master_wav

    timeline_voz = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    timeline_sfx = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)
    timeline_bgm = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float32)

    for idx, p in enumerate(PLANOS_60S_POV):
        pid = p["id"]
        wav_bloco = blocos_voz_dir / f"{idx + 1:02d}_{pid}.wav"
        if not wav_bloco.is_file() or wav_bloco.stat().st_size < 15_000:
            logger.info(f"[TTS FENRIR {idx + 1:02d}/10] Sintetizando '{pid}'...")
            modelos_tts = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts", "gemini-3.8-flash-lite-tts"]
            sintetizado = False
            for tentativa in range(4):
                for mod_tts in modelos_tts:
                    try:
                        sintetizar_voz_gemini_com_fallback(
                            texto=p["texto"],
                            output_path=wav_bloco,
                            voice_name="Fenrir",
                            model_name=mod_tts,
                            sample_rate=SR,
                        )
                        sintetizado = True
                        break
                    except Exception as e_tts:
                        logger.warning(f"  ! Aviso TTS ({mod_tts}, tentativa {tentativa + 1}): {e_tts}. Aguardando 5s...")
                        time.sleep(5.0)
                if sintetizado:
                    break
            if not sintetizado:
                raise RuntimeError(f"Falha ao sintetizar TTS Fenrir para {pid}")

        # Trim de silêncios e EQ vocal (highpass=75Hz + presença limpa)
        win_start, win_end = float(p["janela_s"][0]), float(p["janela_s"][1])
        if idx == 0:
            t_in, max_dur = win_start + 0.18, 5.45
        elif idx == 4:
            # Escolha A/B: aproveita janela maior para evitar aceleração excessiva da voz
            t_in, max_dur = win_start + 0.12, 5.60
        elif idx == 7:
            # Plano 8: termina antes de 47.20s para o Silêncio Dramático absoluto (47.20s–48.10s)
            t_in, max_dur = win_start + 0.18, 4.85
        else:
            t_in, max_dur = win_start + 0.22, 5.45

        tmp_mono = blocos_voz_dir / f"_mono_{pid}.wav"
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(wav_bloco),
                "-af", (
                    "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-42dB:"
                    "stop_periods=-1:stop_duration=0.14:stop_threshold=-45dB,"
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

        # Micro fade-in/out e normalização RMS consistente (-17.8 dBFS)
        n_s = len(samples)
        fi, fo = min(n_s, int(0.025 * SR)), min(n_s, int(0.035 * SR))
        if fi > 0:
            samples[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
        if fo > 0:
            samples[n_s - fo :] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
        rms = float(np.sqrt(np.mean(samples**2)) + 1e-9)
        samples = np.clip(samples * ((10.0 ** (-17.8 / 20.0)) / rms), -0.88, 0.88)

        i0 = int(t_in * SR)
        i1 = min(TOTAL_SAMPLES, i0 + len(samples))
        seg_len = i1 - i0
        timeline_voz[i0:i1, 0] = samples[:seg_len]
        timeline_voz[i0:i1, 1] = samples[:seg_len]

    # =========================================================================
    # BARRAMENTO BGM ACÚSTICO EM 3 ATOS (Com EQ Pocket em 1.4kHz-2.8kHz para a voz)
    # =========================================================================
    eq_pocket_bgm = "highpass=f=40,equalizer=f=1450:t=q:w=1.2:g=-3.8,equalizer=f=2800:t=q:w=1.4:g=-3.2"
    bgm_cordas = _ler_wav_stereo_f32(
        sfx_reais_dir / "bgm_cordas_sombrias_florenca.wav",
        start_s=0.0,
        max_dur_s=28.0,
        af_extra=eq_pocket_bgm,
    )
    bgm_decisao = _ler_wav_stereo_f32(
        sfx_reais_dir / "bgm_pulso_decisao.wav",
        start_s=0.0,
        max_dur_s=26.0,
        af_extra=eq_pocket_bgm,
    )
    # Ato I (0.0s - 24.5s): Cordas sombrias em Florença
    _adicionar_no_barramento(timeline_bgm, bgm_cordas[: int(24.5 * SR)], start_s=0.0, fade_in_s=0.25, fade_out_s=1.5, pan=0.0, gain_db=-7.5)
    # Ato II (23.2s - 47.20s): Pulso tenso de Decisão e Fuga (corta exatamente no Silêncio Dramático!)
    _adicionar_no_barramento(timeline_bgm, bgm_decisao[: int(24.0 * SR)], start_s=23.2, fade_in_s=1.4, fade_out_s=0.10, pan=0.0, gain_db=-9.5)
    # Ato III (48.10s - 60.0s): Retorno solene das cordas sombrias pós-silêncio
    _adicionar_no_barramento(timeline_bgm, bgm_cordas[int(4.0 * SR) : int(16.0 * SR)], start_s=48.10, fade_in_s=0.18, fade_out_s=1.4, pan=0.0, gain_db=-7.0)

    # =========================================================================
    # BARRAMENTO DE FOLEY DIEGÉTICO REAL PLANO A PLANO (ZERO SENOIDES!)
    # =========================================================================
    tap_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_hud_tap_organico.wav", max_dur_s=0.45, af_extra="lowpass=f=3200")
    tick_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_hud_tick_mecanico.wav", max_dur_s=0.35, af_extra="lowpass=f=3600")
    thud_hud = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_thud_grave.wav", max_dur_s=0.90, af_extra="lowpass=f=450")
    whoosh_leve = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_whoosh_transicao_leve.wav", max_dur_s=1.6, af_extra="lowpass=f=2400")
    vento_escuro = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_whoosh_vento_escuro.wav", max_dur_s=5.5, af_extra="lowpass=f=1600")

    # P01 (0.0s - 6.0s): Moedas de prata reais caindo na bancada de madeira + toque orgânico de HUD
    sfx_moedas = _ler_wav_stereo_f32(sfx_reais_dir / "sfx_p01_moedas_madeira.wav", start_s=0.05, max_dur_s=2.8, af_extra="highpass=f=180,lowpass=f=7500")
    _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=0.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-10.0)
    _adicionar_no_barramento(timeline_sfx, sfx_moedas, start_s=0.35, fade_in_s=0.05, fade_out_s=0.60, pan=-0.18, gain_db=-9.5)

    # P02 (6.0s - 12.0s): Sino de igreja de bronze distante no beco + vento frio da manhã
    sfx_sino = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p02_sino_igreja_bronze.wav",
        start_s=0.10,
        max_dur_s=5.5,
        af_extra="highpass=f=110,lowpass=f=2200,aecho=0.8:0.7:120:0.25",
    )
    _adicionar_no_barramento(timeline_sfx, sfx_sino, start_s=5.95, fade_in_s=0.08, fade_out_s=1.40, pan=0.28, gain_db=-14.5)
    _adicionar_no_barramento(timeline_sfx, vento_escuro, start_s=6.10, fade_in_s=0.40, fade_out_s=1.20, pan=-0.20, gain_db=-14.0)

    # P03 (12.0s - 18.0s): Fricção de madeira e corda na oficina de lã
    sfx_oficina = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p03_oficina_madeira.wav",
        start_s=0.20,
        max_dur_s=4.5,
        af_extra="highpass=f=120,lowpass=f=1800",
    )
    _adicionar_no_barramento(timeline_sfx, whoosh_leve, start_s=11.85, fade_in_s=0.08, fade_out_s=0.45, pan=-0.15, gain_db=-15.0)
    _adicionar_no_barramento(timeline_sfx, sfx_oficina, start_s=12.15, fade_in_s=0.25, fade_out_s=0.90, pan=-0.22, gain_db=-16.5)

    # P04 (18.0s - 24.0s): Bettina para o tear (toque seco de madeira + subida sutil de tensão antes da Escolha)
    sfx_riser = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_riser_tensao.wav",
        start_s=5.5,
        max_dur_s=3.2,
        af_extra="lowpass=f=1800",
    )
    _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=18.05, fade_in_s=0.01, fade_out_s=0.15, pan=0.20, gain_db=-11.0)
    _adicionar_no_barramento(timeline_sfx, sfx_riser, start_s=21.10, fade_in_s=0.80, fade_out_s=0.20, pan=0.0, gain_db=-15.5)

    # P05 (24.0s - 30.0s): Escolha A/B — Batimento cardíaco humano real + tick mecânico de relógio
    sfx_coracao = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p05_batimento_cardiaco_real.wav",
        start_s=0.20,
        max_dur_s=5.6,
        af_extra="highpass=f=32,lowpass=f=220,equalizer=f=65:t=q:w=1.1:g=4.5",
    )
    _adicionar_no_barramento(timeline_sfx, tick_hud, start_s=24.02, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-8.5)
    _adicionar_no_barramento(timeline_sfx, sfx_coracao, start_s=24.25, fade_in_s=0.35, fade_out_s=0.35, pan=0.0, gain_db=-4.0)
    _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=29.15, fade_in_s=0.02, fade_out_s=0.25, pan=0.0, gain_db=-9.5)

    # P06 (30.0s - 36.0s): Guardas pregando/batendo tábuas nas portas + queda da barra de Dinheiro (35%)
    sfx_batidas_porta = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p06_batidas_madeira_porta.wav",
        start_s=0.0,
        max_dur_s=4.5,
        af_extra="highpass=f=70,lowpass=f=2600,aecho=0.8:0.6:85:0.22",
    )
    _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=30.04, fade_in_s=0.02, fade_out_s=0.28, pan=-0.10, gain_db=-10.0)
    _adicionar_no_barramento(timeline_sfx, sfx_batidas_porta, start_s=30.40, fade_in_s=0.05, fade_out_s=0.50, pan=0.25, gain_db=-5.5)

    # P07 (36.0s - 42.0s): Vela de sebo crepitando na escada escura + queda de Vida (55%)
    sfx_fogo_vela = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p07_fogo_tocha_vela.wav",
        start_s=0.5,
        max_dur_s=5.8,
        af_extra="highpass=f=160,lowpass=f=5200",
    )
    _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=36.04, fade_in_s=0.02, fade_out_s=0.28, pan=0.10, gain_db=-10.5)
    _adicionar_no_barramento(timeline_sfx, sfx_fogo_vela, start_s=36.05, fade_in_s=0.25, fade_out_s=0.55, pan=-0.15, gain_db=-10.0)

    # P08 (42.0s - 47.20s): Chuva noturna e passos na lama no Portão Sul (corta a seco em 47.20s!)
    sfx_chuva = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_p08_chuva_passos_portao.wav",
        start_s=0.5,
        max_dur_s=5.15,
        af_extra="highpass=f=120,lowpass=f=4800",
    )
    _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=42.04, fade_in_s=0.01, fade_out_s=0.12, pan=0.0, gain_db=-10.5)
    _adicionar_no_barramento(timeline_sfx, sfx_chuva, start_s=42.05, fade_in_s=0.25, fade_out_s=0.08, pan=0.12, gain_db=-11.0)

    # P09 (48.10s - 54.0s): Impacto cinematográfico pós-silêncio + vento noturno na porta lacrada de Bettina
    sfx_impacto = _ler_wav_stereo_f32(
        sfx_reais_dir / "sfx_impact_cinematico.wav",
        start_s=0.0,
        max_dur_s=3.5,
        af_extra="lowpass=f=1400",
    )
    _adicionar_no_barramento(timeline_sfx, sfx_impacto, start_s=48.12, fade_in_s=0.02, fade_out_s=0.80, pan=0.0, gain_db=-11.5)
    _adicionar_no_barramento(timeline_sfx, vento_escuro, start_s=48.35, fade_in_s=0.35, fade_out_s=0.90, pan=-0.18, gain_db=-13.5)

    # P10 (54.0s - 60.0s): Colina sobre Florença — brasa distante + vento + cravação orgânica do placar (31%)
    _adicionar_no_barramento(timeline_sfx, tap_hud, start_s=54.05, fade_in_s=0.01, fade_out_s=0.14, pan=0.0, gain_db=-9.5)
    _adicionar_no_barramento(timeline_sfx, thud_hud, start_s=54.08, fade_in_s=0.02, fade_out_s=0.30, pan=0.0, gain_db=-11.0)
    _adicionar_no_barramento(timeline_sfx, sfx_fogo_vela, start_s=54.15, fade_in_s=0.30, fade_out_s=1.10, pan=0.18, gain_db=-12.5)

    # =========================================================================
    # SIDECHAIN DUCKING ASSIMÉTRICO SUAVE + SILÊNCIO DRAMÁTICO (47.20s - 48.10s)
    # =========================================================================
    env_bgm = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.30, attack_ms=25.0, release_ms=400.0)
    env_sfx = _calcular_envelope_sidechain_suave(timeline_voz, duck_gain=0.52, attack_ms=20.0, release_ms=320.0)

    mix_stereo = timeline_voz + (timeline_bgm * env_bgm) + (timeline_sfx * env_sfx)

    # Silêncio Dramático absoluto antes do desfecho (47.20s a 48.10s)
    sil_i0 = int(47.20 * SR)
    sil_i1 = int(48.10 * SR)
    fade_pre = int(0.04 * SR)
    if sil_i0 - fade_pre > 0:
        mix_stereo[sil_i0 - fade_pre : sil_i0] *= np.linspace(1.0, 0.0, fade_pre, dtype=np.float32)[:, None]
    mix_stereo[sil_i0:sil_i1] = 0.0

    tmp_pre = audio_dir / "_pre_master_60s.wav"
    with wave.open(str(tmp_pre), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        pcm16 = np.clip(mix_stereo * 32767.0, -32767, 32767).astype(np.int16)
        wf.writeframes(pcm16.tobytes())

    # Calibração Linear EBU R128 em 2 passes para exatamente -14.0 LUFS e True Peak <= -1.0 dBTP (sem bombeamento de loudnorm)
    lufs_pre = _medir_ebur128_lufs(tmp_pre)
    delta_db = (-14.0) - lufs_pre
    tmp_pass1 = audio_dir / "_pass1_master_60s.wav"
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
    logger.info(f"[MASTER DE ÁUDIO FENRIR CONCLUÍDO] {master_wav} ({lufs_final:.2f} LUFS, 48kHz 24-bit)")
    return master_wav


# =============================================================================
# 4. GERAÇÃO DOS 10 START FRAMES POV INÉDITOS (NANO BANANA 2 / GEMINI IMAGE)
# =============================================================================
def gerar_start_frames_pov_ineditos() -> Dict[str, Path]:
    from PIL import Image
    inicializar_e_indexar_acervo_legado()
    dirs = criar_diretorios_episodio_isolado(EPISODIO_ID)
    sf_dir = dirs["start_frames"]
    artifact_dir = Path(r"C:\Users\brend\.gemini\antigravity\brain\867cb782-904b-4b01-94d3-9e25fcbc7a95")

    mapa_artefatos = {
        "p01_abertura_hud": "p01_abertura_hud_1793223364718.jpg",
        "p02_beco_sinos": "p02_beco_sinos_1793223383347.jpg",
        "p03_fardos_la": "p03_fardos_la_1793223406628.jpg",
        "p04_bettina_medo": "p04_bettina_medo_1793223436052.jpg",
        "p05_escolha_ab": "p05_escolha_ab_v2_1793223503732.jpg",
        "p06_consequencia_beco": "p06_consequencia_beco_1793223372838.jpg",
        "p07_reflexo_bacia": "p07_reflexo_bacia_1793223394128.jpg",
        "p08_portao_salvo_conduto": "p08_portao_salvo_conduto_1793223418269.jpg",
        "p09_porta_bettina": "p09_porta_bettina_1793223445405.jpg",
        "p10_colina_resultado": "p10_colina_resultado_1793223477141.jpg",
    }

    for pid, fname in mapa_artefatos.items():
        dst_png = sf_dir / f"{pid}.png"
        src_jpg = artifact_dir / fname
        if not dst_png.is_file() and src_jpg.is_file():
            img = Image.open(src_jpg).convert("RGB").resize((1920, 1080), Image.Resampling.LANCZOS)
            img.save(dst_png, format="PNG", optimize=True)
            logger.info(f"[START FRAME POV CONVERTIDO 1920x1080 PNG] {dst_png.name}")

    gerador = GeradorImagemCLI()
    for idx, p in enumerate(PLANOS_60S_POV):
        pid = p["id"]
        logger.info(f"[START FRAME POV {idx + 1:02d}/10] Validando imagem 16:9 para '{pid}'...")
        sf_path = gerador.gerar_imagem_plano(
            plano_id=pid,
            prompt=p["prompt_imagem"],
            proporcao="16:9",
            episodio_id=EPISODIO_ID,
        )
        p["storyboard"] = str(sf_path)
    return validar_todos_start_frames_ineditos(EPISODIO_ID, PLANOS_60S_POV)


# =============================================================================
# 5. MONTAGEM FINAL COM HUD SOBREVIDA v2.0 + CLIPS DO ADOBE FIREFLY (60.0s)
# =============================================================================
def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("%", "%%")
        .replace(":", "\\:")
        .replace("'", "")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def conformar_take_firefly_hud_sobrevida(
    src_mp4: Path,
    dst_mp4: Path,
    plano: Dict[str, Any],
    primeiro_take: bool = False,
    ultimo_take: bool = False,
) -> Path:
    """Conforma o vídeo de 5s do Firefly (Kling 2.5 Turbo) para dur_s em 1080p 24fps com movimento 100% progressivo e HUD SOBREVIDA."""
    dur_s = float(plano["duracao_s"])
    hud = plano["hud"]
    vida = int(hud["vida"])
    comida = int(hud["comida"])
    din_ep = _escape_drawtext(str(hud["dinheiro_epoca"]))
    din_brl = int(hud["dinheiro_brl"])
    relogio = _escape_drawtext(str(plano["relogio"]))

    # Cor do marcador temporal conforme severidade física: Verde (>60), Ouro Sujo (30..60), Sangue Seco (<30)
    cor_vida = "0x3B7A57" if vida > 60 else ("0xC99738" if vida >= 30 else "0x9E2B25")
    hud_txt = _escape_drawtext(f"FLORENCA, 1348   |   PESTE NEGRA   |   {din_ep} (R$ {din_brl})")
    fade_out_st = max(0.0, dur_s - 0.30)
    pts_factor = max(1.0, dur_s / 5.00)

    borda_sangue = (
        "drawbox=x=0:y=0:w=1920:h=1080:color=0x9E2B25@0.35:t=10,"
        if vida < 30
        else ""
    )
    silencio_box = (
        "drawbox=x=0:y=0:w=1920:h=1080:color=0x1A1A1A@0.96:t=fill:enable='between(t,5.20,6.00)',"
        if "silencio_dramatico_s" in plano
        else ""
    )
    fade_in_str = "fade=t=in:st=0:d=0.25," if primeiro_take else ""
    fade_out_str = f"fade=t=out:st={fade_out_st:.2f}:d=0.30," if ultimo_take else ""

    # 100% progressivo (zero reverse/boomerang!) + corte seco entre takes internos (zero dip-to-black!)
    fc = (
        "[0:v]scale=2016:1134:force_original_aspect_ratio=increase,"
        f"setpts={pts_factor:.4f}*PTS,"
        "framerate=fps=24:interp_start=0:interp_end=255:scene=100,"
        f"crop=1920:1080:x='(in_w-out_w)*min(1,t/{dur_s:.3f})':y='(in_h-out_h)*0.5',"
        f"trim=duration={dur_s:.3f},setpts=PTS-STARTPTS,"
        "eq=contrast=1.06:brightness=-0.01:saturation=0.88,"
        "vignette=PI/4.8,"
        f"{borda_sangue}"
        f"{silencio_box}"
        # Caixa discreta do HUD no canto superior esquerdo (Carvão #2B2A28 com 70% de opacidade)
        "drawbox=x=36:y=28:w=650:h=76:color=0x2B2A28@0.72:t=fill,"
        f"drawbox=x=36:y=28:w=8:h=76:color={cor_vida}@0.95:t=fill,"
        f"drawtext=font='Consolas':text='{hud_txt}':fontcolor=0xEDE3CC@0.96:fontsize=21:x=58:y=40,"
        f"drawtext=font='Consolas':text='{relogio}':fontcolor=0xC99738@0.95:fontsize=18:x=58:y=72,"
        f"{fade_in_str}"
        f"{fade_out_str}"
        "format=yuv420p[vout]"
    )
    validar_filtro_video_sem_reverse(fc)

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


def montar_master_60s_sobrevida(dirs_ep: Dict[str, Path], audio_master: Path) -> Path:
    validar_paridade_1_para_1_blocos_planos(PLANOS_60S_POV, PLANOS_60S_POV, episodio_id=EPISODIO_ID)
    renders_dir = dirs_ep["renders_firefly"]
    master_dir = dirs_ep["master"]
    cap_dir = master_dir / "blocos_6s_hud"
    cap_dir.mkdir(parents=True, exist_ok=True)

    cap_paths: List[Path] = []
    n_planos = len(PLANOS_60S_POV)
    for idx, p in enumerate(PLANOS_60S_POV):
        pid = p["id"]
        raw_mp4 = renders_dir / f"{pid}.mp4"
        validar_e_registrar_asset_inedito(raw_mp4, EPISODIO_ID, pid, "firefly_video")
        dst_cap = cap_dir / f"bloco_{idx + 1:02d}_{pid}.mp4"
        if not dst_cap.is_file() or dst_cap.stat().st_size < 200_000:
            logger.info(f"[HUD SOBREVIDA {idx + 1:02d}/10] Conformando '{pid}' ({p['duracao_s']:.2f}s, 1080p, 24fps)...")
            conformar_take_firefly_hud_sobrevida(
                raw_mp4,
                dst_cap,
                p,
                primeiro_take=(idx == 0),
                ultimo_take=(idx == n_planos - 1),
            )
        cap_paths.append(dst_cap)

    concat_txt = master_dir / f"{EPISODIO_ID}_concat_10_blocos.txt"
    with open(concat_txt, "w", encoding="utf-8") as f:
        for cp in cap_paths:
            f.write(f"file '{cp.resolve().as_posix()}'\n")

    visual_mp4 = master_dir / f"{EPISODIO_ID}_visual_60s.mp4"
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
            "-t", "60.00",
            "-movflags", "+faststart",
            str(master_final),
        ],
        check=True,
    )
    logger.info(
        f"[MASTER 60S CONCLUÍDO] {master_final} ({master_final.stat().st_size / (1024 * 1024):.2f} MB)"
    )
    return master_final


def main() -> None:
    t0 = time.time()
    dirs_ep = criar_diretorios_episodio_isolado(EPISODIO_ID)
    preparar_cenas_diretor_pov()

    # Salva manifesto de decupagem e prompts POV do episódio
    roteiro_json = dirs_ep["roteiro"] / f"{EPISODIO_ID}_roteiro_1para1.json"
    roteiro_json.write_text(
        json.dumps(
            {
                "episodio_id": EPISODIO_ID,
                "duracao_total_s": 60.0,
                "episodio": EPISODIO_META,
                "planos": PLANOS_60S_POV,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # 1. Áudio Master 60s com voz Fenrir
    audio_master = construir_audio_master_60s_fenrir(dirs_ep)

    # 2. 10 Start Frames POV inéditos
    mapa_sf = gerar_start_frames_pov_ineditos()

    # 3. Fila + Worker do Adobe Firefly (Kling 2.5 Turbo)
    enfileirar_episodio_no_firefly(EPISODIO_ID, PLANOS_60S_POV, mapa_sf)
    executar_worker_firefly_ate_concluir(EPISODIO_ID, PLANOS_60S_POV, concurrency=3)

    # 4. Montagem Master Final 60.0s com HUD SOBREVIDA
    master_mp4 = montar_master_60s_sobrevida(dirs_ep, audio_master)
    print("=" * 80)
    print(f"[SUCESSO] VÍDEO MASTER 60S SOBREVIDA GERADO NO FIREFLY: {master_mp4}")
    print(f"Tempo total: {time.time() - t0:.1f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()
