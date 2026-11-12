"""Testes da Fase C · Pesquisa + Roteiro + Gate 1 (Critérios de Aceite).

Verifica:
1. Roteiro chega ao Gate 1 com fontes por bloco (canto/verso).
2. Notas dos 3 revisores (retenção, fidelidade, tom) registradas no estado.
3. Nenhuma frase sem fato correspondente verificado em pesquisa.fatos.
4. Caso de reprovação de gíria detectado pelo Revisor de Tom.
5. Caso de reprovação de fato inventado detectado pelo Revisor de Fidelidade.
6. Caso de reprovação de gancho > 45s detectado pelo Editor de Retenção.
7. O ciclo de revisão executa refações respeitando o limite máximo de 3 voltas.
"""

import pytest
from langgraph.checkpoint.memory import MemorySaver

from contratos.estado import criar_estado_inicial
from grafo.base import limpar_operacoes_teste
from grafo.pesquisa.subgrafo import construir_subgrafo_pesquisa
from grafo.roteiro.subgrafo import (
    construir_subgrafo_roteiro,
    editor_retencao_node,
    revisor_fidelidade_node,
    revisor_tom_node,
)
from grafo.showrunner.grafo import construir_grafo_showrunner


def test_pesquisa_e_roteiro_chegam_ao_gate_1_com_fontes_e_fatos():
    """Garante que 'A Odisseia' gera fontes, fatos e chega ao Gate 1 com canto/verso por bloco."""
    limpar_operacoes_teste()
    app = construir_grafo_showrunner(checkpointer=MemorySaver())

    estado_inicial = criar_estado_inicial("ep_odisseia_c", "A Odisseia", "Polifemo")
    config = {"configurable": {"thread_id": "thread_fase_c_01"}}

    # Inicia até o Gate 1
    app.invoke(estado_inicial, config)
    estado = app.get_state(config)

    # 1. Parou no Gate 1
    assert estado.tasks[0].interrupts
    payload_gate_1 = estado.tasks[0].interrupts[0].value
    assert payload_gate_1["titulo"] == "A Odisseia"

    # 2. Fontes por bloco com canto/verso
    blocos = estado.values["roteiro"]["blocos"]
    assert len(blocos) > 0
    for b in blocos:
        assert "canto_verso" in b
        assert "Canto IX" in b["canto_verso"]
        assert len(b["fatos_referenciados"]) > 0

    # 3. Notas dos 3 revisores presentes no estado
    notas = estado.values["roteiro"]["notas"]
    assert "retencao" in notas and len(notas["retencao"]) > 0
    assert "fidelidade" in notas and len(notas["fidelidade"]) > 0
    assert "tom" in notas and len(notas["tom"]) > 0

    # 4. Todos os revisores aprovaram a versão canônica (sem bloqueios)
    for tipo, lista in notas.items():
        assert not any("[BLOQUEANTE]" in str(nota) for nota in lista)


def test_revisor_tom_reprova_giria():
    """Garante que gíria ('aí galera', 'mano', 'doidão') é reprovada com bloqueio."""
    estado = {
        "roteiro": {
            "blocos": [
                {
                    "numero": 1,
                    "texto": "E aí galera, mano, Polifemo ficou doidão na caverna.",
                    "tempo_estimado_s": 25.0,
                    "fatos_referenciados": ["fato_01"],
                }
            ],
            "notas": {},
        }
    }
    resultado = revisor_tom_node(estado)
    notas_tom = resultado["roteiro"]["notas"]["tom"]
    assert any("[BLOQUEANTE]" in n and "gíria proibida" in n for n in notas_tom)


def test_revisor_fidelidade_reprova_fato_inventado():
    """Garante que fato sem correspondência em pesquisa.fatos é reprovado com bloqueio."""
    estado = {
        "pesquisa": {
            "fatos": [{"id": "fato_01", "descricao": "Odisseu oferece vinho"}]
        },
        "roteiro": {
            "blocos": [
                {
                    "numero": 1,
                    "texto": "Odisseu usou uma bazuca mágica.",
                    "tempo_estimado_s": 30.0,
                    "fatos_referenciados": ["fato_inexistente_bazuca"],
                }
            ],
            "notas": {},
        }
    }
    resultado = revisor_fidelidade_node(estado)
    notas_fidelidade = resultado["roteiro"]["notas"]["fidelidade"]
    assert any("[BLOQUEANTE]" in n and "fato inventado" in n for n in notas_fidelidade)


def test_editor_retencao_reprova_gancho_maior_que_45s():
    """Garante que gancho inicial acima de 45 segundos é reprovado com bloqueio."""
    estado = {
        "roteiro": {
            "blocos": [
                {
                    "numero": 1,
                    "texto": "Uma longa e interminável introdução sem conflito...",
                    "tempo_estimado_s": 65.0,  # 65s > 45s
                    "fatos_referenciados": ["fato_01"],
                }
            ],
            "notas": {},
        }
    }
    resultado = editor_retencao_node(estado)
    notas_retencao = resultado["roteiro"]["notas"]["retencao"]
    assert any("[BLOQUEANTE]" in n and "Gancho inicial excede 45 segundos" in n for n in notas_retencao)


def test_ciclo_revisao_refaz_roteiro_e_limita_3_voltas():
    """Garante que quando há bloqueio, o ciclo refaz e converge sem loop infinito."""
    subgrafo = construir_subgrafo_roteiro()
    estado_com_falha = {
        "pesquisa": {"fontes": [{"canto_verso": "Canto IX, 105"}], "fatos": [{"id": "fato_01"}]},
        "roteiro": {
            "_forcar_caso_teste": "giria",  # Primeira rodada força gíria para testar refação
            "voltas": 0,
            "notas": {},
        },
        "episodio": {"id": "ep01"},
        "custos": [],
    }

    resultado_final = subgrafo.invoke(estado_com_falha)
    assert resultado_final["roteiro"]["voltas"] <= 3
    # Após a refação, a versão limpa é aprovada
    notas = resultado_final["roteiro"]["notas"]
    assert not any("[BLOQUEANTE]" in str(n) for n in notas.get("tom", []))


def test_arquiteto_estrutura_v21_checklist_completo():
    """Valida o checklist de 10 itens da Seção 8 do Prompt Arquiteto de Estrutura v2.1.0."""
    from grafo.roteiro.subgrafo import validar_esqueleto_arquiteto_v21

    entrada = {
        "diagnostico_atencao": {
            "cliches_proibidos_na_abertura": ["faraós", "pirâmides", "deuses", "múmias"],
        },
        "fatos": [{"id": "F01"}, {"id": "F02"}, {"id": "F03"}],
        "precos": [{"id": "P01"}, {"id": "P02"}, {"id": "P03"}],
    }

    esqueleto_valido = {
        "episodio": {
            "destino": "Tebas, Egito",
            "ano": "1250 a.C.",
            "duracao_estadia": "UM DIA",
            "papel_do_viajante": "trabalhador comum em Deir el-Medina",
            "duracao_alvo_min": 15,
            "palavras_alvo": 2180,
            "premissa": "Sobreviver um dia como artesão em Tebas quando a ração de trigo atrasa.",
            "erro_de_previsao": "A areia no pão mói os seus dentes antes do sol nascer.",
        },
        "blocos": [
            {
                "ordem": 0, "bloco": "Carimbo", "janela": "0:00-0:40", "palavras_alvo": 95,
                "objetivo": "Choque sensorial imediato",
                "beats": [{"id": "B0.1", "situacao": "Você morde o pão e sente areia nos dentes.", "fato_ids": ["F01"], "preco_ids": [], "tito_em_cena": "Tito faz careta segurando o maxilar.", "sentido": "gosto"}],
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "Se o dente infeccionar, não há dentista.", "fechado_em": 5},
            },
            {
                "ordem": 1, "bloco": "Chegada", "janela": "0:40-2:00", "palavras_alvo": 190,
                "objetivo": "Primeira impressão na margem do Nilo",
                "beats": [{"id": "B1.1", "situacao": "O cheiro de peixe seco domina o porto.", "fato_ids": ["F01"], "preco_ids": [], "tito_em_cena": "Tito tapa o nariz com o lenço âmbar.", "sentido": "cheiro"}],
                "loop_aberto": {"tipo": "pergunta_pratica", "texto": "Onde você vai passar a noite?", "fechado_em": 2},
            },
            {
                "ordem": 2, "bloco": "Onde dormir", "janela": "2:00-4:00", "palavras_alvo": 280,
                "objetivo": "Casa em Deir el-Medina e calor noturno",
                "beats": [{"id": "B2.1", "situacao": "Você sobe para dormir no teto da casa de tijolo cru.", "fato_ids": ["F02"], "preco_ids": ["P01"], "tito_em_cena": "Tito sacode a sandália procurando escorpiões.", "sentido": "tato"}],
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "E o escorpião ainda está no telhado.", "fechado_em": 5},
            },
            {
                "ordem": 3, "bloco": "O que comer", "janela": "4:00-6:00", "palavras_alvo": 280,
                "objetivo": "Pão ta e cerveja espessa",
                "beats": [{"id": "B3.1", "situacao": "Sua refeição é cerveja grossa filtrada com canudo.", "fato_ids": ["F01"], "preco_ids": ["P02"], "tito_em_cena": "Tito olha desconfiado para a jarra de barro.", "sentido": "gosto"}],
                "loop_aberto": {"tipo": "conta_que_nao_fecha", "texto": "Sua cota de grãos acaba hoje.", "fechado_em": 4},
            },
            {
                "ordem": 4, "bloco": "Trabalho e dinheiro", "janela": "6:00-8:30", "palavras_alvo": 350,
                "objetivo": "Escavação nas tumbas e salário em khar",
                "beats": [{"id": "B4.1", "situacao": "Você escava calcário sob a fumaça de lamparinas.", "fato_ids": ["F02"], "preco_ids": ["P03"], "tito_em_cena": "Tito enxuga o suor e pesa o cinzel de cobre.", "sentido": "visão"}],
                "loop_aberto": {"tipo": "pressagio", "texto": "Ninguém te contou o que acontece quando a ração atrasa.", "fechado_em": 7},
            },
            {
                "ordem": 5, "bloco": "Leis e perigos", "janela": "8:30-11:00", "palavras_alvo": 350,
                "objetivo": "Tribunal Kenbet e punições físicas",
                "beats": [{"id": "B5.1", "situacao": "Mentir num juramento custa 100 chibatadas.", "fato_ids": ["F03"], "preco_ids": [], "tito_em_cena": "Tito recua e esconde as mãos no bolso do casaco.", "sentido": "som"}],
                "loop_aberto": {"tipo": "regra_desconhecida", "texto": "Existe um descanso sagrado que pode salvar sua semana.", "fechado_em": 6},
            },
            {
                "ordem": 6, "bloco": "Diversão e fé", "janela": "11:00-13:00", "palavras_alvo": 280,
                "objetivo": "Jogo de Senet e Festival Opet",
                "beats": [{"id": "B6.1", "situacao": "Você joga Senet à luz de óleo na porta de casa.", "fato_ids": ["F03"], "preco_ids": [], "tito_em_cena": "Tito move uma peça de osso no tabuleiro.", "sentido": "visão"}],
                "loop_aberto": {"tipo": "conta_que_nao_fecha", "texto": "Mas no dia seguinte, o armazém real amanhece vazio.", "fechado_em": 7},
            },
            {
                "ordem": 7, "bloco": "O grande evento", "janela": "13:00-14:45", "palavras_alvo": 250,
                "objetivo": "A primeira greve registrada da história",
                "beats": [{"id": "B7.1", "situacao": "Você marcha com os artesãos até o templo exigindo trigo.", "fato_ids": ["F02"], "preco_ids": [], "tito_em_cena": "Tito senta no chão ao lado dos trabalhadores em greve.", "sentido": "som"}],
                "loop_aberto": {"tipo": "pergunta_pratica", "texto": "O vizir vai mandar soldados ou entregar o trigo?", "fechado_em": 8},
            },
            {
                "ordem": 8, "bloco": "Partida", "janela": "14:45-15:30", "palavras_alvo": 105,
                "objetivo": "Desfecho e carimbo de saída",
                "beats": [{"id": "B8.1", "situacao": "Os sacos de grãos são entregues e seu tempo em Tebas acaba.", "fato_ids": ["F02"], "preco_ids": [], "tito_em_cena": "Tito fecha a maleta de couro e guarda o passaporte.", "sentido": "visão"}],
                "loop_aberto": None,
            },
        ],
        "gancho_proximo_destino": {"destino": "Londres, 1348", "texto": "Na próxima parada, o inimigo é invisível."},
        "alertas": [],
    }

    assert validar_esqueleto_arquiteto_v21(esqueleto_valido, entrada) == []



