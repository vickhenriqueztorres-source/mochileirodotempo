# -*- coding: utf-8 -*-
"""
CORTADOR DE SHORTS 9:16 (1080x1920, 24FPS) — EPISÓDIO DILÚVIO POV
=================================================================
Reenquadra os takes brutos sem letterbox (renders_firefly/pXX.mp4) em 9:16 (1080x1920),
adiciona Timecode Diegético vertical + Legenda Dinâmica centralizada no terço inferior
e sincroniza 1:1 com o trecho exato do Áudio Master Fenrir (-14 LUFS).
"""

import json
import subprocess
import textwrap
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List

from produzir_sobrevida_8m_diluvio_pov import (
    EPISODIO_ID,
    PLANOS_36_POV,
    _escape_drawtext,
    _ffprobe_duracao_arquivo,
    criar_diretorios_episodio_isolado,
)

SHORTS_SPECS: List[Dict[str, Any]] = [
    {
        "id": "short_01_muralha_de_lama_e_zigurate",
        "planos_ids": ["p01", "p02", "p03", "p04"],
        "titulo": "Por que subir no templo matou 96% das pessoas no Dilúvio de 2900 a.C. #Shorts",
        "gancho_topo": "SHURUPPAK, 2900 A.C. · O ERRO DOS 96%",
        "descricao": (
            "Você acorda em 2900 a.C. quando os diques do rio Eufrates rompem em Shuruppak. "
            "Descubra por que correr para o topo do Zigurate foi uma armadilha mortal e como um calafetador sumério sobreviveu.\n\n"
            "▶️ Assista ao Episódio Completo (7m38s) no canal!\n"
            "#Diluvio #SobrevivenciaNaHistoria #POV #Mesopotamia #Sumeria #Shorts"
        ),
        "tags": "diluvio pov,sobrevivendo ao diluvio,shuruppak 2900 ac,zigurate sumeria,historia em primeira pessoa,pov realista,shorts historia",
    },
    {
        "id": "short_02_junco_e_betume_vs_madeira",
        "planos_ids": ["p11", "p12", "p13", "p14"],
        "titulo": "Por que barcos de madeira afundaram no Dilúvio e o cesto de junco sobreviveu #Shorts",
        "gancho_topo": "ENGENHARIA SUMÉRIA · JUNCO VS. MADEIRA",
        "descricao": (
            "No Dilúvio real da Mesopotâmia (2900 a.C.), cascos rígidos de madeira estilhaçaram no impacto contra troncos e muros. "
            "Veja como funcionava o cesto flexível de junco (quffa) vedado com betume fervido (kupru), cinza e óleo de gergelim.\n\n"
            "▶️ Assista ao Episódio Completo no canal!\n"
            "#EngenhariaAntiga #Diluvio #POV #Sobrevivencia #Sumeria #Shorts"
        ),
        "tags": "barco de junco e betume,quffa sumeria,diluvio mesopotamia,engenharia antiga,como sobreviver ao diluvio,pov historia,shorts",
    },
    {
        "id": "short_03_calafetagem_submersa_e_ancora",
        "planos_ids": ["p19", "p20", "p21", "p22"],
        "titulo": "Como vedar um barco rachando debaixo d'água em 2900 a.C. (Física Suméria) #Shorts",
        "gancho_topo": "NOITE NO EUFRATES · CALAFETAGEM SUBMERSA",
        "descricao": (
            "À meia-noite do 2º dia de Dilúvio, a costura do fundo racha e o canal central vira um triturador de árvores. "
            "Veja a técnica suméria da pasta hidrofóbica de betume com óleo de gergelim e a âncora de arrasto de calcário.\n\n"
            "▶️ Assista ao Episódio Completo no canal!\n"
            "#Diluvio #SobrevivenciaNaHistoria #POV #Mesopotamia #HistoriaAntiga #Shorts"
        ),
        "tags": "calafetagem com betume,ancora de pedra sumeria,diluvio pov,sobrevivencia na antiguidade,rio eufrates inundacao,pov,shorts",
    },
    {
        "id": "short_04_barragem_submersa_golpe_cinzel",
        "planos_ids": ["p28", "p29", "p30", "p31"],
        "titulo": "A âncora prendeu no fundo do rio durante o Dilúvio (O golpe final) #Shorts",
        "gancho_topo": "DIA 6 DO DILÚVIO · NO LIMITE FÍSICO",
        "descricao": (
            "No 6º dia do Dilúvio em Shuruppak, o barco de junco despenca sobre uma barragem de pedra submersa e a corda da âncora engancha nas rochas puxando a popa para o fundo.\n\n"
            "▶️ Assista ao Episódio Completo no canal!\n"
            "#Diluvio #POV #SobrevivenciaExtrema #Mesopotamia #Atrahasis #Shorts"
        ),
        "tags": "diluvio dia 6,atrahasis,utnapishtim,sobrevivendo ao diluvio pov,historia em primeira pessoa,cinzel de bronze,shorts",
    },
]


