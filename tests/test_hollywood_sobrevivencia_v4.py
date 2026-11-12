"""Suíte de Testes E2E — Cinema de Sobrevivência Histórica com Loops de Retenção de Hollywood (v4.0)."""

import pytest

from contratos.agentes import (
    ArquitetoEstruturaOutput,
    LoopRetencaoHollywood,
    ManobraSobrevivenciaEsqueleto,
)
from contratos.integridade_assets import (
    ParidadeBlocoPlanoViolationError,
    validar_ausencia_quiz_escolha_ab,
)
from grafo.direcao.engenheiro_prompt_imagem import (
    inferir_corpo_estado_por_sequencia,
    injetar_dna_consistencia_pov,
    validar_consistencia_dna_personagens_e_ambientes,
)
from grafo.roteiro.subgrafo import (
    SEQUENCIAS_HOLLYWOOD_V40,
    editor_retencao_node,
    validar_bloco_roteirista_v40,
    validar_esqueleto_arquiteto_v21,
)


def test_subetapa_01_bloqueio_total_quiz_escolha_ab() -> None:
    # Texto com pergunta de múltipla escolha deve falhar imediatamente
    planos_quiz = [
        {
            "id": "p09",
            "enquadramento": "pov_olho",
            "texto": "Você tem duas opções: Opção A: correr para o mar. Opção B: ficar na padaria. Escolha a sua.",
        }
    ]
    with pytest.raises(ParidadeBlocoPlanoViolationError, match="QUIZ A/B BLOQUEADO NA RAIZ"):
        validar_ausencia_quiz_escolha_ab(planos_quiz)

    # Enquadramento escolha_ab (split-screen) deve falhar imediatamente
    planos_split = [
        {
            "id": "p10",
            "enquadramento": "escolha_ab",
            "texto": "A rua se divide diante dos seus olhos.",
        }
    ]
    with pytest.raises(ParidadeBlocoPlanoViolationError, match="QUIZ A/B BLOQUEADO NA RAIZ"):
        validar_ausencia_quiz_escolha_ab(planos_split)

    # Narrativa contínua de sobrevivência prática deve ser aprovada
    planos_v4 = [
        {
            "id": "p09",
            "enquadramento": "pov_maos",
            "texto": (
                "A multidão corre em pânico para o píer, sem saber que o recuo sísmico do mar vai virar os barcos. "
                "Suas mãos agarram um saco de lã crua, amarram sobre o crânio com corda de cânhamo para amortecer "
                "as pedras-pomes e você avança pela parede de alvenaria."
            ),
        }
    ]
    assert validar_ausencia_quiz_escolha_ab(planos_v4) is True


