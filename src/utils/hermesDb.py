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

def list_sessions(db_path_str=None, limit=100):
    conn = get_db(db_path_str)
    if not conn:
        print(json.dumps([]))
        return
    try:
        cursor = conn.cursor()
        rows = cursor.execute("""
            SELECT id, title, model, cwd, message_count, source,
                   started_at, COALESCE(last_activity_at, started_at) as last_active,
                   COALESCE(archived, 0) as archived
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
                "lastActive": r["last_active"] or 0,
                "archived": bool(r["archived"])
            })
        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error listing sessions: {e}\n")
        print(json.dumps([]))

def archive_session(db_path_str, session_id, archive=True):
    conn = get_db(db_path_str)
    if not conn:
        print(json.dumps({"success": False, "error": "Database not accessible"}))
        return
    try:
        val = 1 if archive else 0
        cursor = conn.cursor()
        cursor.execute("UPDATE sessions SET archived = ? WHERE id = ?", (val, session_id))
        conn.commit()
        print(json.dumps({"success": True, "sessionId": session_id, "archived": bool(val)}))
    except Exception as e:
        sys.stderr.write(f"Error archiving session: {e}\n")
        print(json.dumps({"success": False, "error": str(e)}))

def delete_session(db_path_str, session_id):
    conn = get_db(db_path_str)
    if not conn:
        print(json.dumps({"success": False, "error": "Database not accessible"}))
        return
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        try:
            cursor.execute("DELETE FROM session_model_usage WHERE session_id = ?", (session_id,))
        except Exception:
            pass
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        print(json.dumps({"success": True, "sessionId": session_id, "deleted": True}))
    except Exception as e:
        sys.stderr.write(f"Error deleting session: {e}\n")
        print(json.dumps({"success": False, "error": str(e)}))

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

# =============================================================================
# Models and Inference Operators Management
# =============================================================================

def bootstrap_hermes_cli(h_home):
    """Attempt to import hermes CLI and bootstrap its environment."""
    os.environ["HERMES_HOME"] = str(h_home)
    candidates = [
        h_home / "hermes-agent",
        h_home.parent / "hermes-agent",
        Path.home() / ".hermes" / "hermes-agent"
    ]
    env_agent = os.environ.get("HERMES_AGENT_PATH")
    if env_agent:
        candidates.insert(0, Path(env_agent))
        
    for p in candidates:
        if p.exists() and ((p / "hermes_bootstrap.py").exists() or (p / "hermes_cli").exists()):
            if str(p) not in sys.path:
                sys.path.insert(0, str(p))
            try:
                import hermes_bootstrap
                return True
            except Exception:
                pass
    return False

def mask_key(k):
    if not k:
        return ""
    if len(k) <= 8:
        return "••••••••"
    return k[:3] + "••••••••" + k[-4:]

def clean_model_name(model_id):
    """Converts a raw model id like 'nvidia/nemotron-3-ultra-550b-a55b:free' into a clean readable title."""
    name = model_id.split("/")[-1]
    name = re.sub(r':free$', '', name, flags=re.IGNORECASE)
    parts = re.split(r'[-_]', name)
    capitalized = " ".join([p.upper() if p.lower() in {"ai", "gpt", "api", "moa", "nim", "ui", "r1", "v1", "v2", "v3", "v4"} or any(c.isdigit() for c in p) else p.capitalize() for p in parts])
    return capitalized or model_id

# Canonical Fallback Providers (matches hermes model CLI catalog of 53+ providers)
FALLBACK_PROVIDERS = [
    {"id": "nous", "name": "Nous Portal (Everything your agent needs, 300+ models with bundled tool use)", "envVar": "NOUS_API_KEY", "baseUrl": ""},
    {"id": "fireworks", "name": "Fireworks AI (OpenAI-compatible direct model API)", "envVar": "FIREWORKS_API_KEY", "baseUrl": "https://api.fireworks.ai/inference/v1"},
    {"id": "openrouter", "name": "OpenRouter (Pay-per-use API aggregator)", "envVar": "OPENROUTER_API_KEY", "baseUrl": "https://openrouter.ai/api/v1"},
    {"id": "moa", "name": "Mixture of Agents (named presets; aggregator acts after reference models)", "envVar": "", "baseUrl": ""},
    {"id": "novita", "name": "NovitaAI (Cloud: Model API, Agent Sandbox, GPU Cloud)", "envVar": "NOVITA_API_KEY", "baseUrl": "https://api.novita.ai/v3/openai"},
    {"id": "lmstudio", "name": "LM Studio (Local desktop app with built-in model server)", "envVar": "LM_API_KEY", "baseUrl": "http://localhost:1234/v1"},
    {"id": "anthropic", "name": "Anthropic (Claude models via API key or Claude Code)", "envVar": "ANTHROPIC_API_KEY", "baseUrl": "https://api.anthropic.com/v1"},
    {"id": "openai-codex", "name": "ChatGPT or Codex Subscription (Sign in with your ChatGPT account, uses Codex models)", "envVar": "", "baseUrl": ""},
    {"id": "openai-api", "name": "OpenAI API (api.openai.com, API key)", "envVar": "OPENAI_API_KEY", "baseUrl": "https://api.openai.com/v1"},
    {"id": "alibaba", "name": "Qwen Cloud / DashScope (Qwen + multi-provider)", "envVar": "DASHSCOPE_API_KEY", "baseUrl": ""},
    {"id": "xai-oauth", "name": "xAI Grok OAuth (SuperGrok / Premium+ subscription)", "envVar": "", "baseUrl": ""},
    {"id": "xiaomi", "name": "Xiaomi MiMo (MiMo-V2.5 and V2 models: pro, omni, flash)", "envVar": "XIAOMI_API_KEY", "baseUrl": ""},
    {"id": "tencent-tokenhub", "name": "Tencent TokenHub (Hy4 preview via tokenhub.tencentmaas.com)", "envVar": "TOKENHUB_API_KEY", "baseUrl": ""},
    {"id": "tencent-tokenplan", "name": "Tencent TokenPlan (Hy4 preview via api.lkeap.cloud.tencent.com, Anthropic Messages)", "envVar": "TOKENPLAN_API_KEY", "baseUrl": ""},
    {"id": "nvidia", "name": "NVIDIA NIM (Nemotron models via build.nvidia.com or local NIM)", "envVar": "NVIDIA_API_KEY", "baseUrl": "https://integrate.api.nvidia.com/v1"},
    {"id": "copilot", "name": "GitHub Copilot (Uses GITHUB_TOKEN or gh auth token)", "envVar": "GITHUB_TOKEN", "baseUrl": ""},
    {"id": "copilot-acp", "name": "GitHub Copilot ACP (Spawns copilot --acp --stdio)", "envVar": "", "baseUrl": ""},
    {"id": "huggingface", "name": "Hugging Face Inference Providers", "envVar": "HF_TOKEN", "baseUrl": ""},
    {"id": "gemini", "name": "Google AI Studio (Native Gemini API)", "envVar": "GOOGLE_API_KEY", "baseUrl": "https://generativelanguage.googleapis.com/v1beta"},
    {"id": "vertex", "name": "Google Vertex AI (Gemini via GCP; OAuth2 service account or ADC, GCP billing/quotas)", "envVar": "", "baseUrl": ""},
    {"id": "deepseek", "name": "DeepSeek (V3, R1, coder, direct API)", "envVar": "DEEPSEEK_API_KEY", "baseUrl": "https://api.deepseek.com"},
    {"id": "xai", "name": "xAI Grok (Direct API)", "envVar": "XAI_API_KEY", "baseUrl": "https://api.x.ai/v1"},
    {"id": "zai", "name": "Z.AI / GLM (Zhipu direct API)", "envVar": "GLM_API_KEY", "baseUrl": ""},
    {"id": "kimi-coding", "name": "Kimi Coding Plan (api.kimi.com & Moonshot API)", "envVar": "KIMI_API_KEY", "baseUrl": ""},
    {"id": "kimi-coding-cn", "name": "Kimi / Moonshot China (Domestic direct API)", "envVar": "KIMI_CN_API_KEY", "baseUrl": ""},
    {"id": "stepfun", "name": "StepFun Step Plan (Agent / coding models via Step Plan API)", "envVar": "STEPFUN_API_KEY", "baseUrl": ""},
    {"id": "minimax", "name": "MiniMax (Global direct API)", "envVar": "MINIMAX_API_KEY", "baseUrl": ""},
    {"id": "minimax-oauth", "name": "MiniMax via OAuth browser login (Coding Plan, minimax.io)", "envVar": "", "baseUrl": ""},
    {"id": "minimax-cn", "name": "MiniMax China (Domestic direct API)", "envVar": "MINIMAX_CN_API_KEY", "baseUrl": ""},
    {"id": "ollama-cloud", "name": "Ollama Cloud (Cloud-hosted open models, ollama.com)", "envVar": "OLLAMA_API_KEY", "baseUrl": ""},
    {"id": "arcee", "name": "Arcee AI (Trinity models, direct API)", "envVar": "ARCEEAI_API_KEY", "baseUrl": ""},
    {"id": "gmi", "name": "GMI Cloud (Multi-model direct API)", "envVar": "GMI_API_KEY", "baseUrl": ""},
    {"id": "kilocode", "name": "Kilo Code (Kilo Gateway API)", "envVar": "KILOCODE_API_KEY", "baseUrl": ""},
    {"id": "opencode-zen", "name": "OpenCode Zen (Curated models, pay-as-you-go)", "envVar": "OPENCODE_ZEN_API_KEY", "baseUrl": ""},
    {"id": "opencode-go", "name": "OpenCode Go (Open models subscription)", "envVar": "OPENCODE_GO_API_KEY", "baseUrl": ""},
    {"id": "bedrock", "name": "AWS Bedrock (Claude, Nova, Llama, DeepSeek; IAM or API key)", "envVar": "AWS_ACCESS_KEY_ID", "baseUrl": ""},
    {"id": "azure-foundry", "name": "Azure Foundry (OpenAI-style or Anthropic-style endpoint, your Azure AI deployment)", "envVar": "AZURE_FOUNDRY_API_KEY", "baseUrl": ""},
    {"id": "ai-gateway", "name": "Vercel AI Gateway (Multi-model aggregator)", "envVar": "AI_GATEWAY_API_KEY", "baseUrl": ""},
    {"id": "qwen-oauth", "name": "Qwen OAuth (Reuses local Qwen CLI login)", "envVar": "", "baseUrl": ""},
    {"id": "actual", "name": "Actual Computer - hosted inference via api.actual.inc, or local offline inference via model.base_url in config.yaml", "envVar": "ACTUAL_API_KEY", "baseUrl": ""},
    {"id": "alibaba-cn", "name": "Alibaba Cloud DashScope, mainland-China endpoint", "envVar": "DASHSCOPE_API_KEY", "baseUrl": ""},
    {"id": "alibaba-token-plan", "name": "Alibaba Cloud Model Studio Token Plan (flat-token tier)", "envVar": "ALIBABA_TOKEN_PLAN_API_KEY", "baseUrl": ""},
    {"id": "alibaba-token-plan-cn", "name": "Alibaba Cloud Model Studio Token Plan, mainland-China endpoint", "envVar": "ALIBABA_TOKEN_PLAN_CN_API_KEY", "baseUrl": ""},
    {"id": "alibaba-coding-plan", "name": "Alibaba Cloud Coding Plan (Dedicated coding tier)", "envVar": "ALIBABA_CODING_PLAN_API_KEY", "baseUrl": ""},
    {"id": "alibaba-coding-plan-cn", "name": "Alibaba Cloud Coding Plan, mainland-China endpoint", "envVar": "ALIBABA_CODING_PLAN_CN_API_KEY", "baseUrl": ""},
    {"id": "commandcode", "name": "CommandCode — 20+ models via OpenAI-compatible API", "envVar": "COMMANDCODE_API_KEY", "baseUrl": ""},
    {"id": "commandcode-anthropic", "name": "CommandCode — Claude models via Anthropic Messages API", "envVar": "COMMANDCODE_API_KEY", "baseUrl": ""},
    {"id": "custom", "name": "custom (direct API)", "envVar": "CUSTOM_API_KEY", "baseUrl": ""},
    {"id": "deepinfra", "name": "DeepInfra — 100+ open models, pay-per-use", "envVar": "DEEPINFRA_API_KEY", "baseUrl": "https://api.deepinfra.com/v1/openai"},
    {"id": "meta-ai", "name": "Meta Muse Spark family (Meta Superintelligence Labs)", "envVar": "META_API_KEY", "baseUrl": ""},
    {"id": "nebius-token-factory", "name": "Nebius Token Factory — OpenAI-compatible inference", "envVar": "NEBIUS_API_KEY", "baseUrl": ""},
    {"id": "router", "name": "Ramp Router (router.com) — routes each request to the cheapest model that clears your quality bar", "envVar": "RAMP_ROUTER_API_KEY", "baseUrl": ""},
    {"id": "upstage", "name": "Upstage (Solar API)", "envVar": "UPSTAGE_API_KEY", "baseUrl": ""},
    {"id": "ollama", "name": "Ollama (Local Models at localhost:11434)", "envVar": "", "baseUrl": "http://localhost:11434/v1"},
    {"id": "groq", "name": "Groq (Ultra-Fast Inference)", "envVar": "GROQ_API_KEY", "baseUrl": "https://api.groq.com/openai/v1"}
]

def get_model_config(hermes_home_str=None):
    h_home = get_hermes_home(hermes_home_str)
    cfg_file = h_home / "config.yaml"
    env_file = h_home / ".env"

    cur_provider = "openrouter"
    cur_model = ""
    cur_base_url = ""

    if cfg_file.exists():
        try:
            with open(cfg_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            m_def = re.search(r"(?m)^\s*default:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_def:
                cur_model = m_def.group(1).strip()
            m_prov = re.search(r"(?m)^\s*provider:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_prov:
                cur_provider = m_prov.group(1).strip()
            m_base = re.search(r"(?m)^\s*base_url:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
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

    disk_cached_providers = {}
    provider_cache_file = h_home / "provider_models_cache.json"
    if provider_cache_file.exists():
        try:
            with open(provider_cache_file, "r", encoding="utf-8", errors="ignore") as f:
                disk_cached_providers = json.load(f)
        except Exception:
            pass

    has_hermes_engine = bootstrap_hermes_cli(h_home)
    canonical_list = []
    provider_registry = {}
    models_mod = None
    pricing_mod = None
    static_provider_models = {}

    if has_hermes_engine:
        try:
            from hermes_cli.models_catalog_static import CANONICAL_PROVIDERS, _PROVIDER_MODELS
            from hermes_cli.auth import PROVIDER_REGISTRY
            from hermes_cli import models, models_pricing
            canonical_list = CANONICAL_PROVIDERS
            static_provider_models = _PROVIDER_MODELS
            provider_registry = PROVIDER_REGISTRY
            models_mod = models
            pricing_mod = models_pricing
        except Exception as e:
            sys.stderr.write(f"Hermes engine load error: {e}\n")

    providers_out = []
    seen_pids = set()

    if canonical_list:
        for p in canonical_list:
            pid = p.slug
            seen_pids.add(pid)
            pname = p.tui_desc or p.label
            reg = provider_registry.get(pid) if provider_registry else None
            
            env_vars = list(reg.api_key_env_vars) if reg and reg.api_key_env_vars else []
            if not env_vars:
                if pid == "openrouter":
                    env_vars = ["OPENROUTER_API_KEY"]
                elif pid == "gemini":
                    env_vars = ["GOOGLE_API_KEY", "GEMINI_API_KEY"]
                elif pid in {"openai-api", "openai"}:
                    env_vars = ["OPENAI_API_KEY"]
                elif pid == "anthropic":
                    env_vars = ["ANTHROPIC_API_KEY"]
                elif pid == "deepseek":
                    env_vars = ["DEEPSEEK_API_KEY"]
                elif pid == "groq":
                    env_vars = ["GROQ_API_KEY"]
                elif pid == "custom":
                    env_vars = ["CUSTOM_API_KEY"]

            val = ""
            for ev in env_vars:
                if ev in env_keys:
                    val = env_keys[ev]
                    break
            if not val and pid == "gemini":
                val = env_keys.get("GOOGLE_API_KEY") or env_keys.get("GEMINI_API_KEY", "")

            has_key = bool(val) or pid == "ollama" or (pid in {"openai-codex", "xai-oauth", "qwen-oauth", "minimax-oauth"})
            key_masked = mask_key(val) if val else ("OAuth / CLI" if pid in {"openai-codex", "xai-oauth", "qwen-oauth", "minimax-oauth"} else ("Local" if pid == "ollama" else ""))
            base_url = (reg.inference_base_url if reg and hasattr(reg, "inference_base_url") else "") or ""

            m_list = []
            cached_models = disk_cached_providers.get(pid, {}).get("models", []) if isinstance(disk_cached_providers.get(pid), dict) else []

            if pid == "openrouter":
                try:
                    or_ids = cached_models or (models_mod.provider_model_ids("openrouter") if models_mod else [])
                    or_pricing = pricing_mod.get_pricing_for_provider("openrouter") if pricing_mod else {}
                    for mid in or_ids:
                        pr = or_pricing.get(mid)
                        is_free = False
                        if pr:
                            try:
                                is_free = float(pr.get("prompt", 1)) == 0 and float(pr.get("completion", 1)) == 0
                            except Exception:
                                pass
                        if not is_free and (":free" in mid.lower() or (models_mod and hasattr(models_mod, "_openrouter_model_is_free") and models_mod._openrouter_model_is_free(mid))):
                            is_free = True

                        if is_free:
                            tag = "Free"
                        elif any(k in mid.lower() for k in ["sonnet", "gpt-4o", "deepseek-chat", "opus"]):
                            tag = "Top Rated"
                        elif any(k in mid.lower() for k in ["haiku", "mini", "flash"]):
                            tag = "Fast"
                        elif any(k in mid.lower() for k in ["r1", "o1", "o3", "reason"]):
                            tag = "Reasoning"
                        else:
                            tag = "Catalog"
                        
                        m_list.append({
                            "id": mid,
                            "name": clean_model_name(mid),
                            "tag": tag
                        })
                    m_list.sort(key=lambda x: 0 if x["tag"] == "Free" else (1 if x["tag"] == "Top Rated" else (2 if x["tag"] == "Fast" else 3)))
                except Exception as e:
                    sys.stderr.write(f"Error fetching openrouter models: {e}\n")

            elif pid == "gemini":
                try:
                    g_ids = list(cached_models) if cached_models else (list(models_mod.provider_model_ids("gemini")) if models_mod else [])
                    for extra in ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemma-4-31b-it", "gemma-4-26b-a4b-it"]:
                        if extra not in g_ids:
                            g_ids.append(extra)
                    for mid in g_ids:
                        if "3.1-pro" in mid:
                            tag = "Recommended"
                        elif "3-flash" in mid:
                            tag = "Fast Preview"
                        elif "2.5-pro" in mid:
                            tag = "Most Capable"
                        elif "flash-lite" in mid:
                            tag = "Fast Lite"
                        elif "flash" in mid:
                            tag = "Fast"
                        elif "gemma" in mid:
                            tag = "Open Weights"
                        else:
                            tag = "Official"
                        m_list.append({
                            "id": mid,
                            "name": mid,
                            "tag": tag
                        })
                except Exception as e:
                    sys.stderr.write(f"Error fetching gemini models: {e}\n")

            elif pid in {"copilot", "copilot-acp"} and (cached_models or (models_mod and pid == "copilot-acp")):
                try:
                    c_ids = cached_models or (list(models_mod.provider_model_ids("copilot-acp")) if models_mod else [])
                    for mid in c_ids:
                        tag = "Fast" if "mini" in mid else ("Flagship" if any(k in mid for k in ["5.4", "opus", "sonnet"]) else "Catalog")
                        m_list.append({
                            "id": mid,
                            "name": clean_model_name(mid),
                            "tag": tag
                        })
                except Exception:
                    pass

            else:
                static_ms = cached_models or static_provider_models.get(pid, [])
                if not static_ms and models_mod:
                    try:
                        curated = models_mod.curated_models_for_provider(pid)
                        if curated:
                            static_ms = [c[0] if isinstance(c, tuple) else c for c in curated]
                    except Exception:
                        pass
                if not static_ms and pid in {"anthropic", "openai-api", "deepseek", "nvidia", "alibaba"} and models_mod:
                    try:
                        static_ms = models_mod.provider_model_ids(pid)
                    except Exception:
                        pass
                for mid in static_ms:
                    m_list.append({
                        "id": mid,
                        "name": clean_model_name(mid),
                        "tag": "Catalog"
                    })

            providers_out.append({
                "id": pid,
                "name": pname,
                "envVar": env_vars[0] if env_vars else "",
                "hasKey": has_key,
                "keyMasked": key_masked,
                "baseUrl": base_url,
                "docUrl": "",
                "models": m_list[:70]
            })

    for fb in FALLBACK_PROVIDERS:
        f_id = fb["id"]
        if f_id in seen_pids:
            continue
        seen_pids.add(f_id)
        e_var = fb["envVar"]
        val = env_keys.get(e_var, "") if e_var else ""
        has_key = bool(val) or f_id == "ollama"
        key_masked = mask_key(val) if val else ("Local" if f_id == "ollama" else "")

        models = []
        if f_id == "ollama":
            models = [
                {"id": "llama3.3", "name": "Llama 3.3", "tag": "Local"},
                {"id": "deepseek-r1:14b", "name": "DeepSeek R1 14B", "tag": "Local"},
                {"id": "qwen2.5-coder:7b", "name": "Qwen 2.5 Coder", "tag": "Local"},
                {"id": "mistral:7b", "name": "Mistral 7B", "tag": "Local"}
            ]
        elif f_id == "groq":
            models = [
                {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B", "tag": "Ultra Fast"},
                {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B", "tag": "Instant"},
                {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B", "tag": "High Context"}
            ]

        providers_out.append({
            "id": f_id,
            "name": fb["name"],
            "envVar": e_var,
            "hasKey": has_key,
            "keyMasked": key_masked,
            "baseUrl": fb.get("baseUrl", ""),
            "docUrl": "",
            "models": models
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
        if cfg_file.exists():
            with open(cfg_file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        else:
            content = "model:\n  default: ''\n  provider: ''\n"

        if re.search(r'(?m)^\s*default:\s*.*$', content):
            content = re.sub(r'(?m)^(\s*default:\s*).*$', r"\g<1>'" + model + "'", content)
        else:
            content = re.sub(r'(?m)^(model:\s*)$', r"\g<1>\n  default: '" + model + "'", content)

        if re.search(r'(?m)^\s*provider:\s*.*$', content):
            content = re.sub(r'(?m)^(\s*provider:\s*).*$', r"\g<1>" + provider, content)
        else:
            content = re.sub(r'(?m)^(model:\s*)$', r"\g<1>\n  provider: " + provider, content)

        if base_url and base_url != "-":
            if re.search(r'(?m)^\s*base_url:\s*.*$', content):
                content = re.sub(r'(?m)^(\s*base_url:\s*).*$', r"\g<1>" + base_url, content)
            else:
                content = re.sub(r'(?m)^(\s*provider:\s*.*)$', r"\g<1>\n  base_url: " + base_url, content)

        with open(cfg_file, "w", encoding="utf-8") as f:
            f.write(content)

        if api_key and api_key != "-" and not "•" in api_key:
            env_var = None
            if provider == "openrouter":
                env_var = "OPENROUTER_API_KEY"
            elif provider == "gemini":
                env_var = "GOOGLE_API_KEY"
            elif provider in {"openai-api", "openai"}:
                env_var = "OPENAI_API_KEY"
            elif provider == "anthropic":
                env_var = "ANTHROPIC_API_KEY"
            elif provider == "deepseek":
                env_var = "DEEPSEEK_API_KEY"
            elif provider == "groq":
                env_var = "GROQ_API_KEY"
            elif provider == "custom":
                env_var = "CUSTOM_API_KEY"
            else:
                for fb in FALLBACK_PROVIDERS:
                    if fb["id"] == provider and fb["envVar"]:
                        env_var = fb["envVar"]
                        break
                if not env_var:
                    env_var = f"{provider.upper().replace('-', '_')}_API_KEY"

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
                    env_content = env_content.rstrip() + "\n" + replacement + "\n"

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
    elif action == "archive":
        args = sys.argv[2:]
        if len(args) == 1:
            db_path = ""
            sid = args[0]
            unarch = False
        elif len(args) >= 2 and args[1] in {"unarchive", "0", "restore", "false"}:
            db_path = ""
            sid = args[0]
            unarch = True
        elif len(args) >= 2 and Path(args[0]).exists():
            db_path = args[0]
            sid = args[1]
            unarch = len(args) > 2 and args[2] in {"unarchive", "0", "restore", "false"}
        else:
            db_path = ""
            sid = args[0]
            unarch = False
        archive_session(db_path, sid, archive=not unarch)
    elif action == "delete":
        args = sys.argv[2:]
        if len(args) == 1:
            db_path = ""
            sid = args[0]
        elif len(args) >= 2 and Path(args[0]).exists():
            db_path = args[0]
            sid = args[1]
        else:
            db_path = ""
            sid = args[0]
        delete_session(db_path, sid)
    elif action == "save_model":
        args = sys.argv[2:]
        if len(args) > 0 and Path(args[0]).is_dir():
            h_home = args[0]
            prov = args[1] if len(args) > 1 else "openrouter"
            mdl = args[2] if len(args) > 2 else ""
            key = args[3] if len(args) > 3 and args[3] != "-" else None
            b_url = args[4] if len(args) > 4 and args[4] != "-" else None
        else:
            prov = args[0] if len(args) > 0 else "openrouter"
            mdl = args[1] if len(args) > 1 else ""
            key = args[2] if len(args) > 2 and args[2] != "-" else None
            b_url = args[3] if len(args) > 3 and args[3] != "-" else None
            h_home = args[4] if len(args) > 4 and args[4] != "-" else ""
        save_model_config(h_home, prov, mdl, key, b_url)