def _conformar_plano_vertical_9x16(
    src_mp4: Path,
    dst_mp4: Path,
    plano: Dict[str, Any],
    gancho_topo: str,
    idx_no_short: int,
    primeiro: bool,
    ultimo: bool,
) -> Path:
    dur_s = float(plano["duracao_s"])
    raw_dur = _ffprobe_duracao_arquivo(src_mp4)
    pts_factor = max(1.0, (dur_s + 0.20) / max(1.0, raw_dur))

    relogio = _escape_drawtext(str(plano["relogio"]))
    topo_txt = _escape_drawtext(gancho_topo)

    # Quebra o texto narrado em 2 partes temporais para leitura rápida no Short (máx 28 chars por linha)
    palavras = str(plano["texto"]).split()
    meio = max(1, len(palavras) // 2)
    parte1 = " ".join(palavras[:meio])
    parte2 = " ".join(palavras[meio:])
    t_meio = dur_s * 0.50

    linhas_p1 = textwrap.wrap(parte1, width=28)[:3]
    linhas_p2 = textwrap.wrap(parte2, width=28)[:3]

    draw_legenda_cmds: List[str] = []
    # Caixa de fundo terço inferior
    draw_legenda_cmds.append(
        "drawbox=x=44:y=1390:w=992:h=250:color=0x141312@0.82:t=fill,"
        "drawbox=x=44:y=1390:w=992:h=4:color=0xC99738@0.95:t=fill"
    )
    for i, ln in enumerate(linhas_p1):
        esc = _escape_drawtext(ln.upper())
        y_pos = 1425 + i * 62
        draw_legenda_cmds.append(
            f"drawtext=expansion=none:font='Consolas':text='{esc}':fontcolor=0xFFF8E7@0.98:fontsize=38:"
            f"x=(w-text_w)/2:y={y_pos}:enable='between(t,0,{t_meio:.2f})'"
        )
    for i, ln in enumerate(linhas_p2):
        esc = _escape_drawtext(ln.upper())
        y_pos = 1425 + i * 62
        draw_legenda_cmds.append(
            f"drawtext=expansion=none:font='Consolas':text='{esc}':fontcolor=0xFFD166@0.98:fontsize=38:"
            f"x=(w-text_w)/2:y={y_pos}:enable='between(t,{t_meio:.2f},{dur_s:.2f})'"
        )

    legenda_filter = ",".join(draw_legenda_cmds)

    # Pan horizontal suave dentro do quadro 9:16 (sem esticar, mantendo centro de ação POV)
    if idx_no_short % 2 == 0:
        crop_9x16 = f"crop=1080:1920:x='(iw-1080)*0.35 + (iw-1080)*0.30*(t/{max(0.5, dur_s):.3f})':y='(ih-1920)/2'"
    else:
        crop_9x16 = f"crop=1080:1920:x='(iw-1080)*0.65 - (iw-1080)*0.30*(t/{max(0.5, dur_s):.3f})':y='(ih-1920)/2'"

    fade_in_str = "fade=t=in:st=0:d=0.18," if primeiro else ""
    fade_out_st = max(0.0, dur_s - 0.22)
    fade_out_str = f"fade=t=out:st={fade_out_st:.2f}:d=0.22," if ultimo else ""

    fc = (
        "[0:v]scale=-2:1980:force_original_aspect_ratio=increase,"
        f"setpts={pts_factor:.4f}*PTS,"
        "framerate=fps=24:interp_start=0:interp_end=255:scene=100,"
        f"{crop_9x16},"
        f"trim=duration={dur_s:.3f},setpts=PTS-STARTPTS,"
        "eq=contrast=1.07:brightness=-0.01:saturation=0.90,"
        "vignette=PI/4.5,"
        # Header Diegético Superior 9:16
        "drawbox=x=44:y=96:w=992:h=132:color=0x1E1D1B@0.82:t=fill,"
        "drawbox=x=44:y=96:w=10:h=132:color=0xC99738@0.96:t=fill,"
        f"drawtext=expansion=none:font='Consolas':text='{topo_txt}':fontcolor=0xEDE3CC@0.98:fontsize=31:x=76:y=118,"
        f"drawtext=expansion=none:font='Consolas':text='{relogio}':fontcolor=0xC99738@0.96:fontsize=25:x=76:y=168,"
        f"{legenda_filter},"
        f"{fade_in_str}"
        f"{fade_out_str}"
        "format=yuv420p[vout]"
    )

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


def gerar_todos_shorts_diluvio() -> List[Dict[str, Any]]:
    dirs_ep = criar_diretorios_episodio_isolado(EPISODIO_ID)
    renders_dir = dirs_ep["renders_firefly"]
    audio_master = dirs_ep["audio"] / "master_sobrevida_8m_diluvio_fenrir.wav"
    shorts_dir = dirs_ep["root"] / "shorts"
    shorts_tmp = shorts_dir / "_blocos_9x16"
    shorts_dir.mkdir(parents=True, exist_ok=True)
    shorts_tmp.mkdir(parents=True, exist_ok=True)

    roteiro_json = dirs_ep["roteiro"] / f"{EPISODIO_ID}_roteiro_1para1.json"
    dados_roteiro = json.loads(roteiro_json.read_text(encoding="utf-8"))
    mapa_planos = {p["id"]: p for p in dados_roteiro["planos"]}
    resultados: List[Dict[str, Any]] = []

    for spec in SHORTS_SPECS:
        sid = spec["id"]
        pids = spec["planos_ids"]
        planos_short = [mapa_planos[pid] for pid in pids]
        t_ini = float(planos_short[0]["janela_s"][0])
        t_fim = float(planos_short[-1]["janela_s"][1])
        dur_total = round(t_fim - t_ini, 2)

        print(f"[SHORT 9:16] Renderizando {sid} ({pids[0]}..{pids[-1]}, {dur_total:.2f}s)...")

        tareas = []
        blocos_paths: List[Path] = []
        for idx, pl in enumerate(planos_short):
            pid = pl["id"]
            src_mp4 = renders_dir / f"{pid}.mp4"
            dst_bloco = shorts_tmp / f"{sid}_{idx+1:02d}_{pid}.mp4"
            blocos_paths.append(dst_bloco)
            tareas.append((src_mp4, dst_bloco, pl, spec["gancho_topo"], idx, idx == 0, idx == len(planos_short) - 1))

        def _worker(args):
            return _conformar_plano_vertical_9x16(*args)

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(_worker, tareas))

        concat_txt = shorts_tmp / f"{sid}_concat.txt"
        with open(concat_txt, "w", encoding="utf-8") as f:
            for bp in blocos_paths:
                f.write(f"file '{bp.resolve().as_posix()}'\n")

        visual_9x16 = shorts_tmp / f"{sid}_visual.mp4"
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_txt),
                "-c", "copy",
                str(visual_9x16),
            ],
            check=True,
        )

        out_short = shorts_dir / f"{sid}.mp4"
        fade_out_a = max(0.0, dur_total - 0.20)
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(visual_9x16),
                "-ss", f"{t_ini:.3f}",
                "-t", f"{dur_total:.3f}",
                "-i", str(audio_master),
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "copy",
                "-af", f"afade=t=in:st=0:d=0.12,afade=t=out:st={fade_out_a:.2f}:d=0.20",
                "-c:a", "aac",
                "-b:a", "256k",
                "-ar", "48000",
                "-ac", "2",
                "-t", f"{dur_total:.3f}",
                "-movflags", "+faststart",
                str(out_short),
            ],
            check=True,
        )

        mb = out_short.stat().st_size / (1024 * 1024)
        print(f"  -> [OK] {out_short} ({dur_total:.2f}s, {mb:.2f} MB)")
        resultados.append(
            {
                "id": sid,
                "arquivo": str(out_short),
                "planos": pids,
                "janela_origem_s": [t_ini, t_fim],
                "duracao_s": dur_total,
                "tamanho_mb": round(mb, 2),
                "titulo": spec["titulo"],
                "descricao": spec["descricao"],
                "tags": spec["tags"],
            }
        )

    meta_json = shorts_dir / "shorts_diluvio_metadados.json"
    meta_json.write_text(json.dumps(resultados, indent=2, ensure_ascii=False), encoding="utf-8")
    return resultados


if __name__ == "__main__":
    gerar_todos_shorts_diluvio()