def test_arquiteto_estrutura_v22_regras_cenas_retencao_e_shorts():
    """Valida todas as novas regras v2.2.0: locacao_id, enquadramento variado, missão, personagem local, meio de bloco e Shorts."""
    from grafo.roteiro.subgrafo import validar_esqueleto_arquiteto_v21

    entrada = {
        "diagnostico_atencao": {
            "cliches_proibidos_na_abertura": ["faraós", "pirâmides", "deuses", "múmias"],
        },
        "fatos": [{"id": "F01"}, {"id": "F02"}, {"id": "F03"}],
        "precos": [{"id": "P01"}, {"id": "P02"}, {"id": "P03"}],
    }

    esqueleto_v22 = {
        "episodio": {
            "destino": "Tebas, Egito",
            "ano": "1250 a.C.",
            "duracao_estadia": "UM DIA",
            "papel_do_viajante": "artesão em Deir el-Medina",
            "duracao_alvo_min": 15,
            "palavras_alvo": 2180,
            "promessa_thumbnail": "PÃO COM AREIA · O SALÁRIO ERA CERVEJA",
            "promessa_thumbnail_entregue_no_carimbo": True,
            "premissa": "Sobreviver um dia em Tebas e garantir 2 sacos de cevada até o pôr do sol.",
            "erro_de_previsao": "A areia no pão mói os seus dentes antes do sol nascer.",
            "missao_do_episodio": {
                "objetivo": "Garantir 2 sacos de cevada até o pôr do sol",
                "prazo": "Fim da tarde",
                "resolvida_em": 7,
            },
            "personagem_local": {
                "nome": "Kha, o Canteiro",
                "papel": "Vizinho veterano em Deir el-Medina",
                "arco": "Desconfia pela manhã, divide cerveja à tarde e lidera a greve à noite",
                "blocos_presente": [2, 4, 7],
            },
        },
        "locacoes": [
            {"id": "L01", "nome": "Cais de Tebas", "descricao_base": "Margem do Nilo"},
            {"id": "L02", "nome": "Vila de Deir el-Medina", "descricao_base": "Casas de tijolo cru"},
            {"id": "L03", "nome": "Tumba real em escavação", "descricao_base": "Galeria subterrânea"},
        ],
        "blocos": [
            {
                "ordem": 0, "bloco": "Carimbo", "janela": "0:00-0:40", "hora_do_dia": "amanhecer", "palavras_alvo": 95,
                "objetivo": "Entregar promessa da thumb e plantar missão",
                "beats": [
                    {"id": "B0.1", "situacao": "Você morde o pão com areia.", "locacao_id": "L01", "hora_do_dia": "amanhecer", "enquadramento": "aberto", "planos_estimados": 6, "fato_ids": ["F01"], "preco_ids": [], "tito_em_cena": "Tito trava o maxilar.", "sentido": "gosto", "som_ambiente": "Carimbo e vento", "grafico_na_tela": "carimbo_transicao", "cortavel_para_short": True},
                    {"id": "B0.2", "situacao": "Você precisa de 2 sacos de cevada até o pôr do sol.", "locacao_id": "L01", "hora_do_dia": "amanhecer", "enquadramento": "close", "planos_estimados": 6, "fato_ids": ["F02"], "preco_ids": [], "tito_em_cena": "Tito olha a bolsa vazia.", "sentido": "tato", "som_ambiente": "Porto agitado", "grafico_na_tela": None, "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "pergunta_pratica", "texto": "Onde largar a mala antes dos 40 graus?", "fechado_em": 2},
            },
            {
                "ordem": 1, "bloco": "Chegada", "janela": "0:40-2:00", "hora_do_dia": "amanhecer", "palavras_alvo": 190,
                "objetivo": "Choque sensorial no porto",
                "curiosidade_bomba": "O Nilo tinha crocodilos e parasitas que entravam pela pele dos pés.",
                "beats": [
                    {"id": "B1.1", "situacao": "Desembarque no cais barrento.", "locacao_id": "L01", "hora_do_dia": "amanhecer", "enquadramento": "aberto", "planos_estimados": 16, "fato_ids": ["F01"], "preco_ids": [], "tito_em_cena": "Tito desvia dos carregadores.", "sentido": "cheiro", "som_ambiente": "Água e moscas", "grafico_na_tela": "mapinha", "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "Entrar na água rasa pode custar sua saúde.", "fechado_em": 5},
            },
            {
                "ordem": 2, "bloco": "Onde dormir", "janela": "2:00-4:00", "hora_do_dia": "manha", "palavras_alvo": 280,
                "objetivo": "Largar a mala e conhecer Kha",
                "curiosidade_bomba": "As famílias dormiam no telhado porque o barro retinha 38 graus à noite.",
                "beats": [
                    {"id": "B2.1", "situacao": "Você larga a mala na casa de barro e conhece Kha.", "locacao_id": "L02", "hora_do_dia": "manha", "enquadramento": "aberto", "planos_estimados": 20, "fato_ids": ["F02"], "preco_ids": ["P01"], "tito_em_cena": "Tito pousa a maleta no chão.", "sentido": "tato", "som_ambiente": "Viela silenciosa", "grafico_na_tela": "cartao_preco", "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "conta_que_nao_fecha", "texto": "O aluguel vence hoje à tarde.", "fechado_em": 4},
            },
            {
                "ordem": 3, "bloco": "O que comer", "janela": "4:00-6:00", "hora_do_dia": "meio_dia", "palavras_alvo": 280,
                "objetivo": "Almoço de pão e cerveja espessa",
                "curiosidade_bomba": "A cerveja egípcia era tão grossa que precisava ser bebida com canudo de junco.",
                "beats": [
                    {"id": "B3.1", "situacao": "Você bebe cerveja espessa com canudo.", "locacao_id": "L02", "hora_do_dia": "meio_dia", "enquadramento": "aberto", "planos_estimados": 20, "fato_ids": ["F01"], "preco_ids": ["P02"], "tito_em_cena": "Tito sopra o canudo de junco.", "sentido": "gosto", "som_ambiente": "Fogo de lenha e moinho", "grafico_na_tela": "cartao_preco", "cortavel_para_short": True},
                ],
                "loop_aberto": {"tipo": "pressagio", "texto": "O sino de cobre chama para a tumba.", "fechado_em": 4},
            },
            {
                "ordem": 4, "bloco": "Trabalho e dinheiro", "janela": "6:00-8:30", "hora_do_dia": "tarde", "palavras_alvo": 350,
                "objetivo": "Turno na tumba e pagamento em grãos",
                "curiosidade_bomba": "Os escribas anotavam até 'falta porque o escorpião picou' ou 'fazendo cerveja'.",
                "revelacao_meio_bloco": "O escriba pesa os cinzéis de cobre antes e depois do turno para impedir roubo de metal.",
                "beats": [
                    {"id": "B4.1", "situacao": "Você escava calcário ao lado de Kha.", "locacao_id": "L03", "hora_do_dia": "tarde", "enquadramento": "aberto", "planos_estimados": 25, "fato_ids": ["F02"], "preco_ids": ["P03"], "tito_em_cena": "Tito bate o cinzel e tosse com a poeira.", "sentido": "som", "som_ambiente": "Martelos na rocha", "grafico_na_tela": "cartao_preco", "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "regra_desconhecida", "texto": "Se faltar 10 gramas de cobre no seu cinzel, você vai a julgamento.", "fechado_em": 5},
            },
            {
                "ordem": 5, "bloco": "Leis e perigos", "janela": "8:30-11:00", "hora_do_dia": "por_do_sol", "palavras_alvo": 350,
                "objetivo": "Tribunal Kenbet e medicina",
                "curiosidade_bomba": "Obras públicas tinham médicos pagos pelo Estado que receitavam mel e alho.",
                "revelacao_meio_bloco": "Se o tribunal Kenbet não decidir quem mente, a estátua do faraó morto 'julga' balançando nos ombros dos sacerdotes.",
                "beats": [
                    {"id": "B5.1", "situacao": "Julgamento no portão da vila ao pôr do sol.", "locacao_id": "L02", "hora_do_dia": "por_do_sol", "enquadramento": "aberto", "planos_estimados": 25, "fato_ids": ["F03"], "preco_ids": [], "tito_em_cena": "Tito recua vendo o bastão do guarda.", "sentido": "visão", "som_ambiente": "Vozes graves no portão", "grafico_na_tela": None, "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "pergunta_pratica", "texto": "Como esquecer esse medo quando a noite cai?", "fechado_em": 6},
            },
            {
                "ordem": 6, "bloco": "Diversão e fé", "janela": "11:00-13:00", "hora_do_dia": "noite", "palavras_alvo": 280,
                "objetivo": "Jogo de Senet e noite no telhado",
                "curiosidade_bomba": "O jogo de tabuleiro Senet era visto como um treino para atravessar o mundo dos mortos.",
                "beats": [
                    {"id": "B6.1", "situacao": "Partida de Senet à luz de lamparina no terraço.", "locacao_id": "L02", "hora_do_dia": "noite", "enquadramento": "aberto", "planos_estimados": 20, "fato_ids": ["F03"], "preco_ids": [], "tito_em_cena": "Tito joga os gravetos do tabuleiro.", "sentido": "visão", "som_ambiente": "Grilos e estalar de óleo", "grafico_na_tela": None, "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "conta_que_nao_fecha", "texto": "Mas o barco de trigo não atracou e os 2 sacos não chegaram.", "fechado_em": 7},
            },
            {
                "ordem": 7, "bloco": "O grande evento", "janela": "13:00-14:45", "hora_do_dia": "noite", "palavras_alvo": 250,
                "objetivo": "A primeira greve da história e resolução da missão com Kha",
                "curiosidade_bomba": "Em Deir el-Medina ocorreu a primeira greve trabalhista documentada da história humana.",
                "beats": [
                    {"id": "B7.1", "situacao": "Kha lidera os artesãos até o templo e conquista a entrega dos 2 sacos de cevada.", "locacao_id": "L02", "hora_do_dia": "noite", "enquadramento": "aberto", "planos_estimados": 20, "fato_ids": ["F02"], "preco_ids": [], "tito_em_cena": "Tito ergue o saco de cevada comemorando silenciosamente com Kha.", "sentido": "som", "som_ambiente": "Tochas e clamor da vila", "grafico_na_tela": None, "cortavel_para_short": False},
                ],
                "loop_aberto": {"tipo": "pressagio", "texto": "A dívida está paga, mas o seu relógio de bolso começa a vibrar.", "fechado_em": 8},
            },
            {
                "ordem": 8, "bloco": "Partida", "janela": "14:45-15:30", "hora_do_dia": "amanhecer", "palavras_alvo": 105,
                "objetivo": "Despedida de Kha e carimbo final",
                "beats": [
                    {"id": "B8.1", "situacao": "Despedida ao amanhecer e carimbo final.", "locacao_id": "L01", "hora_do_dia": "amanhecer", "enquadramento": "aberto", "planos_estimados": 8, "fato_ids": ["F02"], "preco_ids": [], "tito_em_cena": "Tito fecha a maleta e acena para Kha.", "sentido": "visão", "som_ambiente": "Carimbo e vento", "grafico_na_tela": "carimbo_transicao", "cortavel_para_short": False},
                ],
                "loop_aberto": None,
            },
        ],
        "gancho_proximo_destino": {"destino": "Londres, 1348", "texto": "Na próxima viagem, o perigo vem nas pulgas."},
        "alertas": [],
    }

    erros = validar_esqueleto_arquiteto_v21(esqueleto_v22, entrada)
    assert erros == []
    # Confere se o validador em código calculou automaticamente o total de planos (166 planos)
    assert esqueleto_v22["episodio"]["planos_totais_estimados"] == 166


def test_roteirista_v3_narracao_em_planos_checklist():
    """Valida a especificação v3.0.0 do Roteirista — Narração em Planos (SOBREVIDA §8 a §13)."""
    from contratos.agentes import BlocoRoteiristaV3Output
    from grafo.roteiro.subgrafo import validar_bloco_roteirista_v3

    bloco_valido = {
        "bloco": 2,
        "nome": "Decisão 1",
        "palavras_total": 42,
        "duracao_estimada_s": 18.0,
        "planos": [
            {
                "id": "B2.p01",
                "beat_id": "B2.1",
                "movimento": "situa",
                "texto": "Dia quatro. Sua comida está na metade e a padaria fechou.",
                "palavras": 11,
                "duracao_s": 5.0,
                "enquadramento": "aberto",
                "nico_acao": "Nico observa a cruz pintada na porta da padaria.",
                "nico_estado": "saudavel_nervoso",
                "companheiro_em_cena": True,
                "locacao_id": "L02",
                "relogio": "faltam 5 dias",
                "luz": "amanhecer",
                "grafico": {"tipo": "relogio", "dados": {"texto": "FALTAM 5 DIAS"}},
                "hud": {"vida": 100, "comida": 50, "dinheiro_epoca": "três soldos", "dinheiro_brl": 15.0},
                "som": "Vento frio na rua vazia.",
                "musica": "tensao_baixa",
                "fato_ids": ["F01"],
                "curiosidade_bomba": False,
                "cortavel_para_short": False,
            },
            {
                "id": "B2.p02",
                "beat_id": "B2.2",
                "movimento": "opcoes",
                "texto": "Você tem duas opções. Nenhuma é boa. Opção A: fugir. Opção B: ficar. [PAUSA 2s] Escolha a sua.",
                "palavras": 18,
                "duracao_s": 7.0,
                "enquadramento": "simetrico",
                "nico_acao": "Nico parado na encruzilhada olhando para os dois lados.",
                "nico_estado": "saudavel_nervoso",
                "companheiro_em_cena": True,
                "locacao_id": "L02",
                "relogio": "faltam 5 dias",
                "luz": "dia",
                "grafico": {"tipo": "escolha_ab", "dados": {"A": "Fugir para o campo", "B": "Ficar na oficina"}},
                "hud": {"vida": 100, "comida": 50, "dinheiro_epoca": "três soldos", "dinheiro_brl": 15.0},
                "som": "Sino distante.",
                "musica": "tensao_media",
                "fato_ids": ["F01"],
                "curiosidade_bomba": False,
                "cortavel_para_short": True,
            },
            {
                "id": "B2.p03",
                "beat_id": "B2.3",
                "movimento": "consequencia",
                "texto": "Você fica na oficina. Dinheiro: mais dois soldos. Vida: menos quinze.",
                "palavras": 11,
                "duracao_s": 6.0,
                "enquadramento": "close",
                "nico_acao": "Nico cobre a boca e o nariz com o pano.",
                "nico_estado": "sujo_faminto",
                "companheiro_em_cena": False,
                "locacao_id": "L02",
                "relogio": "faltam 5 dias",
                "luz": "fim_de_tarde",
                "grafico": {"tipo": "hud_update", "dados": {"vida": -15, "dinheiro": 2}},
                "hud": {"vida": 85, "comida": 50, "dinheiro_epoca": "cinco soldos", "dinheiro_brl": 25.0},
                "som": "Bip seco do HUD e tosse no beco.",
                "musica": "tensao_media",
                "fato_ids": ["F01"],
                "curiosidade_bomba": False,
                "cortavel_para_short": True,
            },
        ],
        "alertas": [],
    }

    parsed = BlocoRoteiristaV3Output.model_validate(bloco_valido)
    assert parsed.bloco == 2
    assert len(parsed.planos) == 3

    erros = validar_bloco_roteirista_v3(bloco_valido, palavras_alvo_bloco=40, fatos_validos={"F01"})
    assert erros == []

    # Testa detecção de violações (enquadramento repetido, Nico falando, palavra proibida)
    bloco_invalido = {
        "bloco": 2,
        "nome": "Decisão 1",
        "palavras_total": 20,
        "duracao_estimada_s": 10.0,
        "planos": [
            {
                "id": "B2.p01",
                "beat_id": "B2.1",
                "movimento": "ameaca",
                "texto": "Isso é simplesmente incrível e chocante galera.",
                "palavras": 7,
                "duracao_s": 5.0,
                "enquadramento": "medio",  # erro: não abre com 'aberto'
                "nico_acao": "Nico grita pedindo socorro.",  # erro: Nico fala/grita
                "nico_estado": "saudavel_nervoso",
                "companheiro_em_cena": False,
                "locacao_id": "L02",
                "relogio": "faltam 5 dias",
                "luz": "dia",
                "grafico": {"tipo": "nenhum", "dados": {}},
                "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "três soldos", "dinheiro_brl": 15.0},
                "som": "Vento",
                "musica": "tensao_baixa",
                "fato_ids": ["F99"],  # erro: fato fora do esqueleto
            }
        ],
    }
    erros_inv = validar_bloco_roteirista_v3(bloco_invalido, palavras_alvo_bloco=40, fatos_validos={"F01"})
    assert len(erros_inv) >= 4


def test_arquiteto_estrutura_v30_as_5_decisoes_sobrevida():
    """Valida o Prompt v3.0.0 do Arquiteto de Estrutura — As 5 Decisões (SOBREVIDA §8 e §9.1)."""
    from contratos.agentes import ArquitetoEstruturaOutput
    from grafo.roteiro.subgrafo import validar_esqueleto_arquiteto_v21, validar_esqueleto_arquiteto_v30

    entrada_v30 = {
        "perigo": "Peste Negra",
        "lugar": "Florença, Itália",
        "data": "abril de 1348",
        "papel_do_jogador": "tecelão de lã, 20 anos, mora de aluguel",
        "serie": "Você Sobreviveria?",
        "duracao_alvo_min": 14,
        "titulo_previsto": "Você Sobreviveria à Peste Negra?",
        "promessa_thumbnail": "metade da cidade morre",
        "diagnostico_atencao": {
            "nivel_consciencia": 2,
            "sofisticacao": 4,
            "cliches_proibidos_na_abertura": ["máscara de bico", "ratos", "Idade das Trevas"],
            "erro_de_previsao_sugerido": "O inchaço na axila do padeiro antes do sol nascer.",
        },
        "fatos": [
            {"id": "F01", "texto": "Metade da população de Florença morreu em 1348.", "fonte": "Boccaccio", "confianca": "alta"},
            {"id": "F02", "texto": "Tecelões de lã trabalhavam no bairro de Santo Spirito.", "fonte": "Villani", "confianca": "alta"},
            {"id": "F03", "texto": "Casas infectadas eram trancadas por guardas da comuna.", "fonte": "Ordinamenti", "confianca": "alta"},
            {"id": "F04", "texto": "Fugir para o campo exigia provisões e transporte caro.", "fonte": "Boccaccio", "confianca": "alta"},
            {"id": "F05", "texto": "Queimar ervas aromáticas como alecrim era prática comum.", "fonte": "Gentile da Foligno", "confianca": "alta"},
        ],
        "precos": [
            {"id": "P01", "item": "poupança de tecelão", "valor_epoca": "12 soldos", "valor_brl": 60, "metodo_conversao": "jornal diário"},
            {"id": "P02", "item": "saco de farinha no câmbio da crise", "valor_epoca": "4 soldos", "valor_brl": 20, "metodo_conversao": "jornal diário"},
            {"id": "P03", "item": "aluguel de mula nos portões", "valor_epoca": "6 soldos", "valor_brl": 30, "metodo_conversao": "jornal diário"},
        ],
        "dados_mortalidade": [
            {"id": "M01", "grupo": "população de Florença", "taxa": "cerca de 55%", "fonte": "Villani", "confianca": "media"},
            {"id": "M02", "grupo": "trabalhadores têxteis confinados", "taxa": "cerca de 65%", "fonte": "Cohn", "confianca": "media"},
        ],
        "feedback_auditoria": None,
    }

    esqueleto_v30 = {
        "episodio": {
            "perigo": "Peste Negra",
            "lugar": "Florença, Itália",
            "data": "abril de 1348",
            "papel_do_jogador": "tecelão de lã, 20 anos",
            "duracao_alvo_min": 14,
            "palavras_alvo": 1960,
            "premissa": "Você é um tecelão em Florença em abril de 1348 e tem 6 semanas antes do pico da peste.",
            "erro_de_previsao": "A febre começa pelo vizinho que te vendeu pão ontem.",
            "promessa_thumbnail": "metade da cidade morre",
            "chance_base": {"valor": 45, "mortalidade_ids": ["M01"], "explicacao": "Cerca de 55% da cidade morreu entre abril e setembro de 1348."},
            "hud_inicial": {"vida": 100, "comida": 100, "dinheiro": {"valor_epoca": "12 soldos", "valor_brl": 60.0, "preco_ids": ["P01"]}},
            "companheiro": {
                "nome": "Bettina",
                "ficcional": True,
                "funcao": "vizinha, fiandeira",
                "desejo": "Juntar moedas para sair pelo portão sul até Siena.",
                "aparece_em": [1, 2, 4, 5, 8],
                "destino": "Fica presa no quarteirão interditado e não abre mais a janela na semana 6.",
                "destino_ids": ["M02"],
            },
            "objeto_plantado": {"objeto": "salvo-conduto de guilda com selo de cera", "plantado_em": 1, "pago_em": 6},
            "locacoes": [
                {"id": "L01", "descricao": "Oficina de tecelagem em Santo Spirito", "fato_ids": ["F02"]},
                {"id": "L02", "descricao": "Beco e cortiço de aluguel", "fato_ids": ["F03"]},
                {"id": "L03", "descricao": "Mercado de grãos de Orsanmichele", "fato_ids": ["F04"]},
                {"id": "L04", "descricao": "Portão de San Pier Gattolini", "fato_ids": ["F04"]},
            ],
        },
        "blocos": [
            {
                "ordem": 0,
                "bloco": "Entrada",
                "janela": "0:00-0:40",
                "palavras_alvo": 90,
                "relogio": "dia 1 · faltam 6 semanas para o pico",
                "objetivo": "Ligar o HUD cheio e cravar a chance base de 45%.",
                "beats": [
                    {"id": "B0.1", "situacao": "Suas barras aparecem cheias enquanto os sinos de Florença tocam ao amanhecer.", "fato_ids": ["F01"], "preco_ids": ["P01"], "nico_em_cena": "Nico confere a bolsinha com 12 soldos.", "sentido": "som", "locacao_id": "L01", "palavras_alvo": 45, "planos_estimados": 3, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                    {"id": "B0.2", "situacao": "Metade da cidade vai morrer até agosto e sua chance base é de 45%.", "fato_ids": ["F01"], "preco_ids": [], "nico_em_cena": "Nico engole seco olhando a rua estreita.", "sentido": "visão", "locacao_id": "L02", "palavras_alvo": 45, "planos_estimados": 3, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "nico_estado": "saudavel_nervoso",
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "O padeiro da esquina não abriu a janela hoje.", "fechado_em": 1},
            },
            {
                "ordem": 1,
                "bloco": "Situação",
                "janela": "0:40-2:00",
                "palavras_alvo": 190,
                "relogio": "dia 2 da peste",
                "objetivo": "Apresentar a rotina na oficina, Bettina e plantar o salvo-conduto.",
                "beats": [
                    {"id": "B1.1", "situacao": "Você bate o tear de madeira ao lado de Bettina e guarda o salvo-conduto da guilda.", "fato_ids": ["F02"], "preco_ids": [], "nico_em_cena": "Nico esconde o salvo-conduto de cera no bolso.", "sentido": "tato", "locacao_id": "L01", "palavras_alvo": 95, "planos_estimados": 6, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                    {"id": "B1.2", "situacao": "Guardas da comuna pregam tábuas na porta do padeiro com a família dentro.", "fato_ids": ["F03"], "preco_ids": [], "nico_em_cena": "Nico recua até a parede cobrindo a boca.", "sentido": "som", "locacao_id": "L02", "palavras_alvo": 95, "planos_estimados": 6, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "nico_estado": "saudavel_nervoso",
                "loop_aberto": {"tipo": "escolha_chegando", "texto": "O mestre da oficina manda abrir os fardos de lã recém-chegados do porto.", "fechado_em": 2},
            },
            {
                "ordem": 2,
                "bloco": "Decisão 1",
                "janela": "2:00-4:00",
                "palavras_alvo": 280,
                "relogio": "dia 5 da peste",
                "objetivo": "Primeira escolha entre salário e exposição às pulgas nos fardos.",
                "beats": [
                    {"id": "B2.1", "situacao": "Os fardos de lã crua chegam cheios de pulgas famintas.", "fato_ids": ["F02"], "preco_ids": [], "nico_em_cena": "Nico coça o pulso olhando a pilha de lã.", "sentido": "tato", "locacao_id": "L01", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B2.2", "situacao": "Você decide continuar batendo a lã para não perder o quarto, enquanto Bettina abandona o tear.", "fato_ids": ["F02", "F03"], "preco_ids": ["P01"], "nico_em_cena": "Nico puxa o cachecol sobre o nariz e trabalha.", "sentido": "cheiro", "locacao_id": "L01", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Trabalhar nos fardos de lã ou largar a oficina?",
                    "opcao_a": {
                        "texto": "Largar o tear infectado e guardar reserva de água",
                        "fato_ids": ["F02"],
                        "consequencia": "Você evita as pulgas dos fardos recém-abertos, mas perde parte da reserva.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": ["P01"]},
                        "impacto_chance": {"valor": 10, "justificativa_ids": ["M02"], "estimativa": False},
                    },
                    "opcao_b": {
                        "texto": "Continuar batendo os fardos na oficina fechada",
                        "fato_ids": ["F03"],
                        "consequencia": "Você mantém o salário, mas respira a poeira dos fardos.",
                        "hud_delta": {"vida": -25, "comida": 0, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -15, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "b",
                    "motivo_caminho_nico": "Ao ver o mestre cair febril, os tecelões mais jovens recuavam.",
                },
                "hud_depois": {"vida": 85, "comida": 90, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "nico_estado": "saudavel_nervoso",
                "loop_aberto": {"tipo": "barra_caindo", "texto": "O preço da farinha triplica no mercado de Orsanmichele.", "fechado_em": 3},
            },
            {
                "ordem": 3,
                "bloco": "Decisão 2",
                "janela": "4:00-6:00",
                "palavras_alvo": 280,
                "relogio": "semana 2 da peste",
                "objetivo": "Escolha entre gastar dinheiro no mercado lotado ou racionar.",
                "beats": [
                    {"id": "B3.1", "situacao": "A fila do trigo em Orsanmichele junta centenas de pessoas tossindo.", "fato_ids": ["F04"], "preco_ids": ["P02"], "nico_em_cena": "Nico aperta as moedas suadas na mão.", "sentido": "som", "locacao_id": "L03", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": True, "cortavel_para_short": False},
                    {"id": "B3.2", "situacao": "Você compra farinha cara na multidão e sente um calafrio na nuca.", "fato_ids": ["F04"], "preco_ids": ["P02"], "nico_em_cena": "Nico carrega o saco ralo contra o peito.", "sentido": "tato", "locacao_id": "L03", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Enfrentar o mercado lotado ou racionar as sobras?",
                    "opcao_a": {
                        "texto": "Comprar farinha no mercado lotado",
                        "fato_ids": ["F04"],
                        "consequencia": "Você garante pão, mas passa uma hora prensado na multidão.",
                        "hud_delta": {"vida": -20, "comida": 10, "dinheiro_preco_ids": ["P02"]},
                        "impacto_chance": {"valor": -5, "justificativa_ids": ["F04"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Racionar água e farelo em casa",
                        "fato_ids": ["F03"],
                        "consequencia": "Você evita a praça, mas perde forças rapidamente.",
                        "hud_delta": {"vida": -10, "comida": -30, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 5, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": None,
                    "motivo_caminho_nico": "A fome imediata empurrava os moradores para as filas de grãos.",
                },
                "hud_depois": {"vida": 65, "comida": 100, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "nico_estado": "saudavel_nervoso",
                "loop_aberto": {"tipo": "pressagio", "texto": "Os médicos da guilda receitam fogo e alecrim, mas o cheiro esconde outro perigo.", "fechado_em": 4},
            },
            {
                "ordem": 4,
                "bloco": "Decisão 3 · Virada",
                "janela": "6:00-8:00",
                "palavras_alvo": 280,
                "relogio": "semana 3 da peste",
                "objetivo": "Virada no meio do vídeo: trancar-se no cortiço mantém você junto dos ratos.",
                "beats": [
                    {"id": "B4.1", "situacao": "Fumar alecrim não impede que os ratos mortos caiam do forro de palha sobre a cama.", "fato_ids": ["F03", "F05"], "preco_ids": [], "nico_em_cena": "Nico dá um passo para trás olhando o forro do teto.", "sentido": "cheiro", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B4.2", "situacao": "Ficar trancado no quarto que parecia seguro concentra as pulgas no colchão.", "fato_ids": ["F03", "F05"], "preco_ids": [], "nico_em_cena": "Nico sacode o cobertor perto da janela.", "sentido": "visão", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Dormir trancado com braseiro de ervas ou dormir no pátio aberto?",
                    "opcao_a": {
                        "texto": "Trancar janelas e queimar alecrim",
                        "fato_ids": ["F05"],
                        "consequencia": "A fumaça sufoca e as pulgas do forro descem para o colchão.",
                        "hud_delta": {"vida": -20, "comida": -20, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -15, "justificativa_ids": ["M02"], "estimativa": False},
                    },
                    "opcao_b": {
                        "texto": "Dormir no pátio frio longe do forro de palha",
                        "fato_ids": ["F03"],
                        "consequencia": "Você passa frio e chuva, mas reduz as picadas.",
                        "hud_delta": {"vida": -10, "comida": -15, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 10, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "a",
                    "motivo_caminho_nico": "A teoria miasmática convencia quase todos a vedar janelas contra o 'ar corrompido'.",
                },
                "hud_depois": {"vida": 45, "comida": 80, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "nico_estado": "sujo_faminto",
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "De madrugada, Bettina bate na sua parede pedindo água com a voz rouca.", "fechado_em": 5},
            },
            {
                "ordem": 5,
                "bloco": "Decisão 4",
                "janela": "8:00-10:00",
                "palavras_alvo": 280,
                "relogio": "semana 4 da peste",
                "objetivo": "Bettina está em perigo; escolha moral de alto custo.",
                "beats": [
                    {"id": "B5.1", "situacao": "Os guardas da comuna chegam para pregar a porta do quarto de Bettina.", "fato_ids": ["F03"], "preco_ids": [], "nico_em_cena": "Nico segura a alça da jarra de água na escada.", "sentido": "som", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": False},
                    {"id": "B5.2", "situacao": "Você deixa pão e água na soleira antes dos guardas subirem, mas respira o ar do corredor.", "fato_ids": ["F03"], "preco_ids": [], "nico_em_cena": "Nico pousa a jarra no chão e corre pela escada.", "sentido": "tato", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Ajudar Bettina no corredor ou sair do prédio imediatamente?",
                    "opcao_a": {
                        "texto": "Levar água e pão até a porta de Bettina",
                        "fato_ids": ["F03"],
                        "consequencia": "Você divide sua comida e quase é trancado junto pelos guardas.",
                        "hud_delta": {"vida": -25, "comida": -30, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 8, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Descer a escada sem olhar para trás",
                        "fato_ids": ["F04"],
                        "consequencia": "Você poupa comida, mas dorme na rua sob vigilância.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 12, "justificativa_ids": ["F04"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "b",
                    "motivo_caminho_nico": "Vizinhos e parentes tentavam deixar água antes do lacre das portas.",
                },
                "hud_depois": {"vida": 20, "comida": 50, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "nico_estado": "exausto_ferido",
                "loop_aberto": {"tipo": "prazo", "texto": "O portão sul vai fechar ao pôr do sol e sua barra de Vida está em 20.", "fechado_em": 6},
            },
            {
                "ordem": 6,
                "bloco": "Decisão 5 · Ponto sem volta",
                "janela": "10:00-12:00",
                "palavras_alvo": 280,
                "relogio": "semana 5 · faltam 2 horas para fechar o portão",
                "objetivo": "Uso do salvo-conduto plantado na Situação e escolha final com Vida baixa.",
                "beats": [
                    {"id": "B6.1", "situacao": "No portão de San Pier Gattolini, você tira do bolso o salvo-conduto de cera da guilda.", "fato_ids": ["F04"], "preco_ids": ["P03"], "nico_em_cena": "Nico ergue o salvo-conduto com a mão trêmula.", "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B6.2", "situacao": "A carroça de lã sai pela estrada lamacenta exigindo suas últimas moedas.", "fato_ids": ["F04"], "preco_ids": ["P03"], "nico_em_cena": "Nico entrega os soldos e sobe na traseira da carroça.", "sentido": "tato", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Usar o salvo-conduto e pagar a carroça de lã ou esconder-se na igreja?",
                    "opcao_a": {
                        "texto": "Sair pelo portão com o salvo-conduto e pagar 6 soldos",
                        "fato_ids": ["F04"],
                        "consequencia": "Você atravessa o portão exausto rumo às colinas.",
                        "hud_delta": {"vida": -5, "comida": -20, "dinheiro_preco_ids": ["P03"]},
                        "impacto_chance": {"valor": -12, "justificativa_ids": ["M01"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Buscar abrigo nas missas coletivas da igreja",
                        "fato_ids": ["F01"],
                        "consequencia": "A aglomeração na nave fechada multiplica o contágio.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -25, "justificativa_ids": ["M01"], "estimativa": False},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": None,
                    "motivo_caminho_nico": "Quem possuía salvo-conduto de mercador tentava cruzar os portões na última hora.",
                },
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "nico_estado": "exausto_ferido",
                "loop_aberto": {"tipo": "escolha_chegando", "texto": "As colinas aparecem na neblina, mas qual foi a sua porcentagem real de sair vivo?", "fechado_em": 7},
            },
            {
                "ordem": 7,
                "bloco": "Resultado",
                "janela": "12:00-13:00",
                "palavras_alvo": 140,
                "relogio": "semana 6 da peste",
                "objetivo": "Revelar os 31% de chance final do Nico e mostrar a tabela do espectador.",
                "beats": [
                    {"id": "B7.1", "situacao": "A conta fecha em 31% de chance de sobrevivência, uma estimativa baseada nas crônicas de Florença.", "fato_ids": ["F01"], "preco_ids": [], "nico_em_cena": "Nico senta na pedra da estrada respirando fundo.", "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "nico_estado": "exausto_ferido",
                "loop_aberto": None,
            },
            {
                "ordem": 8,
                "bloco": "Saída",
                "janela": "13:00-14:00",
                "palavras_alvo": 140,
                "relogio": "setembro de 1348",
                "objetivo": "Honrar as vítimas reais, revelar a janela fechada de Bettina e lançar o próximo perigo.",
                "beats": [
                    {"id": "B8.1", "situacao": "Cerca de 50 mil florentinos morreram em cinco meses; a janela de Bettina permaneceu fechada com uma vela apagada.", "fato_ids": ["F01", "F03"], "preco_ids": [], "nico_em_cena": "Nico olha para a cidade ao longe em silêncio.", "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "nico_estado": "exausto_ferido",
                "loop_aberto": None,
            },
        ],
        "resultado": {
            "chance_final_nico": 31,
            "conta": "45 + 10 - 5 - 15 + 8 - 12 = 31",
            "tabela_espectador": [
                {"decisao": 1, "a": 10, "b": -15},
                {"decisao": 2, "a": -5, "b": 5},
                {"decisao": 3, "a": -15, "b": 10},
                {"decisao": 4, "a": 8, "b": 12},
                {"decisao": 5, "a": -12, "b": -25},
            ],
            "tem_estimativa": True,
        },
        "gancho_proximo_perigo": {
            "perigo": "Cerco de Constantinopla, 1453",
            "texto": "Comenta a sua porcentagem. Você sobreviveu a este. O próximo pode não ser tão gentil.",
        },
        "alertas": ["Modificadores das decisões 2, 4 e 5 marcados como estimativa."],
    }

    parsed = ArquitetoEstruturaOutput.model_validate(esqueleto_v30)
    assert parsed.episodio.perigo == "Peste Negra"
    assert parsed.resultado.chance_final_nico == 31

    erros = validar_esqueleto_arquiteto_v30(esqueleto_v30, entrada_v30)
    assert erros == []
    assert validar_esqueleto_arquiteto_v21(esqueleto_v30, entrada_v30) == []

    # Testa detecção de erros do validador automático §9.1 (relógio voltando para trás + conta da chance errada)
    import copy
    esqueleto_invalido = copy.deepcopy(esqueleto_v30)
    esqueleto_invalido["blocos"][3]["relogio"] = "dia 3 da peste"  # após 'dia 5 da peste' no bloco 2
    esqueleto_invalido["resultado"]["chance_final_nico"] = 88
    erros_inv = validar_esqueleto_arquiteto_v30(esqueleto_invalido, entrada_v30)
    assert any("relógio voltou para trás" in e for e in erros_inv)
    assert any("chance_final_nico" in e for e in erros_inv)


def test_sobrevida_v31_pov_arquiteto_roteirista_e_diretor_cenas():
    """Valida Arquiteto v3.1.0 (POV realista), Roteirista v3.1.0 (POV realista) e Diretor de Cenas v1.0.0."""
    import copy
    from contratos.agentes import (
        ArquitetoEstruturaOutput,
        BlocoRoteiristaV3Output,
        DiretorCenasBlocoOutput,
    )
    from grafo.direcao.engenheiro_prompt_imagem import (
        gerar_bloco_diretor_cenas_pov,
        validar_bloco_diretor_cenas_pov,
    )
    from grafo.roteiro.subgrafo import (
        validar_bloco_roteirista_v3,
        validar_esqueleto_arquiteto_v30,
    )

    entrada_v31 = {
        "perigo": "Peste Negra",
        "lugar": "Florença, Itália",
        "data": "abril de 1348",
        "papel_do_jogador": "tecelão de lã, 20 anos, mora de aluguel",
        "serie": "Você Sobreviveria?",
        "duracao_alvo_min": 14,
        "titulo_previsto": "Você Sobreviveria à Peste Negra?",
        "promessa_thumbnail": "metade da cidade morre",
        "diagnostico_atencao": {
            "nivel_consciencia": 2,
            "sofisticacao": 4,
            "cliches_proibidos_na_abertura": ["máscara de bico", "ratos", "Idade das Trevas"],
            "erro_de_previsao_sugerido": "Fechar a janela atraía as pulgas do forro.",
        },
        "fatos": [
            {"id": "F01", "texto": "Sinos de Florença dobravam a cada hora em abril de 1348.", "fonte": "Villani", "confianca": "alta"},
            {"id": "F02", "texto": "Fardos de lã crua concentravam pulgas nas oficinas.", "fonte": "Cohn 2002", "confianca": "alta"},
            {"id": "F03", "texto": "Guardas pregavam tábuas nas portas das casas infectadas.", "fonte": "Boccaccio", "confianca": "alta"},
            {"id": "F04", "texto": "Filas de trigo em Orsanmichele reuniam centenas de moradores.", "fonte": "Pinto 1978", "confianca": "alta"},
            {"id": "F05", "texto": "Médicos receitavam queimar alecrim com janelas trancadas.", "fonte": "Gentile da Foligno", "confianca": "alta"},
        ],
        "precos": [
            {"id": "P01", "item": "aluguel de quarto por semana", "valor_epoca": "12 soldos", "valor_brl": 60.0, "metodo_conversao": "jornal"},
            {"id": "P02", "item": "saco de farinha de trigo", "valor_epoca": "4 soldos", "valor_brl": 20.0, "metodo_conversao": "jornal"},
            {"id": "P03", "item": "suborno no portão sul", "valor_epoca": "6 soldos", "valor_brl": 30.0, "metodo_conversao": "jornal"},
        ],
        "dados_mortalidade": [
            {"id": "M01", "grupo": "população de Florença", "taxa": "55%", "fonte": "Villani", "confianca": "media"},
            {"id": "M02", "grupo": "trabalhadores têxteis confinados", "taxa": "70%", "fonte": "Cohn", "confianca": "media"},
        ],
    }

    esqueleto_v31 = {
        "episodio": {
            "perigo": "Peste Negra",
            "lugar": "Florença, Itália",
            "data": "abril de 1348",
            "papel_do_jogador": "tecelão de lã, 20 anos",
            "duracao_alvo_min": 14,
            "palavras_alvo": 1960,
            "premissa": "Você é um tecelão em Florença em abril de 1348 e tem 6 semanas antes do pico da peste.",
            "erro_de_previsao": "A febre começa pelo vizinho que te vendeu pão ontem.",
            "promessa_thumbnail": "metade da cidade morre",
            "chance_base": {"valor": 45, "mortalidade_ids": ["M01"], "explicacao": "Cerca de 55% da cidade morreu."},
            "hud_inicial": {"vida": 100, "comida": 100, "dinheiro": {"valor_epoca": "12 soldos", "valor_brl": 60.0, "preco_ids": ["P01"]}},
            "companheiro": {
                "nome": "Bettina",
                "ficcional": True,
                "funcao": "vizinha, fiandeira",
                "descricao_visual": "young woman around 22, olive skin, dark braided hair under a linen coif, mole on left cheek, wooden spindle in belt",
                "marcas_fixas": ["touca de linho", "sinal na bochecha esquerda", "fuso de madeira no cinto"],
                "desejo": "Juntar moedas para sair pelo portão sul até Siena.",
                "aparece_em": [1, 2, 4, 5, 8],
                "destino": "Fica presa no quarteirão interditado e não abre mais a janela na semana 6.",
                "destino_ids": ["M02"],
            },
            "objeto_plantado": {"objeto": "salvo-conduto de guilda com selo de cera", "plantado_em": 1, "pago_em": 6},
            "locacoes": [
                {"id": "L01", "descricao": "Dark medieval wool workshop in Santo Spirito, wooden looms", "fato_ids": ["F02"]},
                {"id": "L02", "descricao": "Narrow stone alley in 1348 Florence, timber overhangs", "fato_ids": ["F03"]},
                {"id": "L03", "descricao": "Crowded grain loggia of Orsanmichele, wooden barrels", "fato_ids": ["F04"]},
                {"id": "L04", "descricao": "Heavy wooden city gate of San Pier Gattolini under rain", "fato_ids": ["F04"]},
            ],
        },
        "blocos": [
            {
                "ordem": 0,
                "bloco": "Entrada",
                "janela": "0:00-0:40",
                "palavras_alvo": 90,
                "relogio": "dia 1 · faltam 6 semanas para o pico",
                "objetivo": "Ligar o HUD cheio e cravar a chance base de 45%.",
                "beats": [
                    {"id": "B0.1", "situacao": "Suas barras aparecem cheias enquanto os sinos de Florença tocam ao amanhecer.", "fato_ids": ["F01"], "preco_ids": ["P01"], "pov_em_cena": "Suas mãos abrem a bolsa de couro e contam 12 soldos.", "reflexo": False, "sentido": "som", "locacao_id": "L01", "palavras_alvo": 45, "planos_estimados": 3, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                    {"id": "B0.2", "situacao": "Metade da cidade vai morrer até agosto e sua chance base é de 45%.", "fato_ids": ["F01"], "preco_ids": [], "pov_em_cena": "Você olha pela janela estreita para a rua vazia.", "reflexo": False, "sentido": "visão", "locacao_id": "L02", "palavras_alvo": 45, "planos_estimados": 3, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "corpo_estado": "inteiro",
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "O padeiro da esquina não abriu a janela hoje.", "fechado_em": 1},
            },
            {
                "ordem": 1,
                "bloco": "Situação",
                "janela": "0:40-2:00",
                "palavras_alvo": 190,
                "relogio": "dia 2 da peste",
                "objetivo": "Apresentar a rotina na oficina, Bettina e plantar o salvo-conduto.",
                "beats": [
                    {"id": "B1.1", "situacao": "Você bate o tear de madeira ao lado de Bettina e guarda o salvo-conduto da guilda.", "fato_ids": ["F02"], "preco_ids": [], "pov_em_cena": "Sua mão direita esconde o salvo-conduto de cera no bolso.", "reflexo": False, "sentido": "tato", "locacao_id": "L01", "palavras_alvo": 95, "planos_estimados": 6, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                    {"id": "B1.2", "situacao": "Guardas da comuna pregam tábuas na porta do padeiro com a família dentro.", "fato_ids": ["F03"], "preco_ids": [], "pov_em_cena": "Você recua até a parede cobrindo o nariz com o antebraço.", "reflexo": False, "sentido": "som", "locacao_id": "L02", "palavras_alvo": 95, "planos_estimados": 6, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "corpo_estado": "inteiro",
                "loop_aberto": {"tipo": "escolha_chegando", "texto": "O mestre da oficina manda abrir os fardos de lã recém-chegados do porto.", "fechado_em": 2},
            },
            {
                "ordem": 2,
                "bloco": "Decisão 1",
                "janela": "2:00-4:00",
                "palavras_alvo": 280,
                "relogio": "dia 5 da peste",
                "objetivo": "Primeira escolha entre salário e exposição às pulgas nos fardos.",
                "beats": [
                    {"id": "B2.1", "situacao": "Os fardos de lã crua chegam cheios de pulgas famintas.", "fato_ids": ["F02"], "preco_ids": [], "pov_em_cena": "Sua mão esquerda coça o pulso vermelho sobre a lã crua.", "reflexo": False, "sentido": "tato", "locacao_id": "L01", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B2.2", "situacao": "Você decide largar o tear infectado enquanto Bettina permanece na bancada.", "fato_ids": ["F02", "F03"], "preco_ids": ["P01"], "pov_em_cena": "Você puxa a manga de linho sobre o nariz e se afasta do tear.", "reflexo": False, "sentido": "cheiro", "locacao_id": "L01", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Trabalhar nos fardos de lã ou largar a oficina?",
                    "opcao_a": {
                        "texto": "Largar o tear infectado e guardar reserva de água",
                        "fato_ids": ["F02"],
                        "consequencia": "Você evita as pulgas dos fardos recém-abertos, mas perde parte da reserva.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": ["P01"]},
                        "impacto_chance": {"valor": 10, "justificativa_ids": ["M02"], "estimativa": False},
                    },
                    "opcao_b": {
                        "texto": "Continuar batendo os fardos na oficina fechada",
                        "fato_ids": ["F03"],
                        "consequencia": "Você mantém o salário, mas respira a poeira dos fardos.",
                        "hud_delta": {"vida": -25, "comida": 0, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -15, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "b",
                    "motivo_caminho_nico": "Ao ver o mestre cair febril, os tecelões mais jovens recuavam.",
                },
                "hud_depois": {"vida": 85, "comida": 90, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "corpo_estado": "inteiro",
                "loop_aberto": {"tipo": "barra_caindo", "texto": "O preço da farinha triplica no mercado de Orsanmichele.", "fechado_em": 3},
            },
            {
                "ordem": 3,
                "bloco": "Decisão 2",
                "janela": "4:00-6:00",
                "palavras_alvo": 280,
                "relogio": "semana 2 da peste",
                "objetivo": "Escolha entre gastar dinheiro no mercado lotado ou racionar.",
                "beats": [
                    {"id": "B3.1", "situacao": "A fila do trigo em Orsanmichele junta centenas de pessoas tossindo.", "fato_ids": ["F04"], "preco_ids": ["P02"], "pov_em_cena": "Suas mãos apertam 4 soldos suados diante do balcão.", "reflexo": False, "sentido": "som", "locacao_id": "L03", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": True, "cortavel_para_short": False},
                    {"id": "B3.2", "situacao": "Você compra farinha cara na multidão e sente um calafrio na nuca.", "fato_ids": ["F04"], "preco_ids": ["P02"], "pov_em_cena": "Seus braços seguram o saco ralo contra o peito.", "reflexo": False, "sentido": "tato", "locacao_id": "L03", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Enfrentar o mercado lotado ou racionar as sobras?",
                    "opcao_a": {
                        "texto": "Comprar farinha no mercado lotado",
                        "fato_ids": ["F04"],
                        "consequencia": "Você garante pão, mas passa uma hora prensado na multidão.",
                        "hud_delta": {"vida": -20, "comida": 10, "dinheiro_preco_ids": ["P02"]},
                        "impacto_chance": {"valor": -5, "justificativa_ids": ["F04"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Racionar água e farelo em casa",
                        "fato_ids": ["F03"],
                        "consequencia": "Você evita a praça, mas perde forças rapidamente.",
                        "hud_delta": {"vida": -10, "comida": -30, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 5, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": None,
                    "motivo_caminho_nico": "A fome imediata empurrava os moradores para as filas de grãos.",
                },
                "hud_depois": {"vida": 65, "comida": 100, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "corpo_estado": "inteiro",
                "loop_aberto": {"tipo": "pressagio", "texto": "Os médicos da guilda receitam fogo e alecrim, mas o cheiro esconde outro perigo.", "fechado_em": 4},
            },
            {
                "ordem": 4,
                "bloco": "Decisão 3 · Virada",
                "janela": "6:00-8:00",
                "palavras_alvo": 280,
                "relogio": "semana 3 da peste",
                "objetivo": "Virada no meio do vídeo: trancar-se no cortiço mantém você junto dos ratos.",
                "beats": [
                    {"id": "B4.1", "situacao": "Fumar alecrim não impede que os ratos mortos caiam do forro de palha sobre a cama.", "fato_ids": ["F03", "F05"], "preco_ids": [], "pov_em_cena": "Você olha para cima e vê a palha cedendo no teto.", "reflexo": False, "sentido": "cheiro", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B4.2", "situacao": "Ficar trancado no quarto que parecia seguro concentra as pulgas no colchão.", "fato_ids": ["F03", "F05"], "preco_ids": [], "pov_em_cena": "Suas mãos sacodem o cobertor cheio de pontos pretos.", "reflexo": False, "sentido": "visão", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Dormir trancado com braseiro de ervas ou dormir no pátio aberto?",
                    "opcao_a": {
                        "texto": "Trancar janelas e queimar alecrim",
                        "fato_ids": ["F05"],
                        "consequencia": "A fumaça sufoca e as pulgas do forro descem para o colchão.",
                        "hud_delta": {"vida": -20, "comida": -20, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -15, "justificativa_ids": ["M02"], "estimativa": False},
                    },
                    "opcao_b": {
                        "texto": "Dormir no pátio frio longe do forro de palha",
                        "fato_ids": ["F03"],
                        "consequencia": "Você passa frio e chuva, mas reduz as picadas.",
                        "hud_delta": {"vida": -10, "comida": -15, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 10, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "a",
                    "motivo_caminho_nico": "A teoria miasmática convencia quase todos a vedar janelas contra o 'ar corrompido'.",
                },
                "hud_depois": {"vida": 45, "comida": 80, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "corpo_estado": "desgastado",
                "loop_aberto": {"tipo": "ameaca_fisica", "texto": "De madrugada, Bettina bate na sua parede pedindo água com a voz rouca.", "fechado_em": 5},
            },
            {
                "ordem": 5,
                "bloco": "Decisão 4",
                "janela": "8:00-10:00",
                "palavras_alvo": 280,
                "relogio": "semana 4 da peste",
                "objetivo": "Bettina está em perigo; escolha moral de alto custo.",
                "beats": [
                    {"id": "B5.1", "situacao": "Os guardas da comuna chegam para pregar a porta do quarto de Bettina.", "fato_ids": ["F03"], "preco_ids": [], "pov_em_cena": "Você olha a bacia de água na escada e vê seu reflexo pálido tremer.", "reflexo": True, "sentido": "som", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": True, "cortavel_para_short": False},
                    {"id": "B5.2", "situacao": "Você deixa pão e água na soleira antes dos guardas subirem, mas respira o ar do corredor.", "fato_ids": ["F03"], "preco_ids": [], "pov_em_cena": "Suas mãos pousam a jarra na soleira e empurram o pão.", "reflexo": False, "sentido": "tato", "locacao_id": "L02", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Ajudar Bettina no corredor ou sair do prédio imediatamente?",
                    "opcao_a": {
                        "texto": "Levar água e pão até a porta de Bettina",
                        "fato_ids": ["F03"],
                        "consequencia": "Você divide sua comida e quase é trancado junto pelos guardas.",
                        "hud_delta": {"vida": -25, "comida": -30, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 8, "justificativa_ids": ["F03"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Descer a escada sem olhar para trás",
                        "fato_ids": ["F04"],
                        "consequencia": "Você poupa comida, mas dorme na rua sob vigilância.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": 12, "justificativa_ids": ["F04"], "estimativa": True},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": "b",
                    "motivo_caminho_nico": "Vizinhos e parentes tentavam deixar água antes do lacre das portas.",
                },
                "hud_depois": {"vida": 20, "comida": 50, "dinheiro_epoca": "8 soldos", "dinheiro_brl": 40.0},
                "corpo_estado": "no_limite",
                "loop_aberto": {"tipo": "prazo", "texto": "O portão sul vai fechar ao pôr do sol e sua barra de Vida está em 20.", "fechado_em": 6},
            },
            {
                "ordem": 6,
                "bloco": "Decisão 5 · Ponto sem volta",
                "janela": "10:00-12:00",
                "palavras_alvo": 280,
                "relogio": "semana 5 · faltam 2 horas para fechar o portão",
                "objetivo": "Uso do salvo-conduto plantado na Situação e escolha final com Vida baixa.",
                "beats": [
                    {"id": "B6.1", "situacao": "No portão de San Pier Gattolini, você tira do bolso o salvo-conduto de guilda com selo de cera.", "fato_ids": ["F04"], "preco_ids": ["P03"], "pov_em_cena": "Sua mão direita trêmula ergue o salvo-conduto de cera ao guarda.", "reflexo": False, "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": True, "cortavel_para_short": True},
                    {"id": "B6.2", "situacao": "A carroça de lã sai pela estrada lamacenta exigindo suas últimas moedas.", "fato_ids": ["F04"], "preco_ids": ["P03"], "pov_em_cena": "Suas mãos entregam os 6 soldos e agarram a borda da carroça.", "reflexo": False, "sentido": "tato", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": {
                    "pergunta": "Usar o salvo-conduto e pagar a carroça de lã ou esconder-se na igreja?",
                    "opcao_a": {
                        "texto": "Sair pelo portão com o salvo-conduto e pagar 6 soldos",
                        "fato_ids": ["F04"],
                        "consequencia": "Você atravessa o portão exausto rumo às colinas.",
                        "hud_delta": {"vida": -5, "comida": -20, "dinheiro_preco_ids": ["P03"]},
                        "impacto_chance": {"valor": -12, "justificativa_ids": ["M01"], "estimativa": True},
                    },
                    "opcao_b": {
                        "texto": "Buscar abrigo nas missas coletivas da igreja",
                        "fato_ids": ["F01"],
                        "consequencia": "A aglomeração na nave fechada multiplica o contágio.",
                        "hud_delta": {"vida": -15, "comida": -10, "dinheiro_preco_ids": []},
                        "impacto_chance": {"valor": -25, "justificativa_ids": ["M01"], "estimativa": False},
                    },
                    "caminho_nico": "a",
                    "caminho_companheiro": None,
                    "motivo_caminho_nico": "Quem possuía salvo-conduto de mercador tentava cruzar os portões na última hora.",
                },
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "corpo_estado": "no_limite",
                "loop_aberto": {"tipo": "escolha_chegando", "texto": "As colinas aparecem na neblina, mas qual foi a sua porcentagem real de sair vivo?", "fechado_em": 7},
            },
            {
                "ordem": 7,
                "bloco": "Resultado",
                "janela": "12:00-13:00",
                "palavras_alvo": 140,
                "relogio": "semana 6 da peste",
                "objetivo": "Revelar os 31% de chance final do Nico e mostrar a tabela do espectador.",
                "beats": [
                    {"id": "B7.1", "situacao": "A conta fecha em 31% de chance de sobrevivência, uma estimativa baseada nas crônicas de Florença.", "fato_ids": ["F01"], "preco_ids": [], "pov_em_cena": "Você olha para suas mãos sujas apoiadas nos joelhos na estrada.", "reflexo": False, "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": False, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "corpo_estado": "no_limite",
                "loop_aberto": None,
            },
            {
                "ordem": 8,
                "bloco": "Saída",
                "janela": "13:00-14:00",
                "palavras_alvo": 140,
                "relogio": "setembro de 1348",
                "objetivo": "Honrar as vítimas reais, revelar a janela fechada de Bettina e lançar o próximo perigo.",
                "beats": [
                    {"id": "B8.1", "situacao": "Cerca de 50 mil florentinos morreram em cinco meses; a janela de Bettina permaneceu fechada com uma vela apagada.", "fato_ids": ["F01", "F03"], "preco_ids": [], "pov_em_cena": "Do alto da colina, você vê os telhados de Florença sob a fumaça.", "reflexo": False, "sentido": "visão", "locacao_id": "L04", "palavras_alvo": 140, "planos_estimados": 9, "companheiro_em_cena": True, "curiosidade_bomba": False, "cortavel_para_short": False},
                ],
                "decisao": None,
                "hud_depois": {"vida": 15, "comida": 30, "dinheiro_epoca": "2 soldos", "dinheiro_brl": 10.0},
                "corpo_estado": "no_limite",
                "loop_aberto": None,
            },
        ],
        "resultado": {
            "chance_final_nico": 31,
            "conta": "45 + 10 - 5 - 15 + 8 - 12 = 31",
            "tabela_espectador": [
                {"decisao": 1, "a": 10, "b": -15},
                {"decisao": 2, "a": -5, "b": 5},
                {"decisao": 3, "a": -15, "b": 10},
                {"decisao": 4, "a": 8, "b": 12},
                {"decisao": 5, "a": -12, "b": -25},
            ],
            "tem_estimativa": True,
        },
        "gancho_proximo_perigo": {
            "perigo": "Cerco de Constantinopla, 1453",
            "texto": "Comenta a sua porcentagem. Você sobreviveu a este. O próximo pode não ser tão gentil.",
        },
        "alertas": [],
    }

    parsed_arq = ArquitetoEstruturaOutput.model_validate(esqueleto_v31)
    assert parsed_arq.episodio.companheiro.marcas_fixas[0] == "touca de linho"
    erros_arq = validar_esqueleto_arquiteto_v30(esqueleto_v31, entrada_v31)
    assert erros_arq == []

    # Testa rejeição de Nico em 3ª pessoa em pov_em_cena e mais de 1 reflexo
    esq_bad_pov = copy.deepcopy(esqueleto_v31)
    esq_bad_pov["blocos"][0]["beats"][0]["pov_em_cena"] = "Nico caminha pela rua olhando para os lados."
    esq_bad_pov["blocos"][0]["beats"][0]["reflexo"] = True
    erros_bad_pov = validar_esqueleto_arquiteto_v30(esq_bad_pov, entrada_v31)
    assert any("3ª pessoa" in e for e in erros_bad_pov)
    assert any("reflexo" in e for e in erros_bad_pov)

    # 2. Testa Roteirista v3.1.0 POV Realista (Bloco 2 - Decisão 1)
    roteiro_bloco_v31 = {
        "bloco": 2,
        "nome": "Decisão 1",
        "palavras_total": 85,
        "duracao_estimada_s": 32.0,
        "planos": [
            {
                "id": "B2.p01",
                "beat_id": "B2.1",
                "movimento": "situa",
                "texto": "Dia cinco na oficina de Santo Spirito. Os fardos de lã crua chegam do porto.",
                "palavras": 15,
                "duracao_s": 5.5,
                "enquadramento": "aberto",
                "pov_acao": None,
                "maos_visiveis": False,
                "corpo_estado": "inteiro",
                "animar": False,
                "companheiro_em_cena": False,
                "locacao_id": "L01",
                "relogio": "dia 5 da peste",
                "luz": "amanhecer",
                "grafico": {"tipo": "relogio", "dados": {"texto": "DIA 5"}},
                "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "som": "Portas de madeira rangendo e vento frio.",
                "musica": "tensao_baixa",
                "fato_ids": ["F02"],
                "curiosidade_bomba": False,
                "cortavel_para_short": False,
            },
            {
                "id": "B2.p02",
                "beat_id": "B2.1",
                "movimento": "ameaca",
                "texto": "Dentro da lã abafada, milhares de pulgas famintas esperam o primeiro calor humano.",
                "palavras": 13,
                "duracao_s": 5.0,
                "enquadramento": "pov_maos",
                "pov_acao": "Suas duas mãos abrem a corda de cânhamo do fardo de lã.",
                "maos_visiveis": True,
                "corpo_estado": "inteiro",
                "animar": True,
                "companheiro_em_cena": False,
                "locacao_id": "L01",
                "relogio": "dia 5 da peste",
                "luz": "dia",
                "grafico": {"tipo": "nenhum", "dados": {}},
                "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "som": "Corda áspera estalando.",
                "musica": "tensao_media",
                "fato_ids": ["F02"],
                "curiosidade_bomba": True,
                "cortavel_para_short": True,
            },
            {
                "id": "B2.p03",
                "beat_id": "B2.1",
                "movimento": "opcoes",
                "texto": "Você tem duas opções. Opção A: largar o tear. Opção B: continuar batendo a lã. [PAUSA 2s] Escolha a sua.",
                "palavras": 20,
                "duracao_s": 6.5,
                "enquadramento": "escolha_ab",
                "pov_acao": "Suas duas mãos abertas hesitam entre a porta da rua e a bancada de lã.",
                "maos_visiveis": True,
                "corpo_estado": "inteiro",
                "animar": True,
                "companheiro_em_cena": False,
                "locacao_id": "L01",
                "relogio": "dia 5 da peste",
                "luz": "dia",
                "grafico": {"tipo": "escolha_ab", "dados": {"A": "Largar o tear", "B": "Continuar batendo lã"}},
                "hud": {"vida": 100, "comida": 100, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "som": "Batimento cardíaco seco.",
                "musica": "tensao_alta",
                "fato_ids": ["F02"],
                "curiosidade_bomba": False,
                "cortavel_para_short": False,
            },
            {
                "id": "B2.p04",
                "beat_id": "B2.2",
                "movimento": "consequencia",
                "texto": "Bettina fica na bancada para não perder o dia. Você puxa a manga sobre o nariz e recua.",
                "palavras": 18,
                "duracao_s": 6.0,
                "enquadramento": "pov_companheiro",
                "pov_acao": "Sua mão direita apoia na viga do tear enquanto olha para Bettina.",
                "maos_visiveis": True,
                "corpo_estado": "inteiro",
                "animar": False,
                "companheiro_em_cena": True,
                "locacao_id": "L01",
                "relogio": "dia 5 da peste",
                "luz": "fim_de_tarde",
                "grafico": {"tipo": "hud_update", "dados": {"vida": -15, "comida": -10}},
                "hud": {"vida": 85, "comida": 90, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "som": "Tear de madeira batendo e passos recuando.",
                "musica": "tensao_media",
                "fato_ids": ["F02", "F03"],
                "curiosidade_bomba": False,
                "cortavel_para_short": False,
            },
            {
                "id": "B2.p05",
                "beat_id": "B2.2",
                "movimento": "loop_aberto",
                "texto": "Lá fora, o sino da praça anuncia que o preço da farinha acaba de triplicar.",
                "palavras": 15,
                "duracao_s": 4.5,
                "enquadramento": "detalhe",
                "pov_acao": None,
                "maos_visiveis": False,
                "corpo_estado": "inteiro",
                "animar": False,
                "companheiro_em_cena": False,
                "locacao_id": "L01",
                "relogio": "dia 5 da peste",
                "luz": "noite",
                "grafico": {"tipo": "tela_escura", "dados": {}},
                "hud": {"vida": 85, "comida": 90, "dinheiro_epoca": "12 soldos", "dinheiro_brl": 60.0},
                "som": "Sino grave de bronze ecoando.",
                "musica": "silencio",
                "fato_ids": ["F03"],
                "curiosidade_bomba": False,
                "cortavel_para_short": False,
            },
        ],
        "alertas": [],
    }

    roteiro_bloco_v31["palavras_total"] = sum(p["palavras"] for p in roteiro_bloco_v31["planos"])
    parsed_rot = BlocoRoteiristaV3Output.model_validate(roteiro_bloco_v31)
    assert parsed_rot.planos[1].enquadramento == "pov_maos"

    erros_rot = validar_bloco_roteirista_v3(
        roteiro_bloco_v31,
        palavras_alvo_bloco=80,
        fatos_validos={"F01", "F02", "F03", "F04", "F05"},
    )
    assert erros_rot == []

    # 3. Testa Diretor de Cenas v1.0.0 POV Realista (cenas.diretor)
    entrada_diretor = {
        "bloco": 2,
        "episodio": esqueleto_v31["episodio"],
        "planos": roteiro_bloco_v31["planos"],
    }
    cenas_out = gerar_bloco_diretor_cenas_pov(entrada_diretor)
    parsed_cenas = DiretorCenasBlocoOutput.model_validate(cenas_out)
    assert len(parsed_cenas.cenas) == 5

    erros_cenas = validar_bloco_diretor_cenas_pov(
        cenas_out,
        planos_entrada=roteiro_bloco_v31["planos"],
    )
    assert erros_cenas == []

    # Verifica que o plano cortável para Short tem prompt_vertical 9:16 e que tela_escura tem prompt=None
    assert parsed_cenas.cenas[1].prompt_vertical is not None
    assert "9:16" in parsed_cenas.cenas[1].prompt_vertical
    assert parsed_cenas.cenas[1].prompt_movimento is not None
    assert parsed_cenas.cenas[4].prompt is None




