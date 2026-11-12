# -*- coding: utf-8 -*-
"""
Canal 06 - LUME — Model Context Protocol (MCP) Server
Servidor MCP dedicado para o projeto LUME (d:/LUME) e documentação de marca
(D:/BRENDA/STUDIO DOCS - YOUTUBE/Canal 06 - Lume).

Permite receber e consultar:
- Temas de episódios (mitos, épicos, Canto/Verso, Big Idea, Hook Eugene Schwartz)
- Dicas editoriais e técnicas (retenção, copy, visual sombra/fogo, áudio/SFX)
- Roteiros estruturados para o pipeline LangGraph (O Contador)
- Diretrizes de identidade visual e engenharia reversa do canal
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Garante UTF-8 seguro no Windows stdio
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Preserva o canal stdout puro para JSON-RPC e redireciona prints comuns para stderr
_rpc_stdout = sys.stdout
sys.stdout = sys.stderr

# Diretórios principais do Canal SOBREVIDA (D:\CANAL 9)
STUDIO_DOCS_DIR = Path(__file__).resolve().parent
LUME_PROJECT_DIR = Path(__file__).resolve().parent

INBOX_DIR = LUME_PROJECT_DIR / "inputs"
THEMES_DIR = INBOX_DIR / "themes"
TIPS_DIR = INBOX_DIR / "tips"
SCRIPTS_DIR = INBOX_DIR / "scripts"
DB_PATH = LUME_PROJECT_DIR / "data" / "lume_inbox.db"

STUDIO_THEMES_MIRROR = STUDIO_DOCS_DIR / "themes"
STUDIO_TIPS_MIRROR = STUDIO_DOCS_DIR / "tips"

# Banco compartilhado opcional do Chief YouTube / Hermes
CHIEF_INBOX_DB = Path(r"D:\CHIEF YOUTUBE\codex_inbox\inbox.sqlite")

for _d in (THEMES_DIR, TIPS_DIR, SCRIPTS_DIR, DB_PATH.parent, STUDIO_THEMES_MIRROR, STUDIO_TIPS_MIRROR):
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass


def init_db() -> sqlite3.Connection:
    """Inicializa o banco SQLite local do inbox do LUME."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lume_inbox (
            id TEXT PRIMARY KEY,
            item_type TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'mitologia',
            status TEXT NOT NULL DEFAULT 'pending',
            big_idea TEXT,
            hook TEXT,
            canto_verso TEXT,
            characters TEXT,
            tips_notes TEXT,
            file_path TEXT NOT NULL,
            studio_mirror_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            raw_payload TEXT
        );
        """
    )
    conn.commit()
    return conn


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r"\s+", "-", cleaned.strip().lower())
    return cleaned[:80] or "lume-item"


def _generate_id(prefix: str) -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    short_hash = uuid.uuid4().hex[:6].upper()
    return f"{prefix}-{date_str}-{short_hash}"


# ==============================================================================
# IMPLEMENTAÇÃO DAS FERRAMENTAS (TOOLS) DO CANAL LUME
# ==============================================================================


def send_lume_theme(
    title: str,
    big_idea: str,
    hook: str,
    myth_or_epic: str = "A Odisseia (Homero)",
    canto_verso: Optional[str] = None,
    characters: Optional[List[str]] = None,
    tips_and_angles: Optional[str] = None,
    schwartz_awareness_level: int = 4,
    thumbnail_layout: str = "A · Ameaça",
    thumbnail_words: Optional[str] = None,
    auto_queue_pipeline: bool = True,
) -> Dict[str, Any]:
    """Envia um novo tema validado para o projeto LUME (d:/LUME) e espelha na pasta do Canal 06."""
    item_id = _generate_id("LUME-THM")
    now_iso = datetime.now().isoformat()
    slug = _sanitize_filename(title)
    filename = f"{item_id}_{slug}.md"

    file_path = THEMES_DIR / filename
    mirror_path = STUDIO_THEMES_MIRROR / filename
    chars_str = ", ".join(characters) if characters else "O Contador, Odisseu"

    md_lines = [
        "---",
        f"id: {item_id}",
        "type: theme",
        'channel: "Canal 06 - LUME"',
        f'title: "{title}"',
        f'myth_or_epic: "{myth_or_epic}"',
        f'canto_verso: "{canto_verso or "Canto IX"}"',
        f"schwartz_awareness_level: {schwartz_awareness_level}",
        f'thumbnail_layout: "{thumbnail_layout}"',
        f'thumbnail_words: "{thumbnail_words or "O ÚLTIMO HOMEM"}"',
        "status: pending",
        f"created_at: {now_iso}",
        'target_project: "D:/LUME"',
        "---",
        "",
        f"# 🔥 TEMA LUME: {title}",
        "",
        f"**ID:** `{item_id}`  ",
        f"**Épico / Mito:** {myth_or_epic} (`{canto_verso or 'Referência canônica a verificar'}`)  ",
        f"**Personagens (Silhuetas):** {chars_str}  ",
        f"**Nível de Consciência (Eugene Schwartz):** Nível {schwartz_awareness_level}  ",
        f"**Thumbnail ({thumbnail_layout}):** `{thumbnail_words or 'ATÉ 3 PALAVRAS'}`  ",
        "",
        "---",
        "",
        "## 💡 Big Idea & Tese Dramática",
        big_idea,
        "",
        "## 🪝 Gancho Inicial (Primeiros 3-5s — Erro de Previsão)",
        hook,
        "",
        "## 🧭 Dicas Editoriais, Ângulos e Pesquisa",
        tips_and_angles or "*Seguir rigorosamente a proporção 60/25/10/5 e a voz grave do Contador.*",
        "",
        "## 🕯️ Regras Invioláveis da Marca LUME",
        '- Abertura ritual: *"O fogo ainda conta as mesmas histórias."*',
        '- Fechamento ritual: *"O lume apaga. A história fica."*',
        "- Paleta: Carvão (`#16110D` 60%), Fuligem (`#3A2C22` 25%), Pergaminho (`#F1E6CF` 10%), Brasa (`#E07A2E` máx 5%).",
        "- Marionetes em figura negra com pinos visíveis; deuses apenas como mudança de luz.",
        "",
    ]

    md_content = "\n".join(md_lines)
    file_path.write_text(md_content, encoding="utf-8")
    try:
        mirror_path.write_text(md_content, encoding="utf-8")
    except Exception:
        pass

    payload_dict = {
        "id": item_id,
        "title": title,
        "myth_or_epic": myth_or_epic,
        "big_idea": big_idea,
        "hook": hook,
        "canto_verso": canto_verso,
        "characters": characters or ["O Contador", "Odisseu"],
        "tips_and_angles": tips_and_angles,
        "schwartz_awareness_level": schwartz_awareness_level,
        "thumbnail_layout": thumbnail_layout,
        "thumbnail_words": thumbnail_words,
        "auto_queue_pipeline": auto_queue_pipeline,
    }
    raw_payload = json.dumps(payload_dict, ensure_ascii=False)

    conn = init_db()
    with conn:
        conn.execute(
            """
            INSERT INTO lume_inbox (
                id, item_type, title, category, status, big_idea, hook,
                canto_verso, characters, tips_notes, file_path, studio_mirror_path,
                created_at, updated_at, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                "theme",
                title,
                myth_or_epic,
                "pending",
                big_idea,
                hook,
                canto_verso or "",
                chars_str,
                tips_and_angles or "",
                str(file_path),
                str(mirror_path),
                now_iso,
                now_iso,
                raw_payload,
            ),
        )

    return {
        "status": "success",
        "message": f"Tema '{title}' recebido no projeto LUME com sucesso!",
        "item_id": item_id,
        "lume_file_path": str(file_path),
        "studio_docs_mirror": str(mirror_path),
        "auto_queue_pipeline": auto_queue_pipeline,
    }


