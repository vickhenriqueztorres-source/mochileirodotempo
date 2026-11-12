# 04 — Cinematografia, HUD e Direção 2D: SOBREVIDA (Você sobreviveria?)

> **Objetivo:** Transformar cada episódio de 10 a 14 minutos em um jogo de sobrevivência tenso e cinematográfico em animação 2D, guiado pelo avatar fixo (**Nico, o Azarado**), pelo sistema gráfico de barras na tela (**HUD de Vida, Comida, Dinheiro e Sorte**), pelas encruzilhadas de decisão A/B e pela progressão dramática das cores rumo ao perigo.

---

## 1. Gramática de Planos (Os 4 Planos Canônicos do Jogo de Sobrevivência)

Um episódio de 10 a 14 minutos (~1.500 a 2.000 palavras a 140 ppm) troca de imagem a cada **6 a 10 segundos** (entre **80 e 140 planos** por vídeo). Todo plano pertence a uma das 4 categorias abaixo:

| Código no Grafo | Nome do Plano | Quando Usar | Proporção no Episódio |
|---|---|---|---|
| `friso` / `escala` | **Situação Inicial (Wide Shot)** | Chegada ao local e ano pouco antes do perigo estourar; pessoas comuns alheias; Nico preocupado em primeiro plano | 10 a 15 planos (~15%) |
| `medio` | **Cena de Decisão A/B & Consequência (Medium Shot)** | Nico diante de uma encruzilhada simétrica (Opção A à esquerda, Opção B à direita) ou sofrendo a consequência física da escolha (exausto, ferido ou aliviado) | 40 a 65 planos (~50%) |
| `close` | **Close de Reação / Tensão** | Expressão exagerada de pânico, medo, fome ou alívio no rosto de Nico antes/depois do `"bip"` das barras | 15 a 25 planos (~20%) |
| `insert` | **Detalhe de Perigo / HUD / Objeto** | Ratos, máscaras da peste, moedas no saco de pano, pão mofado, feridas, armas, mapas de cerco ou destaque nas barras | 10 a 20 planos (~15%) |

---

## 2. Movimento Limitado e Progressão Física de Nico

1. **Degradação visual sincronizada com o HUD:**
   - **Barras cheias (`Entrada`):** Nico está saudável e apenas nervoso (`healthy and nervous`), com seu curativo na testa e cachecol vermelho intactos.
   - **Barras médias (`Decisões 1–3`):** Nico aparece sujo e faminto (`dirty and hungry`), roupas mais rasgadas, olheiras.
   - **Barras críticas (`Decisões finais / Resultado`):** Nico está exausto e ferido (`exhausted and injured`).
   - **Regra absoluta:** **Nunca mostrar Nico morto.** Se a chance chegar a 0%, a tela escurece em Carvão (`#2B2A28`).
2. **Movimento de câmera e tensão:**
   - `push_in_lento` durante o anúncio das opções A e B para aumentar a pressão psicológica.
   - `tremor` sutil de câmera no impacto da consequência e na queda da barra de Vida.
   - Composição simétrica nas **Cenas de Decisão** (`Opção A` à esquerda vs. `Opção B` à direita).

---

## 3. Iluminação e Color Script (Progressão de Perigo)

O canal utiliza exclusivamente 5 cores oficiais:

| Cor | Hex | Função Cinematográfica |
|---|---|---|
| **Carvão** | `#2B2A28` | Cor principal. Fundos escuros, sombras densas, molduras do HUD, contornos grossos de tinta (`thick ink outlines`). |
| **Pergaminho** | `#EDE3CC` | Fundo neutro para cartelas/mapas e cor de texto/iluminação de recorte sobre carvão. |
| **Sangue Seco** | `#9E2B25` | Perigo iminente, barra de vida baixa, cachecol do Nico, faixa do logo e alertas de mortalidade. |
| **Verde Vida** | `#4E8A3E` | **Exclusivo do HUD** quando as barras estão boas. É a única cor de "alívio" de todo o canal. |
| **Ouro Sujo** | `#D9A13B` | Barra de comida e de dinheiro, moedas históricas, luz de tocha ou fogo distante. |

