# SUBETAPA 06 — Conformação de Vídeo Diegética (Sem HUD RPG) e Testes E2E

## 1. Objetivo da Subetapa
Atualizar a camada de conformação de vídeo e montagem master ([`orquestrador_episodio_puro_firefly.py`](file:///D:/CANAL%209/orquestrador_episodio_puro_firefly.py), [`produzir_sobrevida_60s_firefly_pov.py`](file:///D:/CANAL%209/produzir_sobrevida_60s_firefly_pov.py) e [`produzir_sobrevida_8m_pompeia_pov.py`](file:///D:/CANAL%209/produzir_sobrevida_8m_pompeia_pov.py)) para:
1. Substituir o HUD de videogame (`VIDA 85% | COMIDA 70% | DINHEIRO`) por um **Timecode / Lower-Third Diegético de Cinema de Hollywood** discreto e sóbrio (ex.: `POMPEIA, 79 D.C.  |  20H00 · HORA +07 DA ERUPÇÃO`), mantendo o espectador 100% imerso no filme de sobrevivência.
2. Consolidar no contrato de pós-produção as 3 travas técnicas já corrigidas na raiz:
   - **Zero Pausas Longas Entre Takes** (`calcular_janelas_dinamicas_sem_pausas` + corte seco nos takes internos).
   - **Zero Efeito de Voltar no Vídeo** (`validar_filtro_video_sem_reverse` + movimento 100% progressivo com interpolação óptica a `24fps`).
   - **Zero Fallback 2D** (`sanitizar_prompt_video_firefly_consistente`).
3. Criar a suíte de testes E2E (`tests/test_hollywood_sobrevivencia_v4.py`) validando todos os novos critérios.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\orquestrador_episodio_puro_firefly.py`](file:///D:/CANAL%209/orquestrador_episodio_puro_firefly.py)
2. [`D:\CANAL 9\produzir_sobrevida_60s_firefly_pov.py`](file:///D:/CANAL%209/produzir_sobrevida_60s_firefly_pov.py)
3. [`D:\CANAL 9\produzir_sobrevida_8m_pompeia_pov.py`](file:///D:/CANAL%209/produzir_sobrevida_8m_pompeia_pov.py)
4. `D:\CANAL 9\tests\test_hollywood_sobrevivencia_v4.py`

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Substituir a Barra `VIDA % | COMIDA %` pelo Timecode Diegético de Cinema
Em [`conformar_take_14s_hud_sobrevida`](file:///D:/CANAL%209/produzir_sobrevida_8m_pompeia_pov.py#L1615-L1705) e [`conformar_take_firefly_hud_sobrevida`](file:///D:/CANAL%209/produzir_sobrevida_60s_firefly_pov.py#L465-L535):
1. Remover o texto `VIDA {vida}% | COMIDA {comida}%` que remetia a RPG/escolha A/B.
2. Substituir pelo **Selo Temporal Cinematográfico (Estilo *Dunkirk* / *Chernobyl* / *1917*)**:
   - Linha 1 (`fontsize=20`, cor pergaminho `0xEDE3CC`): `LOCALIZAÇÃO / SEQUÊNCIA` (ex.: `POMPEIA · 79 D.C.   |   FASE: CHUVA DE PEDRA-POMES`)
   - Linha 2 (`fontsize=17`, cor âmbar `0xC99738`): `RELÓGIO DIEGÉTICO` (ex.: `15H10 · FALTAM 15H50 PARA A NUVEM ARDENTE`)
3. Manter a vinheta cinematográfica (`vignette=PI/4.8`) e o agravamento visual orgânico nas fases críticas (`corpo_estado == "no_limite"`), além do **Silêncio Dramático absoluto de `1.50s`** no Ponto Sem Volta.

### Passo 3.2 — Remover Sons de "Bip de Videogame" da Mixagem de Áudio
Em [`construir_audio_master_8m24s_pompeia`](file:///D:/CANAL%209/produzir_sobrevida_8m_pompeia_pov.py#L1315-L1580):
1. Remover qualquer referência textual ou sonora a "bip de atualização de barra de escolha".
2. Manter exclusivamente o **Foley Diegético Orgânico** (passos no cascalho de pedra-pomes, crepitar de tocha/forno, impacto sísmico grave, vento de cinza, batimento cardíaco real nos momentos de risco extremo e *tick* mecânico sutil de relógio de tensão estilo *Dunkirk* nas transições de sequência).

### Passo 3.3 — Suíte de Testes Automatizados (`tests/test_hollywood_sobrevivencia_v4.py`)
Criar `D:\CANAL 9\tests\test_hollywood_sobrevivencia_v4.py` cobrindo os 6 pilares:
1. `test_bloqueio_total_perguntas_escolha_ab`: garante que `validar_ausencia_quiz_escolha_ab` e `validar_bloco_roteirista_v3` bloqueiam `"Opção A"`, `"Opção B"`, `"Você escolheria"`, `"Escolha a sua"` e `enquadramento="escolha_ab"`.
2. `test_estrutura_8_sequencias_causalidade_mas_portanto`: garante que o Arquiteto valida as 8 sequências com `instinto_fatal_multidao`, `acao_tatica_sobrevivente` e conectores causais `"mas"` / `"portanto"`.
3. `test_loops_retencao_hollywood_aninhados`: garante que toda sequência `0..5` abre um loop Zeigarnik fechado em sequência posterior e possui micro-loop interno a cada $\le 60\text{s}$.
4. `test_diretor_cenas_pov_sem_split_screen_ab`: garante que `engenheiro_prompt_imagem.py` gera apenas enquadramentos cinematográficos POV com DNA canônico e zero `escolha_ab`.
5. `test_zero_pausas_longas_e_zero_reverse`: garante que `calcular_janelas_dinamicas_sem_pausas` e `validar_filtro_video_sem_reverse` permanecem ativos em 100% dos takes.

---

## 4. Critérios de Aceite da Subetapa 06
- [ ] Vídeo conformado sem barra de videogame (`VIDA % | COMIDA %`), exibindo apenas o Timecode Diegético de Cinema, com corte seco entre takes internos e zero `reverse`.
- [ ] `pytest` executa toda a suíte (`test_correcoes_raiz_pov_firefly.py` + `test_hollywood_sobrevivencia_v4.py`) com `100% passed`.