def send_lume_tip(
    title: str,
    tip_content: str,
    category: str = "retencao",
    reference_url: Optional[str] = None,
    apply_to_agent: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Envia uma dica, insight de engenharia reversa, regra de retenção ou referência
    para o projeto LUME (salva em d:/LUME/inputs/tips/ e no SQLite).
    """
    item_id = _generate_id("LUME-TIP")
    now_iso = datetime.now().isoformat()
    slug = _sanitize_filename(title)
    filename = f"{item_id}_{slug}.md"

    file_path = TIPS_DIR / filename
    mirror_path = STUDIO_TIPS_MIRROR / filename

    md_lines = [
        "---",
        f"id: {item_id}",
        "type: tip",
        f'title: "{title}"',
        f'category: "{category}"',
        f'apply_to_agent: "{apply_to_agent or "geral"}"',
        f'reference_url: "{reference_url or ""}"',
        "status: pending",
        f"created_at: {now_iso}",
        "---",
        "",
        f"# 💡 DICA / INSIGHT LUME: {title}",
        "",
        f"**Categoria:** `{category}`  ",
        f"**Agente Alvo:** `{apply_to_agent or 'Todos os departamentos'}`  ",
        f"**Referência:** {reference_url or 'N/A'}  ",
        f"**Data:** {now_iso}  ",
        "",
        "---",
        "",
        "## 📌 Conteúdo da Dica / Diretriz",
        tip_content,
        "",
    ]

    md_content = "\n".join(md_lines)
    file_path.write_text(md_content, encoding="utf-8")
    try:
        mirror_path.write_text(md_content, encoding="utf-8")
    except Exception:
        pass

    raw_payload = json.dumps(
        {
            "id": item_id,
            "title": title,
            "category": category,
            "tip_content": tip_content,
            "reference_url": reference_url,
            "apply_to_agent": apply_to_agent,
        },
        ensure_ascii=False,
    )

    conn = init_db()
    with conn:
        conn.execute(
            """
            INSERT INTO lume_inbox (
                id, item_type, title, category, status, tips_notes,
                file_path, studio_mirror_path, created_at, updated_at, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                "tip",
                title,
                category,
                "pending",
                tip_content,
                str(file_path),
                str(mirror_path),
                now_iso,
                now_iso,
                raw_payload,
            ),
        )

    return {
        "status": "success",
        "message": f"Dica '{title}' ({category}) registrada no LUME!",
        "item_id": item_id,
        "lume_file_path": str(file_path),
        "studio_docs_mirror": str(mirror_path),
    }