def test_subetapa_02_arquiteto_8_sequencias_e_loops_hollywood() -> None:
    tipos_loops = [
        "ameaca_iminente",
        "relogio_fatal",
        "ironia_dramatica",
        "armadilha_oculta",
        "misterio_sensorial",
        "custo_humano",
    ]
    relogios = [
        "hora 1 da erupção",
        "hora 2 da erupção",
        "hora 4 da erupção",
        "hora 7 da erupção",
        "hora 11 da erupção",
        "hora 14 da erupção",
        "hora 17 da erupção",
        "hora 19 da erupção",
    ]

    blocos_v4 = []
    for idx, nome_seq in enumerate(SEQUENCIAS_HOLLYWOOD_V40):
        manobra = None
        if 1 <= idx <= 6:
            manobra = ManobraSobrevivenciaEsqueleto(
                ameaca_fisica=f"Ameaça física da sequência {idx}",
                instinto_fatal_multidao="Correr sem proteção craniana sob chuva de lapilli.",
                acao_tatica_sobrevivente="Amarrar almofada de lã com corda de cânhamo e caminhar rente às fachadas.",
                fato_ids=["F01"],
                conector_causal="mas",
                complicacao_resultante="O acúmulo de pedra-pomes trava a porta da viela seguinte.",
            ).model_dump()

        loop_hw = None
        if idx <= 5:
            loop_hw = LoopRetencaoHollywood(
                nivel="meso",
                tipo=tipos_loops[idx],
                pergunta_implicita_espectador=f"Como escapar do colapso da sequência {idx}?",
                plantado_em_sequencia=idx,
                fechado_em_sequencia=idx + 1,
            ).model_dump()

        blocos_v4.append(
            {
                "ordem": idx,
                "bloco": nome_seq,
                "relogio": relogios[idx],
                "manobra": manobra,
                "micro_loop_meio": "O cheiro de enxofre indica gás pesado junto ao chão." if 2 <= idx <= 6 else None,
                "loop_hollywood": loop_hw,
                "beats": [{"id": f"B{idx}.1", "situacao": "Ação em curso", "locacao_id": "L01"}],
            }
        )

    esqueleto_v4 = {
        "episodio": {
            "premissa": "Como sobreviver às 18 horas da destruição de Pompeia sendo um padeiro romano.",
            "erro_de_previsao": "Não houve lava; o que matou foi asfixia térmica e queda de telhados.",
            "objeto_plantado": {"objeto": "pano grosso de linho de padeiro", "plantado_em": 1, "pago_em": 6},
            "locacoes": [{"id": "L01", "nome": "Padaria e Via da Abundância"}],
        },
        "blocos": blocos_v4,
        "desfecho_historico": {
            "como_sobreviveu_resumo": "Saiu antes do colapso dos telhados usando proteção craniana e pano úmido na colina.",
            "destino_companheiro": "Lúcio sobreviveu com queimaduras leves nas mãos.",
            "registro_historico_real": "Carta de Plínio, o Jovem, a Tácito (Epistulae VI.16 e VI.20).",
            "fato_ids": ["F01"],
        },
    }

    saida_model = ArquitetoEstruturaOutput.model_validate(esqueleto_v4)
    erros = validar_esqueleto_arquiteto_v21(
        saida_model.model_dump(),
        entrada_arquiteto={"fatos": [{"id": "F01", "texto": "Fato real"}]},
    )
    assert erros == []


def test_subetapa_03_e_04_roteirista_e_auditor_retencao_sem_quiz() -> None:
    bloco_acao_ok = {
        "bloco": 2,
        "planos": [
            {
                "id": "p05",
                "enquadramento": "aberto",
                "movimento": "fecha_loop",
                "texto": "A viga do teto cede atrás de você enquanto suas pernas alcançam a rua escura.",
                "palavras": 15,
                "fato_ids": ["F01"],
            },
            {
                "id": "p06",
                "enquadramento": "pov_olho",
                "movimento": "erro_da_multidao",
                "texto": "Dezenas de vizinhos se trancam dentro dos quartos, onde o peso de três metros de pedra vai esmagar os telhados.",
                "palavras": 20,
                "fato_ids": ["F01"],
            },
            {
                "id": "p07",
                "enquadramento": "pov_maos",
                "movimento": "manobra_tatica",
                "texto": "Suas mãos amarram um travesseiro de lã grossa sobre a cabeça com corda de cânhamo para absorver o impacto das pedras.",
                "palavras": 21,
                "fato_ids": ["F01"],
            },
            {
                "id": "p08",
                "enquadramento": "pov_baixo",
                "movimento": "cliffhanger_loop",
                "texto": "Mas o chão se abre num tranco sísmico e uma parede de alvenaria inclina sobre o seu caminho.",
                "palavras": 18,
                "fato_ids": ["F01"],
            },
        ],
    }
    erros = validar_bloco_roteirista_v40(bloco_acao_ok, fatos_validos={"F01"}, eh_sequencia_acao=True)
    assert erros == []

    # Auditor de retenção deve reprovar qualquer bloco com "Opção A / Opção B"
    estado_com_quiz = {
        "roteiro": {
            "blocos": [
                {
                    "numero": 1,
                    "tempo_estimado_s": 28.0,
                    "texto": "Pompeia, 79 d.C. Opção A: fugir agora. Opção B: esconder moedas. Escolha a sua.",
                }
            ],
            "notas": {},
        }
    }
    res_ret = editor_retencao_node(estado_com_quiz)
    notas = res_ret["roteiro"]["notas"]["retencao"]
    assert any("[BLOQUEANTE]" in n for n in notas)


