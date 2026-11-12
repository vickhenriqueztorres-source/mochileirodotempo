"""Testes unitários das 3 correções na raiz do projeto (Pausas, Consistência DNA e Zero Reverse)."""

import pytest

from contratos.integridade_assets import (
    AssetSimulationViolationError,
    ParidadeBlocoPlanoViolationError,
    calcular_janelas_dinamicas_sem_pausas,
    validar_ausencia_pausas_longas_entre_takes,
    validar_filtro_video_sem_reverse,
)
from grafo.direcao.engenheiro_prompt_imagem import (
    injetar_dna_consistencia_pov,
    validar_consistencia_dna_personagens_e_ambientes,
)
from orquestrador_episodio_puro_firefly import sanitizar_prompt_video_firefly_consistente


def test_janelas_dinamicas_eliminam_pausas_longas() -> None:
    planos = [
        {"id": "p01", "duracao_s": 14.0, "janela_s": [0.0, 14.0]},
        {"id": "p02", "duracao_s": 14.0, "janela_s": [14.0, 28.0]},
        {"id": "p03", "duracao_s": 14.0, "janela_s": [28.0, 42.0], "silencio_dramatico_s": [36.5, 38.0]},
    ]
    duracoes_fala = {"p01": 10.2, "p02": 11.4, "p03": 9.8}

    # Antes do ajuste dinâmico, a grade fixa de 14s gerava pausas de 3.8s, 2.6s e 2.7s -> deve falhar!
    with pytest.raises(ParidadeBlocoPlanoViolationError, match="PAUSA LONGA ENTRE TAKES"):
        validar_ausencia_pausas_longas_entre_takes(planos, duracoes_fala)

    total_s = calcular_janelas_dinamicas_sem_pausas(planos, duracoes_fala, lead_in_s=0.08, tail_gap_s=0.12)
    assert validar_ausencia_pausas_longas_entre_takes(planos, duracoes_fala) is True
    assert abs(planos[0]["duracao_s"] - 10.4) < 0.01
    assert abs(planos[1]["duracao_s"] - 11.6) < 0.01
    assert abs(planos[2]["duracao_s"] - (9.8 + 0.20 + 1.50)) < 0.01
    assert abs(total_s - (10.4 + 11.6 + 11.5)) < 0.02


def test_validar_filtro_video_bloqueia_reverse_e_boomerang() -> None:
    filtro_proibido = "[0:v]split=2[v1][v2];[v2]reverse[v2r];[v1][v2r]concat=n=2:v=1:a=0"
    with pytest.raises(AssetSimulationViolationError, match="EFEITO DE VOLTAR"):
        validar_filtro_video_sem_reverse(filtro_proibido, contexto="teste_reverse")

    filtro_progressivo = (
        "[0:v]scale=2016:1134:force_original_aspect_ratio=increase,crop=2016:1134,"
        "setpts=2.1000*PTS,framerate=fps=24:interp_start=0:interp_end=255:scene=100,"
        "crop=1920:1080:x='(iw-1920)/2':y='(ih-1080)*(t/11.200)'"
    )
    assert validar_filtro_video_sem_reverse(filtro_progressivo, contexto="teste_ok") is True


def test_sanitizar_prompt_video_firefly_preserva_realismo_pov_sem_2d() -> None:
    prompt_sensivel = (
        "Photorealistic first-person POV: hands smash the amphora, blood and corpse visible on the rope."
    )
    sanitizado = sanitizar_prompt_video_firefly_consistente(prompt_sensivel)
    lower = sanitizado.lower()
    assert "2d hand-drawn" not in lower
    assert "graphic novel" not in lower
    assert "blood" not in lower
    assert "corpse" not in lower
    assert "smash" not in lower
    assert "strict visual continuity" in lower


def test_injecao_e_validacao_dna_consistencia_pov() -> None:
    ep_meta = {
        "dna_maos": "bare muscular Roman baker forearms, faint healed burn scar on right forearm, leather cord on left wrist",
        "dna_companheiro": {
            "nome": "Lucio",
            "descricao": "19-year-old young Roman apprentice with short dark curly hair, clean-shaven face, short-sleeved olive-green linen tunic",
        },
        "dna_locacoes": {
            "padaria": "ancient Roman stone bakery with brick dome oven and basalt grain mills in 79 AD",
        },
    }
    planos = [
        {
            "id": "p01",
            "tipo_enquadramento": "pov_interacao_maos",
            "locacao_id": "padaria",
            "prompt_imagem": "Photorealistic first-person POV shot on 24mm lens counting coins on a counter.",
            "prompt_video": "Natural 24fps first-person POV camera motion as Lucio steps forward.",
        }
    ]
    injetar_dna_consistencia_pov(planos, ep_meta)
    erros = validar_consistencia_dna_personagens_e_ambientes(planos, ep_meta)
    assert erros == []
    assert "burn scar on right forearm" in planos[0]["prompt_imagem"]
    assert "brick dome oven" in planos[0]["prompt_imagem"]
    assert "short-sleeved olive-green linen tunic" in planos[0]["prompt_video"]


def test_auditoria_master_pompeia_reconstruido() -> None:
    import json
    import sqlite3
    import subprocess
    from pathlib import Path

    master_mp4 = Path(r"D:\CANAL 9\storage_local\episodios\ep_sobrevida_8m_pompeia_pov\master\ep_sobrevida_8m_pompeia_pov_master.mp4")
    roteiro_json = Path(r"D:\CANAL 9\storage_local\episodios\ep_sobrevida_8m_pompeia_pov\roteiro\ep_sobrevida_8m_pompeia_pov_roteiro_1para1.json")
    ff_db = Path(r"D:\agents 3.0 brecha - antigravity\canalbrecha\firefly-automation\data\firefly_jobs.db")

    assert master_mp4.is_file() and master_mp4.stat().st_size > 200_000_000
    assert roteiro_json.is_file()

    rot = json.loads(roteiro_json.read_text(encoding="utf-8"))
    planos = rot["planos"]
    assert len(planos) == 36
    assert validar_ausencia_pausas_longas_entre_takes(planos) is True

    probe = json.loads(
        subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(master_mp4)],
            text=True,
        )
    )
    dur_mp4 = float(probe["format"]["duration"])
    assert abs(dur_mp4 - float(rot["duracao_total_s"])) < 0.25

    conn = sqlite3.connect(str(ff_db))
    jobs_2d = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE name LIKE 'ep_sobrevida_8m_pompeia_pov_%' AND prompt LIKE '%2D hand-drawn%'"
    ).fetchone()[0]
    jobs_done = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE name LIKE 'ep_sobrevida_8m_pompeia_pov_%' AND status = 'done'"
    ).fetchone()[0]
    conn.close()
    assert jobs_2d == 0
    assert jobs_done == 36

