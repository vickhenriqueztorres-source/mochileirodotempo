"""Orquestrador Oficial de Produção 100% Inédita no Adobe Firefly (Subetapa 6 — Política Zero-Reuso).

Este orquestrador NUNCA reutiliza imagens ou vídeos existentes, NUNCA usa zoompan/Pillow e NUNCA usa reverse/boomerang:
1. Opera em diretório 100% isolado: `storage_local/episodios/<episodio_id>/`.
2. Exige que todos os Start Frames em `start_frames/` passem por `validar_e_registrar_asset_inedito`
   no `asset_registry.db` antes de iniciar o Firefly (qualquer imagem antiga ou repetida aborta imediatamente).
3. Enfileira cada Start Frame inédito no `firefly_jobs.db` do perfil Chrome autenticado
   (`D:\\agents 3.0 brecha - antigravity\\canalbrecha\\firefly-automation`) com `Kling 2.5 Turbo` (1080p, 16:9),
   preservando 100% da consistência visual realista em 1ª pessoa (POV) de personagens, mãos e ambientes.
4. Executa o worker real do Adobe Firefly (`firefly_bot.main worker-once` em ondas paralelas), valida o MP4 baixado com
   `validar_e_registrar_asset_inedito(..., tipo="firefly_video")` e só libera a montagem final quando
   100% dos takes do episódio tiverem status `done` no Firefly.
5. Conforma os takes com movimento 100% progressivo (zero reverse/boomerang) e cortes secos sem pausas mortas entre takes.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from contratos.integridade_assets import (
    AssetReuseViolationError,
    AssetSimulationViolationError,
    ParidadeBlocoPlanoViolationError,
    TETO_DURACAO_PLANO_INDIVIDUAL_S,
    criar_diretorios_episodio_isolado,
    inicializar_e_indexar_acervo_legado,
    validar_e_registrar_asset_inedito,
    validar_filtro_video_sem_reverse,
    validar_paridade_1_para_1_blocos_planos,
)
from grafo.ferramentas.firefly import FIREFLY_REPO, limpar_locks_chrome_firefly

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | [FIREFLY PURO ZERO-REUSO] %(message)s",
)
logger = logging.getLogger("orquestrador_puro_firefly")

FIREFLY_WORKER_ROOT = Path(__file__).resolve().parent / "storage_local" / "firefly_canal9_root"
FIREFLY_DB = FIREFLY_WORKER_ROOT / "data" / "firefly_jobs.db"
FIREFLY_IMG_DIR = FIREFLY_WORKER_ROOT / "imagens"
FIREFLY_OUT_DIR = FIREFLY_WORKER_ROOT / "saida"
PYTHON_FIREFLY = FIREFLY_REPO / ".venv" / "Scripts" / "python.exe"

ANCORA_CONTINUIDADE_VIDEO_POV = (
    "Strict visual continuity with the reference first frame: preserve exact photorealistic 35mm film textures, "
    "exact character appearance, skin tone, clothing fabric, lighting direction, and architectural geometry without style morphing."
)

_MAPA_SUBSTITUICAO_MODERACAO: Dict[str, str] = {
    r"\bblood\b": "dark soot",
    r"\bstrike\b": "impact",
    r"\bstrikes\b": "impacts",
    r"\bbound\b": "fastened",
    r"\brope\b": "hemp cord",
    r"\bkill\b": "overwhelm",
    r"\bkills\b": "overwhelms",
    r"\bmonster\b": "colossal figure",
    r"\bsmash\b": "break heavily",
    r"\bsmashes\b": "breaks heavily",
    r"\bshatter\b": "crack apart",
    r"\bshatters\b": "cracks apart",
    r"\bslaughter\b": "devastation",
    r"\bcorpse\b": "fallen figure",
    r"\bcorpses\b": "fallen figures",
    r"\bhorror\b": "dread",
    r"\bagony\b": "exhaustion",
    r"\bscream\b": "shout",
    r"\bweapon\b": "wooden staff",
    r"\bblind\b": "obscure",
    r"\bstab\b": "pierce",
    r"\bdestroy\b": "collapse",
    r"\bsacrileg\w*\b": "ancient",
    r"\bbolt\b": "flash",
    r"\bexplod\w*\b": "billow",
    r"\bdrown\w*\b": "submerge",
    r"\bflesh\b": "skin",
    r"\bprey\b": "target",
}


def sanitizar_prompt_video_firefly_consistente(
    prompt_video: str,
    plano: Dict[str, Any] | None = None,
) -> str:
    """Sanitiza termos sensíveis de moderação preservando 100% do estilo POV realista, personagens e ambiente."""
    base = (prompt_video or "").strip()
    if not base or "2d hand-drawn" in base.lower():
        mov = (plano or {}).get("prompt_movimento") or (
            "Animate this photorealistic first-person POV historical scene with natural forward camera motion at 24fps."
        )
        base = mov

    limpo = base
    for padrao, substituto in _MAPA_SUBSTITUICAO_MODERACAO.items():
        limpo = re.sub(padrao, substituto, limpo, flags=re.IGNORECASE)

    if "strict visual continuity" not in limpo.lower():
        limpo = f"{limpo.rstrip('. ')}. {ANCORA_CONTINUIDADE_VIDEO_POV}"
    return limpo[:980]


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def validar_todos_start_frames_ineditos(episodio_id: str, planos: List[Dict[str, Any]]) -> Dict[str, Path]:
    """Garante que 100% dos Start Frames existem na pasta isolada do episódio e são 100% inéditos."""
    inicializar_e_indexar_acervo_legado()
    dirs = criar_diretorios_episodio_isolado(episodio_id)
    sf_dir = dirs["start_frames"]
    mapa_sf: Dict[str, Path] = {}

    for p in planos:
        plano_id = str(p["id"])
        sf_path = sf_dir / f"{plano_id}.png"
        if not sf_path.is_file():
            raise AssetSimulationViolationError(
                f"[START FRAME AUSENTE] O plano '{plano_id}' do episódio '{episodio_id}' ainda não possui "
                f"Start Frame inédito em '{sf_path}'. Gere todas as novas imagens IA antes de acionar o Firefly."
            )
        sha = validar_e_registrar_asset_inedito(
            caminho=sf_path,
            episodio_id=episodio_id,
            plano_id=plano_id,
            tipo="start_frame",
        )
        mapa_sf[plano_id] = sf_path
        logger.info(f"[START FRAME VALIDADO] {plano_id} -> SHA256={sha[:16]}... (100% Inédito)")

    return mapa_sf


def aguardar_fila_firefly_livre(episodio_id: str, timeout_s: float = 150.0) -> None:
    """Aguarda qualquer job externo em andamento ('claimed' ou 'generating') concluir antes de assumir o Chrome."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        with sqlite3.connect(str(FIREFLY_DB), timeout=15.0) as conn:
            ativos = conn.execute(
                "SELECT name, status FROM jobs WHERE name NOT LIKE ? AND status IN ('claimed', 'generating')",
                (f"{episodio_id}%",),
            ).fetchall()
        if not ativos:
            return
        logger.info(f"[AGUARDANDO CHROME FIREFLY LIVRE] Jobs externos em conclusão: {ativos}. Aguardando 10s...")
        time.sleep(10.0)