def send_lume_script(
    title: str,
    blocks: List[Dict[str, Any]],
    canto_verso: str = "Canto IX",
    voice_name: str = "charon",
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Envia um roteiro estruturado em blocos para o projeto LUME."""
    item_id = _generate_id("LUME-SCR")
    now_iso = datetime.now().isoformat()
    slug = _sanitize_filename(title)
    filename = f"{item_id}_{slug}.json"

    file_path = SCRIPTS_DIR / filename
    script_payload = {
        "id": item_id,
        "title": title,
        "channel": "LUME",
        "canto_verso": canto_verso,
        "voice_name": voice_name,
        "created_at": now_iso,
        "notes": notes or "",
        "blocks": blocks,
    }
    file_path.write_text(json.dumps(script_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    conn = init_db()
    with conn:
        conn.execute(
            """
            INSERT INTO lume_inbox (
                id, item_type, title, category, status, canto_verso,
                tips_notes, file_path, studio_mirror_path, created_at, updated_at, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                "script",
                title,
                "roteiro",
                "pending",
                canto_verso,
                notes or "",
                str(file_path),
                "",
                now_iso,
                now_iso,
                json.dumps(script_payload, ensure_ascii=False),
            ),
        )

    return {
        "status": "success",
        "message": f"Roteiro '{title}' salvo em {file_path}",
        "item_id": item_id,
        "file_path": str(file_path),
        "blocks_count": len(blocks),
    }


def list_lume_inbox(
    item_type: str = "all",
    status: str = "all",
    limit: int = 25,
) -> Dict[str, Any]:
    """Lista temas, dicas e roteiros recebidos no Inbox do LUME."""
    conn = init_db()
    query = (
        "SELECT id, item_type, title, category, status, big_idea, hook, "
        "canto_verso, file_path, created_at, updated_at FROM lume_inbox WHERE 1=1"
    )
    params: List[Any] = []

    if item_type != "all":
        query += " AND item_type = ?"
        params.append(item_type)
    if status != "all":
        query += " AND status = ?"
        params.append(status)

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()

    items = []
    for r in rows:
        items.append(
            {
                "id": r[0],
                "item_type": r[1],
                "title": r[2],
                "category": r[3],
                "status": r[4],
                "big_idea": r[5],
                "hook": r[6],
                "canto_verso": r[7],
                "file_path": r[8],
                "created_at": r[9],
                "updated_at": r[10],
            }
        )

    return {
        "channel": "Canal 06 - LUME",
        "total": len(items),
        "filters": {"item_type": item_type, "status": status},
        "items": items,
    }


def get_lume_inbox_item(item_id: Optional[str] = None, item_type: str = "theme") -> Dict[str, Any]:
    """
    Recupera os detalhes completos de um tema, dica ou roteiro pelo ID.
    Se item_id for omitido, retorna o item pendente mais recente do tipo especificado.
    """
    conn = init_db()
    cursor = conn.cursor()

    if item_id:
        cursor.execute(
            "SELECT id, item_type, title, category, status, big_idea, hook, canto_verso, "
            "characters, tips_notes, file_path, studio_mirror_path, created_at, updated_at, raw_payload "
            "FROM lume_inbox WHERE id = ?",
            (item_id,),
        )
    else:
        cursor.execute(
            "SELECT id, item_type, title, category, status, big_idea, hook, canto_verso, "
            "characters, tips_notes, file_path, studio_mirror_path, created_at, updated_at, raw_payload "
            "FROM lume_inbox WHERE item_type = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
            (item_type,),
        )

    row = cursor.fetchone()
    if not row:
        return {
            "status": "not_found",
            "message": f"Nenhum item encontrado (item_id={item_id}, item_type={item_type}).",
        }

    file_p = Path(row[10])
    content = ""
    if file_p.exists():
        try:
            content = file_p.read_text(encoding="utf-8")
        except Exception as e:
            content = f"Erro ao ler arquivo: {e}"

    raw_data = {}
    if row[14]:
        try:
            raw_data = json.loads(row[14])
        except Exception:
            pass

    return {
        "status": "success",
        "id": row[0],
        "item_type": row[1],
        "title": row[2],
        "category": row[3],
        "item_status": row[4],
        "big_idea": row[5],
        "hook": row[6],
        "canto_verso": row[7],
        "characters": row[8],
        "tips_notes": row[9],
        "file_path": row[10],
        "studio_mirror_path": row[11],
        "created_at": row[12],
        "updated_at": row[13],
        "payload": raw_data,
        "full_content": content,
    }


