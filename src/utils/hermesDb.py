import sys
import os
import sqlite3
import json
import re
from pathlib import Path

def get_hermes_home(h_home_str=None):
    if h_home_str:
        p = Path(h_home_str)
        if p.exists():
            return p
    env_home = os.environ.get("HERMES_HOME", "").strip()
    if env_home and Path(env_home).exists():
        return Path(env_home)

    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            p = Path(local) / "hermes"
            if p.exists():
                return p
        app_data = Path.home() / "AppData" / "Local" / "hermes"
        if app_data.exists():
            return app_data
        dot = Path.home() / ".hermes"
        if dot.exists():
            return dot
        return Path(local) / "hermes" if local else app_data
    elif sys.platform == "darwin":
        dot = Path.home() / ".hermes"
        if dot.exists():
            return dot
        app_sup = Path.home() / "Library" / "Application Support" / "hermes"
        if app_sup.exists():
            return app_sup
        return dot
    else:
        # Linux / BSD / Unix
        dot = Path.home() / ".hermes"
        if dot.exists():
            return dot
        xdg_data = os.environ.get("XDG_DATA_HOME", "")
        if xdg_data and (Path(xdg_data) / "hermes").exists():
            return Path(xdg_data) / "hermes"
        local_share = Path.home() / ".local" / "share" / "hermes"
        if local_share.exists():
            return local_share
        xdg_cfg = os.environ.get("XDG_CONFIG_HOME", "")
        if xdg_cfg and (Path(xdg_cfg) / "hermes").exists():
            return Path(xdg_cfg) / "hermes"
        return dot

def get_db(db_path_str=None):
    if db_path_str:
        db_path = Path(db_path_str)
    else:
        h_home = get_hermes_home()
        db_path = h_home / "state.db"
    
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None

def list_sessions(db_path_str=None, limit=50):
    conn = get_db(db_path_str)
    if not conn:
        print(json.dumps([]))
        return
    try:
        cursor = conn.cursor()
        rows = cursor.execute("""
            SELECT id, title, model, cwd, message_count, source,
                   started_at, COALESCE(last_activity_at, started_at) as last_active
            FROM sessions
            WHERE message_count > 0
            ORDER BY last_active DESC
            LIMIT ?
        """, (limit,)).fetchall()
        
        result = []
        for r in rows:
            result.append({
                "id": r["id"],
                "title": r["title"] or r["id"],
                "model": r["model"] or "",
                "cwd": r["cwd"] or "",
                "messageCount": r["message_count"] or 0,
                "source": r["source"] or "cli",
                "startedAt": r["started_at"] or 0,
                "lastActive": r["last_active"] or 0
            })
        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error listing sessions: {e}\n")
        print(json.dumps([]))

def get_messages(db_path_str, session_id):
    conn = get_db(db_path_str)
    if not conn:
        print(json.dumps([]))
        return
    try:
        cursor = conn.cursor()
        rows = cursor.execute("""
            SELECT id, role, content, tool_calls, tool_name, reasoning, timestamp
            FROM messages
            WHERE session_id = ?
            ORDER BY id ASC
        """, (session_id,)).fetchall()
        
        result = []
        for r in rows:
            tc = None
            if r["tool_calls"]:
                try:
                    raw_tc = json.loads(r["tool_calls"])
                    if isinstance(raw_tc, list):
                        tc = []
                        for item in raw_tc:
                            fn = item.get("function", {}) if isinstance(item, dict) else {}
                            args = fn.get("arguments", "")
                            try:
                                args = json.loads(args) if isinstance(args, str) else args
                            except Exception:
                                pass
                            tc.append({
                                "id": item.get("id") or str(r["id"]),
                                "name": fn.get("name") or item.get("name") or "tool",
                                "args": args,
                                "status": "done"
                            })
                    elif isinstance(raw_tc, dict):
                        tc = [raw_tc]
                except Exception:
                    tc = None
            elif r["role"] == "tool":
                tc = [{
                    "id": str(r["id"]),
                    "name": r["tool_name"] or "tool",
                    "args": r["content"],
                    "status": "done"
                }]
            
            result.append({
                "id": f"msg-{r['id']}",
                "role": r["role"] or "assistant",
                "content": r["content"] or "",
                "thinking": r["reasoning"] or None,
                "toolCalls": tc,
                "timestamp": r["timestamp"] or ""
            })
        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error getting messages: {e}\n")
        print(json.dumps([]))