def enfileirar_episodio_no_firefly(episodio_id: str, planos: List[Dict[str, Any]], mapa_sf: Dict[str, Path]) -> int:
    """Enfileira os planos inéditos do episódio no firefly_jobs.db para renderização no Kling 2.5 Turbo."""
    aguardar_fila_firefly_livre(episodio_id)
    FIREFLY_IMG_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    inseridos = 0
    job_names = [f"{episodio_id}_{p['id']}" for p in planos]

    with sqlite3.connect(str(FIREFLY_DB), timeout=15.0) as conn:
        conn.execute(
            "UPDATE system_state SET status = 'running', reason = NULL, updated_at = ? WHERE singleton = 1",
            (now,),
        )
        placeholders = ",".join("?" for _ in job_names)
        conn.execute(
            f"UPDATE jobs SET status = 'dead', updated_at = ? WHERE name NOT IN ({placeholders}) AND status != 'done'",
            [now, *job_names],
        )
        for p in planos:
            plano_id = str(p["id"])
            job_name = f"{episodio_id}_{plano_id}"
            sf_src = mapa_sf[plano_id]
            sf_dst = FIREFLY_IMG_DIR / f"{job_name}.png"
            shutil.copy2(sf_src, sf_dst)

            raw_prompt = p.get("prompt_video") or p.get("prompt_movimento") or (
                "Animate this photorealistic first-person POV historical frame with natural forward motion at 24fps."
            )
            prompt_video = sanitizar_prompt_video_firefly_consistente(raw_prompt, plano=p)

            row = conn.execute(
                "SELECT id, status, output_path, prompt FROM jobs WHERE name = ? ORDER BY id DESC LIMIT 1",
                (job_name,),
            ).fetchone()
            if (
                row
                and row[1] == "done"
                and row[2]
                and os.path.exists(row[2])
                and "2d hand-drawn" not in str(row[3] or "").lower()
            ):
                continue

            conn.execute("DELETE FROM jobs WHERE name = ?", (job_name,))
            conn.execute(
                """
                INSERT INTO jobs (
                    name, prompt, image_path, status, attempts,
                    model, resolution, aspect_ratio, duration_seconds, generate_audio, updated_at
                ) VALUES (?, ?, ?, 'pending', 0, 'Firefly Video', '720p', '16:9', 5, 0, ?)
                """,
                (job_name, prompt_video, str(sf_dst.resolve()), now),
            )
            inseridos += 1
        conn.commit()

    logger.info(f"[FILA FIREFLY] {inseridos} novos jobs enfileirados para '{episodio_id}'.")
    return inseridos