- **Regra de Progressão Dramática:** Quanto mais perigosa a cena e menores as barras do Nico, **mais Carvão (`#2B2A28`) e Sangue Seco (`#9E2B25`)** dominam o quadro, e **menos Pergaminho (`#EDE3CC`)** aparece.

---

## 4. Sistema Gráfico Recorrente (HUD de Sobrevivência)

| Elemento Gráfico | Design Visual | Gatilho na Narração |
|---|---|---|
| **1. HUD de Barras (Vida, Comida, Dinheiro, Sorte)** | 4 ícones flat pintados à mão sobre fundo Carvão (`#2B2A28`): Coração vermelho (`#9E2B25` / `#4E8A3E`), Pão (`#D9A13B`), Moeda de ouro (`#D9A13B`) e Trevo de 4 folhas | Aparece cheio em `0:00` com som de `"bip"` e atualiza após cada decisão A/B (`Vida -20`, `Comida +10`) |
| **2. Tela de Escolha A / B** | Letras `"A"` e `"B"` gigantes em fonte **Anton** (Pergaminho `#EDE3CC` sobre Carvão `#2B2A28` / Sangue Seco `#9E2B25`) + descrição curta em **IBM Plex Sans Bold** | Nas 3 a 5 encruzilhadas de decisão (`1:30–10:00`) |
| **3. Selo de Porcentagem Final (`[X]%`)** | Escudo/selo com coração rachado, porcentagem enorme em **Anton** e barra de vida crítica em vermelho (`#9E2B25`) | No bloco de **Resultado (`10:00–11:00`)** e na **Thumbnail** |
| **4. Rodapé de Fonte / Estatística Real** | Tarja discreta em `IBM Plex Sans` sobre Carvão (`#2B2A28`) citando o registro histórico da taxa de mortalidade | Na explicação da porcentagem e no bloco final (*O que aconteceu de verdade*) |
| **5. Marca d'Água do Canal** | Escudo `SOBREVIDA` (ampulheta rachada + barra 3/5) a **40% de opacidade** no canto inferior direito | Durante todo o episódio |

---

## 5. Identidade Sonora e Voz

| Camada Sonora | Diretriz Oficial |
|---|---|
| **Gatilho de HUD (`Bip`)** | Som seco e tenso de **"bip"** de interface toda vez que as barras aparecem ou mudam de valor (`Vida -20`) |
| **Voz do Narrador** | Narrador de jogo de sobrevivência em **2ª pessoa ("você")**: grave, seca, fria, direta e levemente irônica, a **140 palavras por minuto**, com pausa dramática antes de anunciar cada consequência |
| **Parâmetros ElevenLabs** | Estabilidade: `55%` · Similaridade: `75%` · Estilo: `15%` |
| **Trilha e Foley** | Trilha de tensão contínua (cordas graves, percussão seca) + sons diegéticos do perigo (chamas, chuva, passos na lama, tosse, ferro) sem exageros melodramáticos |
| **Mixagem Master** | **-14.0 LUFS** integrado (padrão oficial do YouTube), com *ducking* sob a voz |

---

## 6. Checklist de Qualidade Cinematográfica (Por Cena)

- [ ] Nico mantém o **curativo na testa** e o **cachecol vermelho** (`#9E2B25`), além da referência `--cref` ativa?
- [ ] O desgaste físico de Nico corresponde ao nível atual das barras (saudável → sujo/faminto → exausto/ferido, nunca morto)?
- [ ] O estilo `2D hand-painted cartoon style, thick ink outlines, gritty painterly textures, dramatic tense lighting` está preservado sem cair em 3D, anime ou gore?
- [ ] O Verde Vida (`#4E8A3E`) está restrito exclusivamente ao HUD?
- [ ] Cada decisão A/B dispara atualização visual e sonora (`bip`) nas barras de Vida, Comida e Dinheiro?