def list_skills(hermes_home_str=None):
    h_home = get_hermes_home(hermes_home_str)
    skills_dir = h_home / "skills"
    if not skills_dir.exists():
        print(json.dumps([]))
        return

    curated_skills = set()
    ledger_file = skills_dir / ".curator_ledger.jsonl"
    if ledger_file.exists():
        try:
            with open(ledger_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        s_name = entry.get("skill_name") or entry.get("name")
                        if s_name:
                            curated_skills.add(s_name)
                    except Exception:
                        pass
        except Exception:
            pass

    skills = []
    try:
        for cat_dir in skills_dir.iterdir():
            if cat_dir.is_dir() and not cat_dir.name.startswith("."):
                category = cat_dir.name
                for s_dir in cat_dir.iterdir():
                    if s_dir.is_dir() and not s_dir.name.startswith("."):
                        skill_file = s_dir / "SKILL.md"
                        if skill_file.exists():
                            desc = extract_description(skill_file)
                            skill_name = s_dir.name
                            is_learned = skill_name in curated_skills
                            skills.append({
                                "name": skill_name,
                                "description": desc or "Hermes Skill",
                                "category": category,
                                "path": str(skill_file),
                                "dirPath": str(s_dir),
                                "isLearned": is_learned
                            })
        skills.sort(key=lambda s: (0 if s["isLearned"] else 1, s["category"], s["name"]))
        print(json.dumps(skills))
    except Exception as e:
        sys.stderr.write(f"Error listing skills: {e}\n")
        print(json.dumps([]))

def extract_description(skill_file):
    try:
        with open(skill_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        in_fm = False
        for line in lines:
            t = line.strip()
            if t == "---":
                if not in_fm:
                    in_fm = True
                else:
                    break
                continue
            if in_fm and t.startswith("description:"):
                desc = t[len("description:"):].strip()
                if (desc.startswith('"') and desc.endswith('"')) or (desc.startswith("'") and desc.endswith("'")):
                    desc = desc[1:-1]
                return desc
    except Exception:
        pass
    return None

KNOWN_PROVIDERS = [
    {
        "id": "openrouter",
        "name": "OpenRouter (300+ models, free options)",
        "envVar": "OPENROUTER_API_KEY",
        "baseUrl": "https://openrouter.ai/api/v1",
        "docUrl": "https://openrouter.ai/keys",
        "popularModels": [
            {"id": "nvidia/nemotron-3-ultra-550b-a55b:free", "name": "NVIDIA Nemotron 3 Ultra 550B (Free)", "tag": "Free"},
            {"id": "thinkingmachines/inkling:free", "name": "Inkling (Free)", "tag": "Free"},
            {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B Instruct (Free)", "tag": "Free"},
            {"id": "deepseek/deepseek-r1:free", "name": "DeepSeek R1 (Free)", "tag": "Free"},
            {"id": "google/gemini-2.0-flash-exp:free", "name": "Gemini 2.0 Flash (Free)", "tag": "Free"},
            {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "tag": "Top Rated"},
            {"id": "anthropic/claude-3.5-haiku", "name": "Claude 3.5 Haiku", "tag": "Fast"},
            {"id": "openai/gpt-4o", "name": "OpenAI GPT-4o", "tag": "Flagship"},
            {"id": "openai/gpt-4o-mini", "name": "OpenAI GPT-4o Mini", "tag": "Fast"},
            {"id": "deepseek/deepseek-chat", "name": "DeepSeek V3", "tag": "Smart"}
        ]
    },
    {
        "id": "gemini",
        "name": "Google AI Studio / Gemini",
        "envVar": "GOOGLE_API_KEY",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "docUrl": "https://aistudio.google.com/app/apikey",
        "popularModels": [
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "tag": "Recommended"},
            {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "tag": "Most Capable"},
            {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "tag": "Fast"},
            {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "tag": "Large Context"}
        ]
    },
    {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "envVar": "ANTHROPIC_API_KEY",
        "baseUrl": "https://api.anthropic.com/v1",
        "docUrl": "https://console.anthropic.com/settings/keys",
        "popularModels": [
            {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet", "tag": "Coding"},
            {"id": "claude-3-5-haiku-20241022", "name": "Claude 3.5 Haiku", "tag": "Fast"},
            {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus", "tag": "Deep Thinking"}
        ]
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "envVar": "OPENAI_API_KEY",
        "baseUrl": "https://api.openai.com/v1",
        "docUrl": "https://platform.openai.com/api-keys",
        "popularModels": [
            {"id": "gpt-4o", "name": "GPT-4o", "tag": "Flagship"},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "tag": "Fast"},
            {"id": "o1-preview", "name": "o1 Reasoning", "tag": "Reasoning"},
            {"id": "o1-mini", "name": "o1 Mini", "tag": "Math & Code"}
        ]
    },
    {
        "id": "groq",
        "name": "Groq (Ultra-Fast Inference)",
        "envVar": "GROQ_API_KEY",
        "baseUrl": "https://api.groq.com/openai/v1",
        "docUrl": "https://console.groq.com/keys",
        "popularModels": [
            {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B", "tag": "Ultra Fast"},
            {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B", "tag": "Instant"},
            {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B", "tag": "High Context"}
        ]
    },
    {
        "id": "deepseek",
        "name": "DeepSeek API",
        "envVar": "DEEPSEEK_API_KEY",
        "baseUrl": "https://api.deepseek.com",
        "docUrl": "https://platform.deepseek.com/api_keys",
        "popularModels": [
            {"id": "deepseek-chat", "name": "DeepSeek V3", "tag": "Flagship"},
            {"id": "deepseek-reasoner", "name": "DeepSeek R1", "tag": "Reasoning"}
        ]
    },
    {
        "id": "ollama",
        "name": "Ollama (Local Models)",
        "envVar": "",
        "baseUrl": "http://localhost:11434/v1",
        "docUrl": "https://ollama.com",
        "popularModels": [
            {"id": "llama3.3", "name": "Llama 3.3 (Local)", "tag": "Local"},
            {"id": "deepseek-r1:14b", "name": "DeepSeek R1 14B (Local)", "tag": "Local"},
            {"id": "qwen2.5-coder:7b", "name": "Qwen 2.5 Coder (Local)", "tag": "Local"},
            {"id": "mistral:7b", "name": "Mistral 7B (Local)", "tag": "Local"}
        ]
    },
    {
        "id": "custom",
        "name": "Custom OpenAI-Compatible API",
        "envVar": "CUSTOM_API_KEY",
        "baseUrl": "",
        "docUrl": "",
        "popularModels": []
    }
]

def mask_key(k):
    if not k:
        return ""
    if len(k) <= 8:
        return "••••••••"
    return k[:3] + "••••••••" + k[-4:]

def get_model_config(hermes_home_str=None):
    h_home = get_hermes_home(hermes_home_str)
    cfg_file = h_home / "config.yaml"
    env_file = h_home / ".env"
    cache_file = h_home / "models_dev_cache.json"

    cur_provider = "openrouter"
    cur_model = ""
    cur_base_url = ""

    if cfg_file.exists():
        try:
            with open(cfg_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            m_def = re.search(r'(?m)^\s*default:\s*[\'"]?([^\'"\r\n]+)[\'"]?', content)
            if m_def:
                cur_model = m_def.group(1).strip()
            m_prov = re.search(r'(?m)^\s*provider:\s*[\'"]?([^\'"\r\n]+)[\'"]?', content)
            if m_prov:
                cur_provider = m_prov.group(1).strip()
            m_base = re.search(r'(?m)^\s*base_url:\s*[\'"]?([^\'"\r\n]+)[\'"]?', content)
            if m_base:
                cur_base_url = m_base.group(1).strip()
        except Exception:
            pass

    env_keys = {}
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if v:
                            env_keys[k] = v
        except Exception:
            pass

    # Read extra cached models if available
    cached_catalog = {}
    if cache_file.exists():
        try:
            with open(cache_file, "r", encoding="utf-8", errors="ignore") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for pid, pdata in data.items():
                        if isinstance(pdata, dict) and "models" in pdata:
                            ms = pdata.get("models")
                            if isinstance(ms, dict):
                                cached_catalog[pid] = [{"id": mid, "name": minfo.get("name") or mid} for mid, minfo in ms.items()]
                            elif isinstance(ms, list):
                                cached_catalog[pid] = [{"id": m, "name": m} for m in ms]
        except Exception:
            pass

    providers_out = []
    for kp in KNOWN_PROVIDERS:
        pid = kp["id"]
        e_var = kp["envVar"]
        val = env_keys.get(e_var, "")
        if not val and pid == "gemini":
            val = env_keys.get("GEMINI_API_KEY", "")
        
        has_key = bool(val) or pid == "ollama"
        key_masked = mask_key(val) if val else ("Local" if pid == "ollama" else "")

        models = list(kp["popularModels"])
        # Append cached models if available and not duplicated
        if pid in cached_catalog:
            existing_ids = {m["id"] for m in models}
            for cm in cached_catalog[pid]:
                if cm["id"] not in existing_ids:
                    models.append({"id": cm["id"], "name": cm["name"], "tag": "Catalog"})

        providers_out.append({
            "id": pid,
            "name": kp["name"],
            "envVar": e_var,
            "hasKey": has_key,
            "keyMasked": key_masked,
            "baseUrl": kp["baseUrl"],
            "docUrl": kp["docUrl"],
            "models": models[:60] # top models
        })

    out = {
        "current": {
            "provider": cur_provider,
            "model": cur_model,
            "baseUrl": cur_base_url
        },
        "providers": providers_out
    }
    print(json.dumps(out))

def save_model_config(hermes_home_str, provider, model, api_key=None, base_url=None):
    h_home = get_hermes_home(hermes_home_str)
    cfg_file = h_home / "config.yaml"
    env_file = h_home / ".env"

    try:
        # 1. Update config.yaml
        if cfg_file.exists():
            with open(cfg_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        else:
            content = "model:\n  default: ''\n  provider: ''\n"

        # Update default model
        if re.search(r'(?m)^\s*default:\s*.*$', content):
            content = re.sub(r'(?m)^(\s*default:\s*).*$', rf"\1'{model}'", content)
        else:
            content = re.sub(r'(?m)^(model:\s*)$', rf"\1\n  default: '{model}'", content)

        # Update provider
        if re.search(r'(?m)^\s*provider:\s*.*$', content):
            content = re.sub(r'(?m)^(\s*provider:\s*).*$', rf"\1{provider}", content)
        else:
            content = re.sub(r'(?m)^(model:\s*)$', rf"\1\n  provider: {provider}", content)

        # Update base_url
        if base_url:
            if re.search(r'(?m)^\s*base_url:\s*.*$', content):
                content = re.sub(r'(?m)^(\s*base_url:\s*).*$', rf"\1{base_url}", content)
            else:
                content = re.sub(r'(?m)^(\s*provider:\s*.*)$', rf"\1\n  base_url: {base_url}", content)

        with open(cfg_file, "w", encoding="utf-8") as f:
            f.write(content)

        # 2. Update .env if key is provided and not masked
        if api_key and not "•" in api_key:
            env_var = None
            for p in KNOWN_PROVIDERS:
                if p["id"] == provider:
                    env_var = p["envVar"]
                    break
            if not env_var and provider == "gemini":
                env_var = "GOOGLE_API_KEY"

            if env_var:
                env_content = ""
                if env_file.exists():
                    with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
                        env_content = f.read()

                pattern = rf'(?m)^#?\s*{re.escape(env_var)}=.*$'
                replacement = f"{env_var}={api_key.strip()}"
                if re.search(pattern, env_content):
                    env_content = re.sub(pattern, replacement, env_content, count=1)
                else:
                    env_content = env_content.rstrip() + f"\n{replacement}\n"

                with open(env_file, "w", encoding="utf-8") as f:
                    f.write(env_content)

        print(json.dumps({"success": True, "provider": provider, "model": model}))
    except Exception as e:
        sys.stderr.write(f"Error saving model config: {e}\n")
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    if action == "list":
        db_path = sys.argv[2] if len(sys.argv) > 2 else ""
        limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 50
        list_sessions(db_path, limit)
    elif action == "messages":
        db_path = sys.argv[2] if len(sys.argv) > 2 else ""
        sid = sys.argv[3] if len(sys.argv) > 3 else ""
        get_messages(db_path, sid)
    elif action == "skills":
        h_home = sys.argv[2] if len(sys.argv) > 2 else ""
        list_skills(h_home)
    elif action == "models":
        h_home = sys.argv[2] if len(sys.argv) > 2 else ""
        get_model_config(h_home)
    elif action == "save_model":
        args = sys.argv[2:]
        if len(args) >= 2 and (not Path(args[0]).exists() or args[0] in [p["id"] for p in KNOWN_PROVIDERS] or args[0] == ""):
            if args[0] == "":
                args = args[1:]
            prov = args[0] if len(args) > 0 else "openrouter"
            mdl = args[1] if len(args) > 1 else ""
            key = args[2] if len(args) > 2 and args[2] != "-" else None
            b_url = args[3] if len(args) > 3 and args[3] != "-" else None
            h_home = ""
        else:
            h_home = args[0] if len(args) > 0 else ""
            prov = args[1] if len(args) > 1 else "openrouter"
            mdl = args[2] if len(args) > 2 else ""
            key = args[3] if len(args) > 3 and args[3] != "-" else None
            b_url = args[4] if len(args) > 4 and args[4] != "-" else None
        save_model_config(h_home, prov, mdl, key, b_url)