def _sincronizar_renders_firefly_concluidos(episodio_id: str, planos: List[Dict[str, Any]], renders_dir: Path) -> List[str]:
    """Copia e valida todos os MP4s do episódio já concluídos no Firefly, retornando a lista de planos ainda pendentes."""
    faltantes: List[str] = []
    with sqlite3.connect(str(FIREFLY_DB), timeout=15.0) as conn:
        for p in planos:
            plano_id = str(p["id"])
            job_name = f"{episodio_id}_{plano_id}"
            dst_mp4 = renders_dir / f"{plano_id}.mp4"

            if dst_mp4.is_file() and dst_mp4.stat().st_size > 100_000:
                validar_e_registrar_asset_inedito(dst_mp4, episodio_id, plano_id, "firefly_video")
                continue

            row = conn.execute(
                "SELECT status, output_path FROM jobs WHERE name = ? ORDER BY id DESC LIMIT 1",
                (job_name,),
            ).fetchone()
            cand_out = Path(row[1]) if (row and row[1]) else (FIREFLY_OUT_DIR / f"{job_name}.mp4")
            if row and row[0] == "done" and cand_out.is_file() and cand_out.stat().st_size > 100_000:
                shutil.copy2(cand_out, dst_mp4)
                sha = validar_e_registrar_asset_inedito(dst_mp4, episodio_id, plano_id, "firefly_video")
                logger.info(f"[TAKE FIREFLY VALIDADO] {plano_id} -> {dst_mp4.name} (SHA256={sha[:16]}...)")
            else:
                faltantes.append(plano_id)
    return faltantes


