# SUBETAPA 05 — Direção de Cenas POV, DNA Visual e Fim do Split-Screen A/B

## 1. Objetivo da Subetapa
Atualizar o **Diretor de Cenas POV** ([`prompts/cenas/01-diretor-de-cenas.md`](file:///D:/CANAL%209/prompts/cenas/01-diretor-de-cenas.md) e [`grafo/direcao/engenheiro_prompt_imagem.py`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py)) para:
1. Eliminar definitivamente o enquadramento `escolha_ab` (que dividia a tela ao meio entre Opção A à esquerda e Opção B à direita).
2. Substituir os planos de "hesitação entre A e B" por **planos cinematográficos de execução prática da manobra de sobrevivência em 1ª pessoa** (`pov_maos`, `pov_olho`, `detalhe` de improviso técnico).
3. Desvincular o estado físico das mãos (`corpo_estado`: `inteiro` $\to$ `desgastado` $\to$ `no_limite`) das barras de videogame do HUD, atrelando-o diretamente à progressão das 8 Sequências do episódio.

---

## 2. Arquivos Afetados
1. [`D:\CANAL 9\prompts\cenas\01-diretor-de-cenas.md`](file:///D:/CANAL%209/prompts/cenas/01-diretor-de-cenas.md)
2. [`D:\CANAL 9\grafo\direcao\engenheiro_prompt_imagem.py`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py)

---

## 3. Passo a Passo de Implementação

### Passo 3.1 — Remover `escolha_ab` de `montar_cena_diretor_pov` em `grafo/direcao/engenheiro_prompt_imagem.py`
Em [`grafo/direcao/engenheiro_prompt_imagem.py`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py) (linhas `147–220`):
1. Remover o ramo `elif enq == "escolha_ab":` que gerava `"First-person POV standing at a symmetrical fork in ..., on the left side ..., on the right side ..."`.
2. Se qualquer plano legado passar `enquadramento="escolha_ab"`, convertê-lo ou bloqueá-lo via contrato, utilizando os **7 Enquadramentos Cinematográficos POV v4.0**:
   - `aberto`: *Wide establishing cinematic 35mm film still of `{loc_desc}`* (abertura de sequência e escala da catástrofe).
   - `pov_olho`: *Photorealistic first-person POV at eye level on 24mm lens looking straight ahead at `{pov_acao}` in `{loc_desc}`* (deslocamento, ameaça frontal e contraste com a multidão).
   - `pov_maos`: *Photorealistic first-person POV looking down at your own hands in the lower frame (`{dna_maos}`, `{estado_fisico}`): `{pov_acao}` in `{loc_desc}`* (**execução tática de sobrevivência** — manuseando ferramentas, vedando frestas, improvisando proteção).
   - `pov_baixo`: *Photorealistic first-person POV looking down at the ground/terrain at your feet: `{pov_acao}` in `{loc_desc}`* (terreno letal, enchente, cinza acumulando, gás rasteiro).
   - `pov_companheiro`: *Photorealistic first-person POV at eye level, `{companion_token}` directly in front of the camera lens looking into your eyes: `{pov_acao}` in `{loc_desc}`*.
   - `detalhe`: *Extreme close-up cinematic 35mm film insert shot of `{objeto_token or pov_acao}` in `{loc_desc}`* (plantio/pagamento da Arma de Chekhov e detalhes mecânicos do perigo).
   - `reflexo`: *Photorealistic first-person POV looking into a period reflective surface (water basin, bronze mirror, wet stone) showing the reflection of `{protagonista_reflexo_dna}`* (exatamente 1 vez no episódio, no clímax emocional).

### Passo 3.2 — Progressão Automática do Desgaste Físico por Sequência (`_inferir_corpo_estado_por_sequencia`)
Em [`grafo/direcao/engenheiro_prompt_imagem.py`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py):
- Sequências `0` e `1`: `corpo_estado = "inteiro"` (mãos com marcas de ofício, sem ferimentos agudos).
- Sequências `2`, `3` e `4`: `corpo_estado = "desgastado"` (suor, fuligem/lama da catástrofe, pequenos arranhões nos nós dos dedos, tecido chamuscado/molhado).
- Sequências `5`, `6` e `7`: `corpo_estado = "no_limite"` (mãos exaustas, crosta densa de cinza/terra, tira de linho amarrada no antebraço/palma, iluminação dramática de sobrevivência extrema).

### Passo 3.3 — Blindagem de DNA Canônico em Todos os Planos (`injetar_dna_consistencia_pov`)
Manter e reforçar em [`injetar_dna_consistencia_pov`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py#L481-L526) e [`validar_consistencia_dna_personagens_e_ambientes`](file:///D:/CANAL%209/grafo/direcao/engenheiro_prompt_imagem.py#L529-L545):
1. Todo plano `pov_maos` / `pov_acao` injeta obrigatoriamente `episodio_meta["dna_maos"]` (proibindo mangas modernas ou troca de anatomia).
2. Todo plano com o companheiro injeta `episodio_meta["dna_companheiro"]` (mesma idade, rosto, cabelo e vestimenta histórica do início ao fim).
3. Todo plano injeta `episodio_meta["dna_locacoes"][locacao_id]` (garantindo fidelidade arquitetônica e de iluminação/horário da época).
4. Adicionar no prompt negativo (`SOBREVIDA_POV_NEGATIVE`): `"split screen, vertical dividing line, option A option B comparison, video game HUD, modern clothing, knitted sweater, asphalt, cars"`.

---

## 4. Critérios de Aceite da Subetapa 05
- [ ] Nenhum prompt de imagem ou vídeo gerado contém composições divididas (`split-screen` / `symmetrical fork option A left option B right`).
- [ ] Pelo menos 40% dos planos das sequências de ação (`Seq 2..6`) são `pov_maos` ou `pov_olho` demonstrando visualmente **como o protagonista executa a técnica de sobrevivência**.
- [ ] `validar_consistencia_dna_personagens_e_ambientes` retorna `0 erros`.