def test_subetapa_05_direcao_pov_dna_e_desgaste_por_sequencia() -> None:
    assert inferir_corpo_estado_por_sequencia(0) == "inteiro"
    assert inferir_corpo_estado_por_sequencia(3) == "desgastado"
    assert inferir_corpo_estado_por_sequencia(6) == "no_limite"

    ep_meta = {
        "dna_maos": "bare muscular Roman baker forearms, healed burn scar on right forearm, leather cord on left wrist",
        "dna_companheiro": {"nome": "Lucio", "descricao": "19-year-old Roman apprentice in olive-green linen tunic"},
        "dna_locacoes": {"padaria": "ancient Roman stone bakery with brick dome oven in 79 AD"},
    }
    planos = [
        {
            "id": "p01",
            "enquadramento": "pov_maos",
            "locacao_id": "padaria",
            "prompt_imagem": "Photorealistic first-person POV tying a wool cushion with hemp cord.",
            "prompt_movimento": "Hands pulling the hemp cord tight.",
        }
    ]
    injetar_dna_consistencia_pov(planos, ep_meta)
    assert validar_consistencia_dna_personagens_e_ambientes(planos, ep_meta) == []


def test_subetapa_06_pompeia_36_planos_v4_sem_quiz_e_sem_split() -> None:
    import json
    from pathlib import Path
    from produzir_sobrevida_8m_pompeia_pov import (
        PLANOS_36_POV,
        validar_decupagem_36_planos_pov,
    )

    assert len(PLANOS_36_POV) == 36
    assert validar_ausencia_quiz_escolha_ab(PLANOS_36_POV) is True
    assert all(p.get("enquadramento") != "escolha_ab" for p in PLANOS_36_POV)
    validar_decupagem_36_planos_pov()

    roteiro_path = Path(r"D:\CANAL 9\storage_local\episodios\ep_sobrevida_8m_pompeia_pov\roteiro\ep_sobrevida_8m_pompeia_pov_roteiro_1para1.json")
    assert roteiro_path.is_file()
    dados = json.loads(roteiro_path.read_text(encoding="utf-8"))
    assert validar_ausencia_quiz_escolha_ab(dados["planos"]) is True


def test_diluvio_36_planos_v4_sem_quiz_dna_e_start_frames() -> None:
    import json
    from pathlib import Path
    from produzir_sobrevida_8m_diluvio_pov import (
        PLANOS_36_POV,
        validar_decupagem_36_planos_pov,
    )

    assert len(PLANOS_36_POV) == 36
    assert validar_ausencia_quiz_escolha_ab(PLANOS_36_POV) is True
    assert all(p.get("enquadramento") != "escolha_ab" for p in PLANOS_36_POV)
    validar_decupagem_36_planos_pov()

    ep_dir = Path(r"D:\CANAL 9\storage_local\episodios\ep_sobrevida_8m_diluvio_pov")
    roteiro_path = ep_dir / "roteiro" / "ep_sobrevida_8m_diluvio_pov_roteiro_1para1.json"
    audio_master = ep_dir / "audio" / "master_sobrevida_8m_diluvio_fenrir.wav"
    sf_dir = ep_dir / "start_frames"

    assert roteiro_path.is_file()
    assert audio_master.is_file() and audio_master.stat().st_size > 30_000_000
    assert len(list(sf_dir.glob("p*.png"))) == 36

    dados = json.loads(roteiro_path.read_text(encoding="utf-8"))
    assert validar_ausencia_quiz_escolha_ab(dados["planos"]) is True