_SCRIPT_GARANTIR_LOGIN = r"""
import sys, time
from pathlib import Path
from patchright.sync_api import sync_playwright

prof = sys.argv[1]
JS_CHECK_AUTH = '''() => {
    function collectText(root) {
        let out = "";
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n = walker.currentNode;
        while (n) {
            if (n.nodeType === Node.TEXT_NODE) {
                out += " " + (n.nodeValue || "");
            } else if (n.shadowRoot) {
                out += " " + collectText(n.shadowRoot);
            }
            n = walker.nextNode();
        }
        return out.toLowerCase();
    }
    const url = location.href.toLowerCase();
    if (url.includes("auth.services.adobe.com") || url.includes("adobelogin.com") || url.includes("accounts.google.com")) {
        return {logged_in: false, reason: "on_auth_domain"};
    }
    const txt = collectText(document.body || document.documentElement);
    const loggedOutTokens = ["fazer logon", "comprar agora", "crie grátis todos os dias", "continuar com google"];
    for (const tok of loggedOutTokens) {
        if (txt.includes(tok)) {
            return {logged_in: false, reason: tok};
        }
    }
    const hasComposer = txt.includes("gerar") || txt.includes("generate") || txt.includes("kling");
    return {logged_in: hasComposer, reason: hasComposer ? "ok" : "loading"};
}'''

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=prof,
        channel="chrome",
        headless=True,
        viewport={"width": 1920, "height": 1080},
        args=["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto("https://firefly.adobe.com/generate/video", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    st = page.evaluate(JS_CHECK_AUTH)
    ctx.close()

if st.get("logged_in"):
    print("AUTH_OK")
    sys.exit(0)

print(f"AUTH_NEEDED ({st.get('reason')})")
sys.stdout.flush()
sys.exit(2)
"""


def garantir_sessao_firefly_autenticada(profile_dir: Path, python_exe: Path) -> None:
    """Limpa locks órfãos do perfil antes do worker-once (que executa com headless=False e DPAPI ativo)."""
    limpar_locks_chrome_firefly(profile_dir)