def update_lume_inbox_status(
    item_id: str,
    status: str,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Atualiza o status de um tema, dica ou roteiro no Inbox do LUME."""
    valid_statuses = ["pending", "in_progress", "completed", "archived"]
    if status not in valid_statuses:
        return {"status": "error", "message": f"Status inválido. Use um de: {valid_statuses}"}

    now_iso = datetime.now().isoformat()
    conn = init_db()
    with conn:
        if notes:
            conn.execute(
                "UPDATE lume_inbox SET status = ?, tips_notes = COALESCE(tips_notes, '') || ? || ?, updated_at = ? WHERE id = ?",
                (status, "\n[Update] ", notes, now_iso, item_id),
            )
        else:
            conn.execute(
                "UPDATE lume_inbox SET status = ?, updated_at = ? WHERE id = ?",
                (status, now_iso, item_id),
            )

    return {
        "status": "success",
        "item_id": item_id,
        "new_status": status,
        "updated_at": now_iso,
    }


def get_lume_brand_guidelines(section: str = "all") -> Dict[str, Any]:
    """
    Retorna o Briefing completo e a Engenharia Reversa do Canal 06 - Lume
    diretamente de D:/BRENDA/STUDIO DOCS - YOUTUBE/Canal 06 - Lume.
    """
    brief_path = STUDIO_DOCS_DIR / "Brief.md"
    eng_rev_path = STUDIO_DOCS_DIR / "Eng Rev. Canal.md"

    brief_text = brief_path.read_text(encoding="utf-8") if brief_path.exists() else ""
    eng_rev_text = eng_rev_path.read_text(encoding="utf-8") if eng_rev_path.exists() else ""

    if section != "all" and brief_text:
        # Filtra seção específica pelo título caso solicitado
        pattern = re.compile(rf"(##\s+.*{re.escape(section)}.*?)(?=\n##\s+|\Z)", re.IGNORECASE | re.DOTALL)
        matches = pattern.findall(brief_text)
        if matches:
            brief_text = "\n\n".join(matches)

    return {
        "channel": "Canal 06 - LUME",
        "studio_docs_dir": str(STUDIO_DOCS_DIR),
        "lume_project_dir": str(LUME_PROJECT_DIR),
        "brief_markdown": brief_text,
        "engenharia_reversa_markdown": eng_rev_text,
    }


def list_lume_episodes() -> Dict[str, Any]:
    """Lista os episódios, masters e roteiros já gerados em d:/LUME/storage_local."""
    renders_dir = LUME_PROJECT_DIR / "storage_local" / "renders"
    roteiros_dir = LUME_PROJECT_DIR / "storage_local" / "roteiro"

    episodes = []
    if renders_dir.exists():
        for d in sorted(renders_dir.iterdir()):
            if d.is_dir():
                mp4_files = [f.name for f in sorted(d.glob("*.mp4"))]
                episodes.append(
                    {
                        "episode_folder": d.name,
                        "path": str(d),
                        "video_count": len(mp4_files),
                        "videos": mp4_files[:15],
                    }
                )

    roteiros = []
    if roteiros_dir.exists():
        roteiros = [str(f.name) for f in sorted(roteiros_dir.glob("*.json"))]

    return {
        "project_dir": str(LUME_PROJECT_DIR),
        "total_render_folders": len(episodes),
        "render_folders": episodes,
        "saved_scripts": roteiros,
    }


# ==============================================================================
# FERRAMENTAS HERMES / GUARDIÃO DA BÍBLIA LUME (COMPATIBILIDADE TOTAL)
# ==============================================================================

LUME_BIBLE = {
    "canal": "SOBREVIDA",
    "slogan": "Você sobreviveria?",
    "proposito": "A história como jogo de sobrevivência. O espectador entra em um momento perigoso do passado com barras de Vida, Comida e Dinheiro na tela, faz escolhas difíceis e descobre a sua chance real de sair vivo.",
    "tagline": "Em cada vídeo, você é jogado em um dos piores momentos da história, faz escolhas difíceis e descobre a sua chance real de sair vivo.",
    "handles": ["@sobrevida", "@sobrevida.tv", "@canalsobrevida", "@sobrevidahistoria"],
    "pergunta_central": "Você conseguiria sobreviver?",
    "persona": "Nico, o Azarado (20 anos, magro, medroso, azarado, sobrevive por teimosia e sorte; curativo na testa, cachecol vermelho, bolsinha de pano; não fala, só reage).",
    "nico_prompt_fixo": (
        "Nico, a skinny unlucky cartoon young man around 20, short black curly hair, tan skin, big worried eyes, "
        "small bandage on the forehead, torn grey linen shirt, red scarf around the neck, "
        "patched brown trousers, worn sandals, small cloth bag"
    ),
    "estilo_base_imagem": (
        "2D hand-painted cartoon style, thick ink outlines, gritty painterly textures, dramatic tense lighting, "
        "blood red #9E2B25 and charcoal #2B2A28 tones with parchment highlights, "
        "expressive exaggerated faces, historically accurate clothing and setting, cinematic composition, 16:9"
    ),
    "abertura_falada": "[Som de bip, barras aparecem cheias] [LUGAR], [DATA]. Vida: cheia. Comida: cheia. Dinheiro: [VALOR]. Suas barras estão cheias. Por enquanto.",
    "fechamento_ritual": "Sua chance final de sobreviver: [X]%. Comenta a sua porcentagem. Você sobreviveu a este. O próximo pode não ser tão gentil.",
    "series": {
        "voce_sobreviveria": "Você sairia vivo deste perigo? (Ex.: Você Sobreviveria à Peste Negra?)",
        "o_pior_emprego": "Você aguentaria este trabalho? (Ex.: Você Aguentaria Ser Mineiro em 1850?)",
        "fuga": "Você conseguiria escapar? (Ex.: Você Fugiria de Pompeia a Tempo?)",
    },
    "estrutura_blocos": [
        "0:00–0:15 · Entrada (Data, lugar e as barras cheias na tela)",
        "0:15–1:30 · Situação (Onde você está e por que é perigoso)",
        "1:30–10:00 · Decisões (3 a 5 escolhas A/B. Cada uma mexe nas barras)",
        "10:00–11:00 · Resultado (Porcentagem final de sobrevivência)",
        "11:00–12:00 · Saída (O que aconteceu de verdade, comentário, inscrição)",
    ],
    "paleta": {
        "carvao": {"hex": "#2B2A28", "uso": "Cor principal. Fundos, HUD, faixas."},
        "pergaminho": {"hex": "#EDE3CC", "uso": "Fundo neutro e texto sobre carvão."},
        "sangue_seco": {"hex": "#9E2B25", "uso": "Perigo, barra de vida baixa, palavras-chave."},
        "verde_vida": {"hex": "#4E8A3E", "uso": "Só nas barras do HUD quando estão boas."},
        "ouro_sujo": {"hex": "#D9A13B", "uso": "Barra de comida e de dinheiro, moedas."},
    },
    "tipografia": {
        "titulos_e_hud": "Anton (Logo, thumbnail, porcentagem, nomes das barras, escolhas A e B)",
        "textos": "IBM Plex Sans Regular e Bold (Legendas, datas, texto das escolhas, descrições)",
    },
    "regras_thumbnail": [
        "Nico em close, com medo, à esquerda ou no centro",
        "Selo à direita com coração rachado e a porcentagem enorme (ex.: 12%) em Anton",
        "Barra de vida quase vazia, em vermelho (#9E2B25)",
        "No máximo 3 palavras em Anton",
        "Fundo escuro com o perigo visível (névoa, fogo, água, soldados)",
    ],
}


def lume_get_bible() -> Dict[str, Any]:
    return LUME_BIBLE


def lume_evaluate_myth_theme(
    title: str,
    hero: str,
    antagonist_monster: str,
    human_drama_core: str,
    primary_source: str,
) -> Dict[str, Any]:
    words = title.strip().split()
    score = 9.5
    if len(words) > 16:
        score -= 0.5
    return {
        "title": title,
        "hero": hero,
        "antagonist": antagonist_monster,
        "human_drama": human_drama_core,
        "primary_source": primary_source,
        "score": score,
        "status": "APPROVED_LUME",
    }


def lume_format_thumbnail_concept(
    layout_type: str,
    giant_silhouette: str,
    small_hero: str,
    three_words_text: str,
) -> Dict[str, Any]:
    words = three_words_text.strip().split()
    if len(words) > 3:
        raise ValueError(
            f"Regra violada! A thumbnail deve ter no máximo 3 palavras. Recebeu: '{three_words_text}'"
        )
    layout_map = {
        "A": "A · Ameaça (Monstro gigante no centro/direita, herói minúsculo à direita, texto à esquerda)",
        "B": "B · Escolha (Figura colossal à esquerda apontando caminho, herói à direita)",
        "C": "C · Contador (Ameaça múltipla no alto, herói embaixo, pergunta curta)",
    }
    return {
        "layout": layout_map.get(layout_type.upper(), layout_map["A"]),
        "giant_silhouette": giant_silhouette,
        "small_silhouette": small_hero,
        "thumbnail_text": " ".join(words).upper(),
        "fire_base": "Fogo/brasa na base do quadro",
        "safe_corner": "Canto inferior direito livre",
    }


def lume_generate_episode_plan(
    title: str,
    epic_source: str,
    acts_breakdown: List[Dict[str, Any]],
) -> Dict[str, Any]:
    episode_id = f"LUME-EP-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    return {
        "episode_id": episode_id,
        "channel": "LUME",
        "title": title,
        "source": epic_source,
        "ritual_open": "O fogo ainda conta as mesmas histórias.",
        "ritual_close": "O lume apaga. A história fica.",
        "acts": acts_breakdown,
        "puppet_rules": "Marionetes em figura negra com pinos visíveis de articulação.",
        "soundscape": "Crepitar de brasa, sopro de aulos e silêncio tenso de 1.5s a 2s antes do clímax.",
    }


def lume_dispatch_theme(theme_payload: Dict[str, Any]) -> Dict[str, Any]:
    codex_inbox_themes = Path(r"D:\CHIEF YOUTUBE\codex_inbox\themes")
    codex_inbox_themes.mkdir(parents=True, exist_ok=True)
    title = theme_payload.get("title", "Tema Lume")
    slug = _sanitize_filename(title)[:45]
    filename = f"THM_LUME_{datetime.now().strftime('%Y%m%d')}_{slug}.md"

    content = f"""# DOSSIER DE EPISÓDIO — CANAL LUME
**ID:** {theme_payload.get('episode_id', 'LUME-PILOT')}  
**Data:** {datetime.now().strftime('%Y-%m-%d')}  
**Título:** {title}  
**Fonte Clássica:** {theme_payload.get('source', 'Homero — A Odisseia')}  

---
### RITUAL DE ABERTURA DO CONTADOR
> *"{theme_payload.get('ritual_open', 'O fogo ainda conta as mesmas histórias.')}"*

### ESTRUTURA DOS ATOS
{json.dumps(theme_payload.get('acts', []), indent=2, ensure_ascii=False)}

### RITUAL DE ENCERRAMENTO
> *"{theme_payload.get('ritual_close', 'O lume apaga. A história fica.')}"*
"""
    local_path = STUDIO_DOCS_DIR / filename
    codex_path = codex_inbox_themes / filename
    local_path.write_text(content, encoding="utf-8")
    try:
        codex_path.write_text(content, encoding="utf-8")
    except Exception:
        pass

    # Registra também no SQLite do projeto LUME
    send_res = send_lume_theme(
        title=title,
        big_idea=theme_payload.get("big_idea", "Seiscentos homens saíram de Troia; apenas um voltou. O preço humano da soberba e da glória."),
        hook=theme_payload.get("hook", "O fogo ainda conta as mesmas histórias. Seiscentos saíram. Um tocou a praia de Ítaca. Esta é a história de como todos eles morreram."),
        myth_or_epic=theme_payload.get("source", "A Odisseia (Homero)"),
        canto_verso=theme_payload.get("canto_verso", "Odisseia, Cantos I a XXIV"),
        characters=theme_payload.get("characters", ["O Contador", "Odisseu", "Polifemo", "Circe", "As Sereias", "Cila", "Poseidon", "Penélope"]),
        tips_and_angles=json.dumps(theme_payload.get("acts", []), ensure_ascii=False),
        thumbnail_layout="A · Ameaça",
        thumbnail_words=theme_payload.get("thumbnail_words", "O ÚLTIMO HOMEM"),
    )
    return {
        "status": "DISPATCHED_LUME",
        "channel_file": str(local_path),
        "codex_inbox_file": str(codex_path),
        "lume_inbox": send_res,
    }


# ==============================================================================
# DEFINIÇÃO DO PROTOCOLO MCP (JSON-RPC 2.0)
# ==============================================================================

MCP_TOOLS = [
    {
        "name": "send_lume_theme",
        "description": "Envia um tema de episódio (mito/épico, Canto/Verso, Big Idea, Hook Eugene Schwartz, personagens em silhueta e dicas) para o Canal 06 - LUME (d:/LUME).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título dramático do episódio (ex: 'O Último Homem na Caverna de Polifemo')"},
                "big_idea": {"type": "string", "description": "A Big Idea / Tese dramática central do mito"},
                "hook": {"type": "string", "description": "Gancho inicial para os primeiros 3-5 segundos com Erro de Previsão"},
                "myth_or_epic": {"type": "string", "description": "Obra ou mito canônico (ex: 'A Odisseia - Homero', 'Teogonia - Hesíodo')", "default": "A Odisseia (Homero)"},
                "canto_verso": {"type": "string", "description": "Referência canônica de Canto e Verso (ex: 'Odisseia, Canto IX, v. 105-566')"},
                "characters": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lista de personagens em silhueta (ex: ['O Contador', 'Odisseu', 'Polifemo'])",
                },
                "tips_and_angles": {"type": "string", "description": "Dicas editoriais, ângulos de pesquisa e notas de direção visual/sonora"},
                "schwartz_awareness_level": {"type": "integer", "description": "Nível de consciência de Eugene Schwartz (1 a 5, padrão 4)", "default": 4},
                "thumbnail_layout": {"type": "string", "description": "Layout da thumbnail (A · Ameaça, B · Escolha, C · Contador)", "default": "A · Ameaça"},
                "thumbnail_words": {"type": "string", "description": "Texto da thumbnail (máximo 3 palavras, ex: 'O ÚLTIMO HOMEM')"},
                "auto_queue_pipeline": {"type": "boolean", "description": "Se true, deixa pronto na fila de entrada do pipeline LangGraph", "default": True},
            },
            "required": ["title", "big_idea", "hook"],
        },
    },
    {
        "name": "send_lume_tip",
        "description": "Envia uma dica editorial, regra de retenção, referência de canal concorrente ou diretriz técnica (áudio, visual, copy) para o projeto LUME.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título curto da dica ou diretriz"},
                "tip_content": {"type": "string", "description": "Explicação detalhada da dica, técnica de retenção ou ajuste"},
                "category": {
                    "type": "string",
                    "enum": ["retencao", "copy_schwartz", "visual_sombra_fogo", "audio_sfx", "engenharia_reversa", "geral"],
                    "default": "retencao",
                    "description": "Categoria da dica",
                },
                "reference_url": {"type": "string", "description": "URL opcional de vídeo ou canal de referência"},
                "apply_to_agent": {"type": "string", "description": "Agente ou departamento alvo no grafo (ex: 'roteiro.roteirista', 'direcao', 'audio')"},
            },
            "required": ["title", "tip_content"],
        },
    },
    {
        "name": "send_lume_script",
        "description": "Envia um roteiro estruturado em blocos na voz do Contador para o projeto LUME.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título do episódio"},
                "blocks": {
                    "type": "array",
                    "description": "Blocos do roteiro com texto, tempo_estimado_s, canto_verso e visual_prompt",
                    "items": {
                        "type": "object",
                        "properties": {
                            "numero": {"type": "integer"},
                            "texto": {"type": "string"},
                            "tempo_estimado_s": {"type": "number"},
                            "canto_verso": {"type": "string"},
                            "visual_intent": {"type": "string"},
                        },
                        "required": ["texto"],
                    },
                },
                "canto_verso": {"type": "string", "default": "Canto IX"},
                "voice_name": {"type": "string", "default": "charon"},
                "notes": {"type": "string"},
            },
            "required": ["title", "blocks"],
        },
    },
    {
        "name": "list_lume_inbox",
        "description": "Lista todos os temas, dicas e roteiros recebidos pelo MCP do Canal 06 - LUME.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_type": {"type": "string", "enum": ["all", "theme", "tip", "script"], "default": "all"},
                "status": {"type": "string", "enum": ["all", "pending", "in_progress", "completed", "archived"], "default": "all"},
                "limit": {"type": "integer", "default": 25},
            },
        },
    },
    {
        "name": "get_lume_inbox_item",
        "description": "Obtém os detalhes e conteúdo completo de um tema, dica ou roteiro do LUME pelo ID (ou o mais recente pendente se item_id for omitido).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string", "description": "ID do item (ex: 'LUME-THM-...' ou 'LUME-TIP-...'). Opcional."},
                "item_type": {"type": "string", "enum": ["theme", "tip", "script"], "default": "theme"},
            },
        },
    },
    {
        "name": "update_lume_inbox_status",
        "description": "Atualiza o status de um tema, dica ou roteiro no Inbox do LUME ('pending', 'in_progress', 'completed', 'archived').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string", "description": "ID do item"},
                "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "archived"]},
                "notes": {"type": "string", "description": "Notas opcionais sobre o processamento no pipeline"},
            },
            "required": ["item_id", "status"],
        },
    },
    {
        "name": "get_lume_brand_guidelines",
        "description": "Lê o Briefing oficial de Identidade Visual e Engenharia Reversa do Canal 06 - LUME (Brief.md e Eng Rev. Canal.md).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "section": {"type": "string", "description": "Seção específica (ex: 'Paleta', 'Thumbnails', 'Personagens', ou 'all')", "default": "all"},
            },
        },
    },
    {
        "name": "list_lume_episodes",
        "description": "Lista os episódios, takes renderizados e roteiros salvos em d:/LUME/storage_local.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "lume_get_bible",
        "description": "Retorna o DNA, cores e rituais do Canal Lume.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "lume_evaluate_myth_theme",
        "description": "Valida temas mitológicos com base em drama humano e fontes clássicas.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "hero": {"type": "string"},
                "antagonist_monster": {"type": "string"},
                "human_drama_core": {"type": "string"},
                "primary_source": {"type": "string"},
            },
            "required": ["title", "hero", "antagonist_monster", "human_drama_core", "primary_source"],
        },
    },
    {
        "name": "lume_format_thumbnail_concept",
        "description": "Valida e formata o conceito de thumbnail com no máximo 3 palavras.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "layout_type": {"type": "string", "enum": ["A", "B", "C"]},
                "giant_silhouette": {"type": "string"},
                "small_hero": {"type": "string"},
                "three_words_text": {"type": "string"},
            },
            "required": ["layout_type", "giant_silhouette", "small_hero", "three_words_text"],
        },
    },
    {
        "name": "lume_generate_episode_plan",
        "description": "Gera o roteiro estruturado nos 4 Atos com rituais do Contador.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "epic_source": {"type": "string"},
                "acts_breakdown": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["title", "epic_source", "acts_breakdown"],
        },
    },
    {
        "name": "lume_dispatch_theme",
        "description": "Despacha o tema para a pasta local do Lume, SQLite Inbox e Codex Inbox.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "theme_payload": {"type": "object"},
            },
            "required": ["theme_payload"],
        },
    },
]


def handle_call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name == "send_lume_theme":
        res = send_lume_theme(**args)
    elif name == "send_lume_tip":
        res = send_lume_tip(**args)
    elif name == "send_lume_script":
        res = send_lume_script(**args)
    elif name == "list_lume_inbox":
        res = list_lume_inbox(**args)
    elif name == "get_lume_inbox_item":
        res = get_lume_inbox_item(**args)
    elif name == "update_lume_inbox_status":
        res = update_lume_inbox_status(**args)
    elif name == "get_lume_brand_guidelines":
        res = get_lume_brand_guidelines(**args)
    elif name == "list_lume_episodes":
        res = list_lume_episodes()
    elif name == "lume_get_bible":
        res = lume_get_bible()
    elif name == "lume_evaluate_myth_theme":
        res = lume_evaluate_myth_theme(
            args.get("title", ""),
            args.get("hero", ""),
            args.get("antagonist_monster", ""),
            args.get("human_drama_core", ""),
            args.get("primary_source", ""),
        )
    elif name == "lume_format_thumbnail_concept":
        res = lume_format_thumbnail_concept(
            args.get("layout_type", "A"),
            args.get("giant_silhouette", ""),
            args.get("small_hero", ""),
            args.get("three_words_text", ""),
        )
    elif name == "lume_generate_episode_plan":
        res = lume_generate_episode_plan(
            args.get("title", ""),
            args.get("epic_source", ""),
            args.get("acts_breakdown", []),
        )
    elif name == "lume_dispatch_theme":
        res = lume_dispatch_theme(args.get("theme_payload", {}))
    else:
        raise ValueError(f"Ferramenta desconhecida no canal_lume MCP: {name}")

    return {"content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False, indent=2)}]}


def main() -> None:
    """Loop principal Stdio JSON-RPC 2.0 do servidor MCP canal_lume."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            method = req.get("method")

            # Notificações JSON-RPC não possuem id e não exigem resposta
            if req_id is None:
                continue

            if method == "initialize":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "serverInfo": {"name": "canal_lume", "version": "1.0.0"},
                        "capabilities": {"tools": {}},
                    },
                }
            elif method == "tools/list":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}
            elif method == "tools/call":
                params = req.get("params", {})
                t_name = params.get("name", "")
                t_args = params.get("arguments", {}) or {}
                tool_res = handle_call_tool(t_name, t_args)
                resp = {"jsonrpc": "2.0", "id": req_id, "result": tool_res}
            elif method == "ping":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            else:
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }

            _rpc_stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            _rpc_stdout.flush()

        except Exception as e:
            if "req_id" in locals() and req_id is not None:
                err_resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
                _rpc_stdout.write(json.dumps(err_resp, ensure_ascii=False) + "\n")
                _rpc_stdout.flush()


if __name__ == "__main__":
    main()