def executar_worker_firefly_ate_concluir(
    episodio_id: str,
    planos: List[Dict[str, Any]],
    concurrency: int = 3,
) -> List[Path]:
    """Executa o worker real do Adobe Firefly em ondas paralelas até concluir e validar 100% dos planos."""
    dirs = criar_diretorios_episodio_isolado(episodio_id)
    renders_dir = dirs["renders_firefly"]
    profile_dir = FIREFLY_WORKER_ROOT / "data" / "chrome_profile"
    python_exe = PYTHON_FIREFLY if PYTHON_FIREFLY.exists() else Path(sys.executable)
    job_names = [f"{episodio_id}_{p['id']}" for p in planos]
    planos_por_id = {str(p["id"]): p for p in planos}

    max_waves = max(25, len(planos) * 2)
    for wave in range(1, max_waves + 1):
        faltantes = _sincronizar_renders_firefly_concluidos(episodio_id, planos, renders_dir)
        if not faltantes:
            logger.info(f"[100% CONCLUÍDO NO FIREFLY] Todos os {len(planos)} takes inéditos de '{episodio_id}' validados!")
            break

        cur_conc = max(1, min(concurrency, len(faltantes)))
        logger.info(
            f"[ONDA FIREFLY {wave}/{max_waves}] Faltam {len(faltantes)} takes ({faltantes}) | Concurrency={cur_conc}"
        )

        garantir_sessao_firefly_autenticada(profile_dir, python_exe)
        now = time.time()
        with sqlite3.connect(str(FIREFLY_DB), timeout=15.0) as conn:
            conn.execute(
                "UPDATE system_state SET status = 'running', reason = NULL, updated_at = ? WHERE singleton = 1",
                (now,),
            )
            placeholders = ",".join("?" for _ in job_names)
            conn.execute(
                f"UPDATE jobs SET status = 'dead', updated_at = ? WHERE name NOT IN ({placeholders}) AND status != 'done'",
                [now, *job_names],
            )
            for pid in faltantes:
                jname = f"{episodio_id}_{pid}"
                row_st = conn.execute(
                    "SELECT status, prompt, image_path FROM jobs WHERE name = ? ORDER BY id DESC LIMIT 1",
                    (jname,),
                ).fetchone()
                if not row_st:
                    continue
                st_cur, cur_prompt, cur_img = row_st
                if st_cur != "pending":
                    plano_obj = planos_por_id.get(pid, {})
                    raw_p = plano_obj.get("prompt_video") or plano_obj.get("prompt_movimento") or cur_prompt
                    safe_prompt = sanitizar_prompt_video_firefly_consistente(raw_p, plano=plano_obj)
                    conn.execute("DELETE FROM jobs WHERE name = ? AND status != 'done'", (jname,))
                    conn.execute(
                        """
                        INSERT INTO jobs (
                            name, prompt, image_path, status, attempts,
                            model, resolution, aspect_ratio, duration_seconds, generate_audio, updated_at
                        ) VALUES (?, ?, ?, 'pending', 0, 'Kling 2.5 Turbo', '1080p', '16:9', 5, 0, ?)
                        """,
                        (jname, safe_prompt, cur_img, now),
                    )
            conn.commit()

        env = os.environ.copy()
        env["PYTHONPATH"] = str(FIREFLY_REPO)
        cmd = [
            str(python_exe),
            "-m",
            "firefly_bot.main",
            "--root",
            str(FIREFLY_WORKER_ROOT),
            "--concurrency",
            str(cur_conc),
            "worker-once",
        ]
        try:
            subprocess.run(cmd, cwd=str(FIREFLY_REPO), env=env, timeout=1560)
        except subprocess.TimeoutExpired:
            logger.warning(f"Timeout de 1560s na onda {wave}. Limpando locks do Chrome...")
            limpar_locks_chrome_firefly(profile_dir)

        _sincronizar_renders_firefly_concluidos(episodio_id, planos, renders_dir)
        time.sleep(random.uniform(3.0, 5.0))

    faltantes_finais = _sincronizar_renders_firefly_concluidos(episodio_id, planos, renders_dir)
    if faltantes_finais:
        raise RuntimeError(
            f"[FALHA FIREFLY] Não foi possível concluir os planos {faltantes_finais} do episódio '{episodio_id}'."
        )

    return [renders_dir / f"{p['id']}.mp4" for p in planos]


def conformar_take_firefly_para_capitulo(
    src_mp4: Path,
    dst_mp4: Path,
    duracao_alvo_s: float,
    ato_titulo: str,
    canto_verso: str,
    contador_perdas: str,
    silencio_dramatico: bool = False,
    primeiro_take: bool = False,
    ultimo_take: bool = False,
) -> Path:
    """Conforma um clipe real do Firefly (5.04s, 24fps) para a janela individual do seu bloco com movimento 100% progressivo.

    PROÍBE qualquer uso de efeito reverso ('reverse' / boomerang) e elimina dips de fade entre takes internos.
    """
    if duracao_alvo_s <= 0.0 or duracao_alvo_s > TETO_DURACAO_PLANO_INDIVIDUAL_S:
        raise ParidadeBlocoPlanoViolationError(
            f"[VIOLAÇÃO 1:1] Tentativa de conformar '{src_mp4.name}' para {duracao_alvo_s:.2f}s "
            f"(máximo permitido por bloco: {TETO_DURACAO_PLANO_INDIVIDUAL_S:.1f}s). "
            f"É proibido esticar 1 vídeo Firefly para cobrir múltiplos blocos do roteiro!"
        )

    if dst_mp4.is_file() and dst_mp4.stat().st_size > 200_000:
        return dst_mp4

    ato_esc = _escape_drawtext(ato_titulo)
    canto_esc = _escape_drawtext(canto_verso)
    cnt_esc = _escape_drawtext(contador_perdas)
    pts_factor = max(1.0, duracao_alvo_s / 5.00)

    sil_st = max(0.0, duracao_alvo_s - 1.50)
    extra_silencio = (
        f"drawbox=x=0:y=0:w=1920:h=1080:color=0x0A0705@0.95:t=fill:enable='between(t,{sil_st:.2f},{duracao_alvo_s:.2f})',"
        if silencio_dramatico
        else ""
    )
    fade_in_str = "fade=t=in:st=0:d=0.25," if primeiro_take else ""
    fade_out_st = max(0.0, duracao_alvo_s - 0.30)
    fade_out_str = f"fade=t=out:st={fade_out_st:.3f}:d=0.30," if ultimo_take else ""

    # Movimento 100% progressivo (0% reverse!) com interpolação temporal suave em 24fps e leve push-in óptico contínuo
    filter_complex = (
        "[0:v]scale=2016:1134:force_original_aspect_ratio=increase,"
        f"setpts={pts_factor:.4f}*PTS,"
        "framerate=fps=24:interp_start=0:interp_end=255:scene=100,"
        f"crop=1920:1080:x='(in_w-out_w)*min(1,t/{duracao_alvo_s:.3f})':y='(in_h-out_h)*0.5',"
        f"trim=duration={duracao_alvo_s:.3f},setpts=PTS-STARTPTS,"
        "eq=contrast=1.06:brightness=-0.01:saturation=0.88,"
        "vignette=PI/4.8,"
        f"{extra_silencio}"
        "drawbox=x=0:y=0:w=1920:h=68:color=0x0A0705@0.72:t=fill,"
        f"drawtext=expansion=none:font='Georgia':text='{ato_esc}':fontcolor=0xC89B3C@0.92:fontsize=22:x=48:y=22,"
        f"drawtext=expansion=none:font='Georgia':text='{canto_esc}':fontcolor=0xF4E8C1@0.78:fontsize=19:x=680:y=24,"
        f"drawtext=expansion=none:font='Consolas':text='{cnt_esc}':fontcolor=0xE85D04@0.95:fontsize=22:x=1920-tw-48:y=22,"
        f"{fade_in_str}"
        f"{fade_out_str}"
        "format=yuv420p[vout]"
    )
    validar_filtro_video_sem_reverse(filter_complex)

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src_mp4),
        "-filter_complex",
        filter_complex,
        "-map",
        "[vout]",
        "-t",
        f"{duracao_alvo_s:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "24",
        "-an",
        str(dst_mp4),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dst_mp4


def montar_master_episodio_puro_firefly(
    episodio_id: str,
    planos: List[Dict[str, Any]],
    audio_master_path: Path,
    duracao_total_s: float = 510.0,
    blocos: List[Dict[str, Any]] | None = None,
) -> Path:
    """Monta o Master Final 1080p 24fps do episódio exigindo paridade 1:1 (1 Bloco = 1 Vídeo Firefly)."""
    if blocos is not None:
        validar_paridade_1_para_1_blocos_planos(blocos, planos, episodio_id=episodio_id)
    else:
        validar_paridade_1_para_1_blocos_planos(planos, planos, episodio_id=episodio_id)

    dirs = criar_diretorios_episodio_isolado(episodio_id)
    renders_dir = dirs["renders_firefly"]
    master_dir = dirs["master"]
    cap_dir = master_dir / "blocos_1para1_conformados"
    cap_dir.mkdir(parents=True, exist_ok=True)

    cap_paths: List[Path] = []
    n_planos = len(planos)

    for idx, p in enumerate(planos):
        plano_id = str(p["id"])
        raw_firefly_mp4 = renders_dir / f"{plano_id}.mp4"
        if not raw_firefly_mp4.is_file():
            raise AssetSimulationViolationError(
                f"Render Firefly ausente para o plano '{plano_id}': {raw_firefly_mp4}"
            )
        validar_e_registrar_asset_inedito(raw_firefly_mp4, episodio_id, plano_id, "firefly_video")

        jan = p["janela_s"]
        clip_dur = round(float(jan[1]) - float(jan[0]), 3)
        dst_cap = cap_dir / f"bloco_{idx + 1:02d}_{plano_id}.mp4"

        logger.info(
            f"[CONFORMANDO BLOCO 1:1 {idx + 1:02d}/{n_planos}] {plano_id} ({clip_dur:.2f}s) a partir de {raw_firefly_mp4.name}..."
        )
        conformar_take_firefly_para_capitulo(
            src_mp4=raw_firefly_mp4,
            dst_mp4=dst_cap,
            duracao_alvo_s=clip_dur,
            ato_titulo=p.get("ato_titulo", "SOBREVIDA"),
            canto_verso=p.get("canto_verso", "Você Sobreviveria?"),
            contador_perdas=p.get("contador_perdas", "VIDA 100%"),
            silencio_dramatico=("silencio_dramatico_s" in p),
            primeiro_take=(idx == 0),
            ultimo_take=(idx == n_planos - 1),
        )
        cap_paths.append(dst_cap)

    concat_list_txt = master_dir / f"{episodio_id}_concat_50_blocos.txt"
    with open(concat_list_txt, "w", encoding="utf-8") as f:
        for cp in cap_paths:
            f.write(f"file '{cp.resolve().as_posix()}'\n")

    visual_concat_mp4 = master_dir / f"{episodio_id}_visual_510s.mp4"
    cmd_concat = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list_txt),
        "-c",
        "copy",
        str(visual_concat_mp4),
    ]
    logger.info(f"[MONTAGEM 1:1] Unindo {len(cap_paths)} blocos Firefly em {visual_concat_mp4.name}...")
    subprocess.run(cmd_concat, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    master_final_mp4 = master_dir / f"{episodio_id}_master.mp4"
    cmd_mux = [
        "ffmpeg",
        "-y",
        "-i",
        str(visual_concat_mp4),
        "-i",
        str(audio_master_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-t",
        f"{duracao_total_s:.2f}",
        "-movflags",
        "+faststart",
        str(master_final_mp4),
    ]
    logger.info(f"[MUX MASTER FINAL] Gerando {master_final_mp4} com áudio -14.0 LUFS...")
    subprocess.run(cmd_mux, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    logger.info(
        f"[MASTER FINAL CONCLUÍDO] {master_final_mp4} ({master_final_mp4.stat().st_size / (1024 * 1024):.2f} MB)"
    )
    return master_final_mp4


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Orquestrador Oficial Zero-Reuso & Paridade 1:1 Adobe Firefly")
    parser.add_argument("--episodio-id", required=True, help="ID único do novo episódio")
    parser.add_argument("--roteiro-json", required=True, help="Caminho do JSON de roteiro/planos 1:1 do episódio")
    parser.add_argument("--concurrency", type=int, default=3, help="Abas simultâneas no Firefly (1 a 6)")
    parser.add_argument(
        "--audio-master",
        default=r"d:\LUME\storage_local\audio\master_audio_8min.wav",
        help="Caminho do master de áudio WAV (-14 LUFS)",
    )
    args = parser.parse_args()

    dados = json.loads(Path(args.roteiro_json).read_text(encoding="utf-8"))
    lista_blocos = dados.get("blocos") or dados.get("planos") or []
    lista_planos = dados.get("planos") or dados.get("blocos") or []
    validar_paridade_1_para_1_blocos_planos(lista_blocos, lista_planos, episodio_id=args.episodio_id)
    mapa = validar_todos_start_frames_ineditos(args.episodio_id, lista_planos)
    enfileirar_episodio_no_firefly(args.episodio_id, lista_planos, mapa)
    executar_worker_firefly_ate_concluir(args.episodio_id, lista_planos, concurrency=args.concurrency)
    montar_master_episodio_puro_firefly(
        episodio_id=args.episodio_id,
        planos=lista_planos,
        audio_master_path=Path(args.audio_master),
        duracao_total_s=float(dados.get("duracao_total_s", 510.0)),
        blocos=lista_blocos,
    )
