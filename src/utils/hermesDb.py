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
        conn = sqlite3.connect(str(db_path), timeout=20.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout = 20000")
            conn.execute("PRAGMA journal_mode = WAL")
        except Exception:
            pass
        return conn
    except Exception as e:
        sys.stderr.write(f"Error opening database {db_path}: {e}\n")
        return None

def query_sessions(db_path_str=None, limit=100):
    conn = get_db(db_path_str)
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        cols = {c[1] for c in cursor.execute("PRAGMA table_info(sessions)").fetchall()}
        has_rev = "transcript_revision" in cols
        has_tokens = all(k in cols for k in ("input_tokens", "output_tokens", "cache_read_tokens", "reasoning_tokens", "api_call_count"))

        where_clause = "(message_count > 0 OR COALESCE(transcript_revision, 0) > 0)" if has_rev else "message_count > 0"
        token_cols = (
            ", COALESCE(input_tokens, 0) as input_tokens, COALESCE(output_tokens, 0) as output_tokens, "
            "COALESCE(cache_read_tokens, 0) as cache_read_tokens, COALESCE(reasoning_tokens, 0) as reasoning_tokens, "
            "COALESCE(api_call_count, 0) as api_call_count"
            if has_tokens else ""
        )

        rows = cursor.execute(f"""
            SELECT id, title, model, cwd, message_count, source,
                   started_at, COALESCE(last_activity_at, started_at) as last_active,
                   COALESCE(archived, 0) as archived{token_cols}
            FROM sessions
            WHERE {where_clause}
            ORDER BY last_active DESC
            LIMIT ?
        """, (limit,)).fetchall()
        
        result = []
        for r in rows:
            item = {
                "id": r["id"],
                "title": r["title"] or r["id"],
                "model": r["model"] or "",
                "cwd": r["cwd"] or "",
                "messageCount": r["message_count"] or 0,
                "source": r["source"] or "cli",
                "startedAt": r["started_at"] or 0,
                "lastActive": r["last_active"] or 0,
                "archived": bool(r["archived"])
            }
            if has_tokens:
                item.update({
                    "inputTokens": r["input_tokens"] or 0,
                    "outputTokens": r["output_tokens"] or 0,
                    "cacheReadTokens": r["cache_read_tokens"] or 0,
                    "reasoningTokens": r["reasoning_tokens"] or 0,
                    "apiCallCount": r["api_call_count"] or 0
                })
            result.append(item)
        return result
    except Exception as e:
        sys.stderr.write(f"Error listing sessions: {e}\n")
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass

def list_sessions(db_path_str=None, limit=100):
    print(json.dumps(query_sessions(db_path_str, limit)))

def do_archive_session(db_path_str, session_id, archive=True):
    conn = get_db(db_path_str)
    if not conn:
        return {"success": False, "error": "Database not accessible"}
    try:
        val = 1 if archive else 0
        cursor = conn.cursor()
        cursor.execute("UPDATE sessions SET archived = ? WHERE id = ?", (val, session_id))
        conn.commit()
        return {"success": True, "sessionId": session_id, "archived": bool(val)}
    except Exception as e:
        sys.stderr.write(f"Error archiving session: {e}\n")
        return {"success": False, "error": str(e)}
    finally:
        try:
            conn.close()
        except Exception:
            pass

def archive_session(db_path_str, session_id, archive=True):
    print(json.dumps(do_archive_session(db_path_str, session_id, archive)))

def do_delete_session(db_path_str, session_id):
    conn = get_db(db_path_str)
    if not conn:
        return {"success": False, "error": "Database not accessible"}
    try:
        cursor = conn.cursor()
        # Temporarily disable foreign keys so cascaded or related tables don't reject delete
        cursor.execute("PRAGMA foreign_keys = OFF")

        # 1. Fetch session_key if present for gateway ledger cleanup
        sess_key = None
        try:
            row = cursor.execute("SELECT session_key FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if row and row["session_key"]:
                sess_key = row["session_key"]
        except Exception:
            pass

        # 2. Explicitly clean all known dependent tables (prevent triggers from raising ABORT)
        known_deletes = [
            ("session_admissions", "target_session_id"),
            ("worker_executions", "session_id"),
            ("messages", "session_id"),
            ("session_model_usage", "session_id"),
            ("compression_locks", "session_id"),
            ("hosted_room_remote_runs", "session_id")
        ]
        for tbl, col in known_deletes:
            try:
                cursor.execute(f"DELETE FROM [{tbl}] WHERE [{col}] = ?", (session_id,))
            except Exception:
                pass

        try:
            cursor.execute("""
                DELETE FROM async_delegations 
                WHERE origin_session = ? 
                   OR origin_ui_session_id = ? 
                   OR parent_session_id = ? 
                   OR origin_session_id = ?
            """, (session_id, session_id, session_id, session_id))
        except Exception:
            pass

        if sess_key:
            for tbl in ["gateway_routing", "gateway_hygiene_state", "conversation_generations", "delivery_obligations"]:
                try:
                    cursor.execute(f"DELETE FROM [{tbl}] WHERE session_key = ?", (sess_key,))
                except Exception:
                    pass

        # 3. Dynamic sweep across every other table in the database with matching session column
        tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for tbl in tables:
            if tbl.startswith("sqlite_") or tbl == "sessions":
                continue
            try:
                cols = [c[1] for c in cursor.execute(f"PRAGMA table_info([{tbl}])").fetchall()]
                for c in cols:
                    c_low = c.lower()
                    if c_low in ("session_id", "sessionid", "target_session_id", "parent_session_id", "origin_session_id"):
                        cursor.execute(f"DELETE FROM [{tbl}] WHERE [{c}] = ?", (session_id,))
                    elif sess_key and c_low in ("session_key", "sessionkey"):
                        cursor.execute(f"DELETE FROM [{tbl}] WHERE [{c}] = ?", (sess_key,))
            except Exception:
                pass

        # 4. Drop trigger sessions_runtime_ledger_delete_guard if present so nothing can abort the deletion
        try:
            cursor.execute("DROP TRIGGER IF EXISTS sessions_runtime_ledger_delete_guard")
        except Exception:
            pass

        # Clear self-referencing parent_session_id FKs on child rows before deleting target session
        try:
            cursor.execute("UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?", (session_id,))
        except Exception:
            pass

        # 5. Delete from sessions table
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        still_exists = cursor.execute("SELECT COUNT(*) FROM sessions WHERE id = ?", (session_id,)).fetchone()[0]
        return {"success": still_exists == 0, "sessionId": session_id, "deleted": still_exists == 0}
    except Exception as e:
        sys.stderr.write(f"Error deleting session {session_id}: {e}\n")
        return {"success": False, "error": str(e)}
    finally:
        try:
            conn.close()
        except Exception:
            pass

def delete_session(db_path_str, session_id):
    print(json.dumps(do_delete_session(db_path_str, session_id)))

def do_clear_session_messages(db_path_str, session_id):
    """
    Clears all messages belonging to a session while keeping the session record itself.
    Resets message_count to 0, token counters to 0, and bumps transcript_revision so the
    session remains visible in the Sessions tab with 0 messages.
    """
    if not session_id:
        return {"success": False, "error": "No sessionId provided"}
    db_path = Path(db_path_str) if db_path_str else (get_hermes_home() / "state.db")
    if not db_path or not db_path.exists():
        return {"success": False, "error": "Database file not found"}

    conn = get_db(str(db_path))
    if not conn:
        return {"success": False, "error": "Unable to connect to database"}

    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys = OFF")

        # 1. Delete all messages for this session
        cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))

        # 2. Clean model usage or compression locks specific to this session
        try:
            cursor.execute("DELETE FROM session_model_usage WHERE session_id = ?", (session_id,))
        except Exception:
            pass
        try:
            cursor.execute("DELETE FROM compression_locks WHERE session_id = ?", (session_id,))
        except Exception:
            pass

        # 3. Reset session message count and token counters while preserving the session container
        cols = [c[1] for c in cursor.execute("PRAGMA table_info(sessions)").fetchall()]
        updates = []
        if "message_count" in cols:
            updates.append("message_count = 0")
        if "input_tokens" in cols:
            updates.append("input_tokens = 0")
        if "output_tokens" in cols:
            updates.append("output_tokens = 0")
        if "cache_read_tokens" in cols:
            updates.append("cache_read_tokens = 0")
        if "cache_write_tokens" in cols:
            updates.append("cache_write_tokens = 0")
        if "reasoning_tokens" in cols:
            updates.append("reasoning_tokens = 0")
        if "api_call_count" in cols:
            updates.append("api_call_count = 0")
        if "transcript_revision" in cols:
            updates.append("transcript_revision = COALESCE(transcript_revision, 0) + 1")
        if "title" in cols:
            fallback_title = f"گفتگوی پاکسازی‌شده ({session_id[:8]})"
            updates.append(f"title = COALESCE(NULLIF(TRIM(title), ''), '{fallback_title}')")

        if updates:
            sql = f"UPDATE sessions SET {', '.join(updates)} WHERE id = ?"
            cursor.execute(sql, (session_id,))

        conn.commit()
        return {"success": True, "sessionId": session_id, "cleared": True}
    except Exception as e:
        sys.stderr.write(f"Error clearing messages for session {session_id}: {e}\n")
        return {"success": False, "error": str(e)}
    finally:
        try:
            conn.close()
        except Exception:
            pass

def query_session_usage(db_path_str=None, session_id=None):
    """Return persisted session token metrics, API call count, and today's total requests."""
    conn = get_db(db_path_str)
    if not conn:
        return {}
    try:
        cursor = conn.cursor()
        out = {
            "inputTokens": 0,
            "outputTokens": 0,
            "cacheReadTokens": 0,
            "reasoningTokens": 0,
            "apiCallCount": 0,
            "todayRequests": 0
        }
        cols = {c[1] for c in cursor.execute("PRAGMA table_info(sessions)").fetchall()}
        if session_id and "input_tokens" in cols:
            row = cursor.execute("""
                SELECT COALESCE(input_tokens, 0) as input_tokens,
                       COALESCE(output_tokens, 0) as output_tokens,
                       COALESCE(cache_read_tokens, 0) as cache_read_tokens,
                       COALESCE(reasoning_tokens, 0) as reasoning_tokens,
                       COALESCE(api_call_count, 0) as api_call_count,
                       model, billing_provider
                FROM sessions WHERE id = ?
            """, (session_id,)).fetchone()
            if row:
                out.update({
                    "inputTokens": row["input_tokens"] or 0,
                    "outputTokens": row["output_tokens"] or 0,
                    "cacheReadTokens": row["cache_read_tokens"] or 0,
                    "reasoningTokens": row["reasoning_tokens"] or 0,
                    "apiCallCount": row["api_call_count"] or 0,
                    "model": row["model"] or "",
                    "provider": row["billing_provider"] or ""
                })
        if "api_call_count" in cols and "started_at" in cols:
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc)
            midnight = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            agg = cursor.execute("""
                SELECT COALESCE(SUM(api_call_count), 0)
                FROM sessions
                WHERE COALESCE(last_activity_at, started_at) >= ?
            """, (midnight,)).fetchone()
            if agg and agg[0] is not None:
                out["todayRequests"] = int(agg[0])
        return out
    except Exception as e:
        sys.stderr.write(f"Error querying session usage: {e}\n")
        return {}
    finally:
        try:
            conn.close()
        except Exception:
            pass

def clear_session_messages(db_path_str, session_id):
    print(json.dumps(do_clear_session_messages(db_path_str, session_id)))

def query_messages(db_path_str, session_id):
    conn = get_db(db_path_str)
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        cols = [c[1] for c in cursor.execute("PRAGMA table_info(messages)").fetchall()]
        has_meta = "display_metadata" in cols
        meta_field = ", COALESCE(display_metadata, '') as display_metadata" if has_meta else ""

        rows = cursor.execute(f"""
            SELECT id, role, content, tool_calls, tool_name, reasoning, timestamp, 
                   COALESCE(display_kind, '') as display_kind{meta_field}
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
            
            error_msg = None
            error_code = None
            if has_meta and r["display_metadata"]:
                try:
                    meta_obj = json.loads(r["display_metadata"])
                    if isinstance(meta_obj, dict):
                        error_msg = meta_obj.get("error") or meta_obj.get("message")
                        surface = meta_obj.get("error_surface", {})
                        if isinstance(surface, dict):
                            error_code = surface.get("code")
                            if not error_msg:
                                error_msg = surface.get("message")
                except Exception:
                    pass

            result.append({
                "id": f"msg-{r['id']}",
                "role": r["role"] or "assistant",
                "content": r["content"] or "",
                "thinking": r["reasoning"] or None,
                "toolCalls": tc,
                "timestamp": r["timestamp"] or "",
                "displayKind": r["display_kind"] or "",
                "errorMessage": error_msg,
                "errorCode": error_code
            })
        return result
    except Exception as e:
        sys.stderr.write(f"Error getting messages: {e}\n")
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass

def get_messages(db_path_str, session_id):
    print(json.dumps(query_messages(db_path_str, session_id)))

def query_skills(hermes_home_str=None):
    h_home = get_hermes_home(hermes_home_str)
    skills_dir = h_home / "skills"
    if not skills_dir.exists():
        return []

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
        return skills
    except Exception as e:
        sys.stderr.write(f"Error listing skills: {e}\n")
        return []

def list_skills(hermes_home_str=None):
    print(json.dumps(query_skills(hermes_home_str)))

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
    """Attempt to import hermes CLI and bootstrap its environment without spawning a relaunch child."""
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
        if p.exists() and ((p / "pm" / "environments.py").exists() or (p / "hermes_cli").exists()):
            if str(p) not in sys.path:
                sys.path.insert(0, str(p))
            try:
                # Activate Hermes dependencies in-process (never import hermes_bootstrap at runtime
                # because its top-level prepare_launch() relaunches via subprocess and exits the daemon).
                if (p / "pm" / "environments.py").exists():
                    from pm.environments import activate_dependencies
                    activate_dependencies(p)
                import hermes_cli
                return True
            except BaseException as e:
                sys.stderr.write(f"Hermes bootstrap notice for {p}: {e}\n")
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

def query_model_config(hermes_home_str=None, fast_static=False):
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
                    or_ids = cached_models or ([] if fast_static else (models_mod.provider_model_ids("openrouter") if models_mod else []))
                    or_pricing = {} if fast_static else (pricing_mod.get_pricing_for_provider("openrouter") if pricing_mod else {})
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
                    g_ids = list(cached_models) if cached_models else ([] if fast_static else (list(models_mod.provider_model_ids("gemini")) if models_mod else []))
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

            elif pid in {"copilot", "copilot-acp"} and (cached_models or (not fast_static and models_mod and pid == "copilot-acp")):
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
                if not static_ms and not fast_static and pid in {"anthropic", "openai-api", "deepseek", "nvidia", "alibaba"} and models_mod:
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
    return out

def _http_json(url, headers=None, timeout=4.0):
    """Fetch JSON over HTTP/HTTPS with strict timeout and status reporting."""
    import urllib.request
    import urllib.error
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Hermes-VSCode/1.0.4"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as he:
        try:
            body = he.read().decode("utf-8", errors="ignore")
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {}
        return he.code, parsed
    except Exception as e:
        return 0, {"_error": str(e)}


def _read_hermes_env_and_cfg(h_home):
    cfg_file = h_home / "config.yaml"
    env_file = h_home / ".env"
    cur_provider, cur_model, cur_base_url, reasoning_effort = "openrouter", "", "", ""
    custom_providers = []
    if cfg_file.exists():
        try:
            content = cfg_file.read_text(encoding="utf-8", errors="ignore")
            m_def = re.search(r"(?m)^\s*default:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_def:
                cur_model = m_def.group(1).strip()
            m_prov = re.search(r"(?m)^\s*provider:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_prov:
                cur_provider = m_prov.group(1).strip()
            m_base = re.search(r"(?m)^\s*base_url:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_base:
                cur_base_url = m_base.group(1).strip()
            m_re = re.search(r"(?m)^\s*reasoning_effort:\s*['\"]?([^\r\n'\"]+)['\"]?", content)
            if m_re:
                reasoning_effort = m_re.group(1).strip()
        except Exception:
            pass
    env_keys = {}
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("'\"")
                    if v:
                        env_keys[k] = v
        except Exception:
            pass
    return cur_provider, cur_model, cur_base_url, reasoning_effort, env_keys


def _probe_openrouter_live(api_key="", timeout=4.5):
    res = {"keyStatus": "missing", "keyDetail": "No API key configured", "models": [], "quota": {}}
    hdrs = {"User-Agent": "Hermes-VSCode/1.0.4"}
    if api_key:
        k_hdrs = {**hdrs, "Authorization": f"Bearer {api_key}"}
        code, kdata = _http_json("https://openrouter.ai/api/v1/key", k_hdrs, timeout=timeout)
        if code == 200 and isinstance(kdata, dict):
            d = kdata.get("data") or kdata
            res["keyStatus"] = "valid"
            free_req = d.get("free_model_daily_requests") or {}
            res["keyDetail"] = "Active key" + (" (Free tier)" if d.get("is_free_tier") else " (Paid tier)")
            res["quota"] = {
                "provider": "openrouter",
                "requestsUsed": free_req.get("used"),
                "requestsLimit": free_req.get("limit"),
                "requestsRemaining": free_req.get("remaining"),
                "limit": d.get("limit"),
                "limitRemaining": d.get("limit_remaining"),
                "usage": d.get("usage"),
                "usageDaily": d.get("usage_daily"),
                "usageWeekly": d.get("usage_weekly"),
                "isFreeTier": bool(d.get("is_free_tier")),
                "label": d.get("label") or ""
            }
        elif code in (401, 403):
            res["keyStatus"] = "invalid"
            res["keyDetail"] = f"HTTP {code} invalid OpenRouter key"
        else:
            res["keyStatus"] = "unverified"
            res["keyDetail"] = f"Probe status {code}"

        ccode, cdata = _http_json("https://openrouter.ai/api/v1/credits", k_hdrs, timeout=timeout)
        if ccode == 200 and isinstance(cdata, dict):
            cd = cdata.get("data") or cdata
            tot = cd.get("total_credits")
            used_c = cd.get("total_usage")
            res["quota"]["creditsTotal"] = tot
            res["quota"]["creditsUsage"] = used_c
            if isinstance(tot, (int, float)) and isinstance(used_c, (int, float)):
                res["quota"]["creditsRemaining"] = round(tot - used_c, 6)

    mcode, mdata = _http_json("https://openrouter.ai/api/v1/models", hdrs, timeout=timeout)
    if mcode == 200 and isinstance(mdata, dict) and isinstance(mdata.get("data"), list):
        models_out = []
        for item in mdata["data"]:
            mid = item.get("id")
            if not mid:
                continue
            sp = item.get("supported_parameters") or []
            arch = item.get("architecture") or {}
            pr = item.get("pricing") or {}
            is_free = False
            try:
                is_free = (float(pr.get("prompt", 1)) == 0 and float(pr.get("completion", 1)) == 0) or ":free" in mid.lower()
            except Exception:
                is_free = ":free" in mid.lower()
            supports_r = ("reasoning" in sp or "include_reasoning" in sp)
            ctx_len = item.get("context_length") or (item.get("top_provider") or {}).get("context_length")
            tag = "Free" if is_free else ("Reasoning" if supports_r else "Catalog")
            m_obj = {
                "id": mid,
                "name": item.get("name") or clean_model_name(mid),
                "tag": tag,
                "reasoning": supports_r
            }
            if isinstance(ctx_len, int) and ctx_len > 0:
                m_obj["contextLimit"] = ctx_len
            if supports_r:
                m_obj["reasoningEfforts"] = ["low", "medium", "high"]
            models_out.append(m_obj)
        res["models"] = models_out
    return res


def _probe_gemini_live(api_key, timeout=4.0):
    if not api_key:
        return {"keyStatus": "missing", "keyDetail": "No GOOGLE_API_KEY configured", "models": []}
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    code, data = _http_json(url, timeout=timeout)
    if code == 200 and isinstance(data, dict):
        models_out = []
        for item in data.get("models") or []:
            raw_name = item.get("name") or ""
            mid = raw_name.replace("models/", "")
            methods = item.get("supportedGenerationMethods") or []
            if not mid or ("generateContent" not in methods and "gemini" not in mid.lower() and "gemma" not in mid.lower()):
                continue
            thinking = bool(item.get("thinking")) or ("2.5" in mid or "3" in mid)
            ctx_len = item.get("inputTokenLimit")
            m_obj = {
                "id": mid,
                "name": item.get("displayName") or mid,
                "tag": "Thinking" if thinking else "Official",
                "reasoning": thinking
            }
            if isinstance(ctx_len, int) and ctx_len > 0:
                m_obj["contextLimit"] = ctx_len
            if thinking:
                m_obj["reasoningEfforts"] = ["minimal", "low", "medium", "high"] if "3" in mid else ["low", "medium", "high"]
            models_out.append(m_obj)
        return {"keyStatus": "valid", "keyDetail": f"Verified ({len(models_out)} live models)", "models": models_out}
    elif code in (400, 401, 403):
        return {"keyStatus": "invalid", "keyDetail": f"HTTP {code} invalid Gemini key", "models": []}
    return {"keyStatus": "unverified", "keyDetail": f"HTTP {code}", "models": []}


def _probe_anthropic_live(api_key, timeout=4.0):
    if not api_key:
        return {"keyStatus": "missing", "keyDetail": "No ANTHROPIC_API_KEY", "models": []}
    hdrs = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "User-Agent": "Hermes-VSCode/1.0.4"}
    code, data = _http_json("https://api.anthropic.com/v1/models", hdrs, timeout=timeout)
    if code == 200 and isinstance(data, dict):
        models_out = []
        for item in data.get("data") or []:
            mid = item.get("id")
            if mid:
                r_sup = any(k in mid for k in ("sonnet-4", "opus-4", "3-7", "4-5", "4-6", "4-7"))
                models_out.append({
                    "id": mid,
                    "name": item.get("display_name") or clean_model_name(mid),
                    "tag": "Flagship" if ("opus" in mid or "sonnet" in mid) else "Official",
                    "reasoning": r_sup,
                    "contextLimit": 200000
                })
        return {"keyStatus": "valid", "keyDetail": f"Verified ({len(models_out)} live models)", "models": models_out}
    elif code in (401, 403):
        return {"keyStatus": "invalid", "keyDetail": f"HTTP {code} invalid Anthropic key", "models": []}
    return {"keyStatus": "unverified", "keyDetail": f"HTTP {code}", "models": []}


def _probe_openai_compat_live(pid, base_url, api_key, timeout=3.5):
    if not api_key and pid not in ("ollama", "lmstudio"):
        return {"keyStatus": "missing", "keyDetail": "No API key", "models": []}
    b = (base_url or "").rstrip("/")
    if not b:
        return {"keyStatus": "unverified", "keyDetail": "Key present (no probe endpoint)", "models": []}
    url = f"{b}/models"
    hdrs = {"User-Agent": "Hermes-VSCode/1.0.4"}
    if api_key:
        hdrs["Authorization"] = f"Bearer {api_key}"
    code, data = _http_json(url, hdrs, timeout=timeout)
    if code == 200 and isinstance(data, dict):
        raw_list = data.get("data") if isinstance(data.get("data"), list) else (data.get("models") if isinstance(data.get("models"), list) else [])
        models_out = []
        for item in raw_list:
            mid = item.get("id") or item.get("name") if isinstance(item, dict) else str(item)
            if mid:
                models_out.append({"id": mid, "name": clean_model_name(mid), "tag": "Live"})
        return {"keyStatus": "local" if pid in ("ollama", "lmstudio") else "valid", "keyDetail": f"Reachable ({len(models_out)} models)", "models": models_out}
    elif code in (401, 403):
        return {"keyStatus": "invalid", "keyDetail": f"HTTP {code} invalid key", "models": []}
    return {"keyStatus": ("offline" if pid in ("ollama", "lmstudio") and code == 0 else "unverified"), "keyDetail": f"Status {code}" if code else "Offline/Unreachable", "models": []}


def _probe_ollama_live(base_url="http://localhost:11434", cur_model="", timeout=1.2):
    import urllib.request
    b = (base_url or "http://localhost:11434").rstrip("/")
    if b.endswith("/v1"):
        b = b[:-3]
    code, data = _http_json(f"{b}/api/tags", timeout=timeout)
    if code == 200 and isinstance(data, dict):
        models_out = []
        for m in data.get("models") or []:
            mid = m.get("name") or m.get("model")
            if mid:
                ctx_lim = None
                if cur_model and mid == cur_model:
                    try:
                        req = urllib.request.Request(
                            f"{b}/api/show",
                            data=json.dumps({"name": mid}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=1.0) as r:
                            sdata = json.loads(r.read().decode("utf-8", errors="ignore"))
                            mi = sdata.get("model_info") or {}
                            for k, v in mi.items():
                                if k.endswith(".context_length") and isinstance(v, int) and v > 0:
                                    ctx_lim = v
                                    break
                    except Exception:
                        pass
                obj = {"id": mid, "name": mid, "tag": "Local"}
                if ctx_lim:
                    obj["contextLimit"] = ctx_lim
                models_out.append(obj)
        return {"keyStatus": "local", "keyDetail": f"Ollama active ({len(models_out)} local models)", "models": models_out}
    return {"keyStatus": "unverified", "keyDetail": "Ollama offline", "models": []}


def sync_live_catalog(hermes_home_str=None, db_path_str=None, force_refresh=True):
    """Live sync of providers, models, reasoning capabilities, API key validity, and quotas."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import time

    h_home = get_hermes_home(hermes_home_str)
    cur_provider, cur_model, cur_base_url, reasoning_effort, env_keys = _read_hermes_env_and_cfg(h_home)
    base_data = query_model_config(hermes_home_str, fast_static=True)
    providers = base_data.get("providers") or []

    auth_providers = set()
    auth_file = h_home / "auth.json"
    if auth_file.exists():
        try:
            auth_raw = json.loads(auth_file.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(auth_raw, dict):
                auth_providers.update((auth_raw.get("providers") or {}).keys())
                for k, v in (auth_raw.get("credential_pool") or {}).items():
                    if v:
                        auth_providers.add(k)
        except Exception:
            pass

    # Query DB provider usage frequencies for smart Top-20 ranking
    usage_map = {}
    conn = get_db(db_path_str)
    if conn:
        try:
            cur = conn.cursor()
            cols = {c[1] for c in cur.execute("PRAGMA table_info(sessions)").fetchall()}
            if "billing_provider" in cols:
                rows = cur.execute(
                    "SELECT LOWER(COALESCE(billing_provider, '')) as p, COUNT(*) as cnt, SUM(COALESCE(api_call_count, 0)) as calls FROM sessions GROUP BY LOWER(COALESCE(billing_provider, ''))"
                ).fetchall()
                for r in rows:
                    p = (r["p"] or "").strip()
                    if p:
                        usage_map[p] = {"sessions": int(r["cnt"] or 0), "calls": int(r["calls"] or 0)}
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Load reasoning caps cache (470+ OpenRouter & core models; keyed by endpoint URL -> {"caps": {...}})
    reasoning_caps = {}
    rc_path = h_home / "cache" / "reasoning_caps.json"
    if rc_path.exists():
        try:
            rc_raw = json.loads(rc_path.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(rc_raw, dict):
                if isinstance(rc_raw.get("models"), dict):
                    reasoning_caps.update(rc_raw["models"])
                else:
                    for val in rc_raw.values():
                        if isinstance(val, dict) and isinstance(val.get("caps"), dict):
                            reasoning_caps.update(val["caps"])
                        elif isinstance(val, dict) and "supports_reasoning" in val:
                            reasoning_caps.update(rc_raw)
                            break
        except Exception:
            pass

    # Optionally consult Hermes Python engine inventory & account_usage
    hermes_inv_by_slug = {}
    account_quota_windows = []
    account_plan = ""
    if bootstrap_hermes_cli(h_home):
        try:
            from hermes_cli.inventory import build_model_options_payload, load_picker_context
            inv_payload = build_model_options_payload(load_picker_context(), explicit_only=False, include_unconfigured=True, refresh=False)
            for row in inv_payload.get("providers") or []:
                slug = str(row.get("slug") or "").strip().lower()
                if slug:
                    hermes_inv_by_slug[slug] = row
        except Exception as e:
            sys.stderr.write(f"Hermes inventory warning: {e}\n")
        try:
            from agent.account_usage import fetch_account_usage
            snap = fetch_account_usage(cur_provider)
            if snap:
                account_plan = getattr(snap, "plan", "") or ""
                for w in getattr(snap, "windows", []) or []:
                    used_pct = float(getattr(w, "used_percent", 0) or 0)
                    account_quota_windows.append({
                        "label": getattr(w, "label", ""),
                        "usedPercent": round(used_pct, 1),
                        "remainingPercent": round(max(0.0, 100.0 - used_pct), 1),
                        "resetsAt": w.reset_at.isoformat() if getattr(w, "reset_at", None) else None,
                        "detail": getattr(w, "detail", "") or ""
                    })
        except Exception:
            pass

    # Parallel live probes for configured keys, OpenRouter public catalog, and local servers
    probe_results = {}
    compat_endpoints = {
        "openai-api": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
        "groq": "https://api.groq.com/openai/v1",
        "fireworks": "https://api.fireworks.ai/inference/v1",
        "xai": "https://api.x.ai/v1",
        "nvidia": "https://integrate.api.nvidia.com/v1",
        "novita": "https://api.novita.ai/v3/openai",
        "deepinfra": "https://api.deepinfra.com/v1/openai",
        "alibaba": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "kimi-coding": "https://api.moonshot.ai/v1",
        "lmstudio": "http://localhost:1234/v1"
    }

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {}
        or_key = env_keys.get("OPENROUTER_API_KEY", "")
        if force_refresh or or_key:
            futures[pool.submit(_probe_openrouter_live, or_key, 4.5)] = "openrouter"

        g_key = env_keys.get("GOOGLE_API_KEY") or env_keys.get("GEMINI_API_KEY", "")
        if g_key:
            futures[pool.submit(_probe_gemini_live, g_key, 4.0)] = "gemini"

        a_key = env_keys.get("ANTHROPIC_API_KEY", "")
        if a_key:
            futures[pool.submit(_probe_anthropic_live, a_key, 4.0)] = "anthropic"

        futures[pool.submit(_probe_ollama_live, cur_base_url if cur_provider == "ollama" else "http://localhost:11434", cur_model, 1.0)] = "ollama"

        for p in providers:
            pid = p["id"]
            if pid in ("openrouter", "gemini", "anthropic", "ollama"):
                continue
            ev = p.get("envVar") or ""
            k_val = env_keys.get(ev, "") if ev else ""
            if k_val or pid == "lmstudio":
                b_url = p.get("baseUrl") or compat_endpoints.get(pid, "")
                t_out = 0.8 if pid == "lmstudio" else 3.5
                futures[pool.submit(_probe_openai_compat_live, pid, b_url, k_val, t_out)] = pid

        for fut in as_completed(futures):
            pid = futures[fut]
            try:
                probe_results[pid] = fut.result()
            except Exception as exc:
                probe_results[pid] = {"keyStatus": "unverified", "keyDetail": str(exc), "models": []}

    oauth_pids = {"openai-codex", "xai-oauth", "qwen-oauth", "minimax-oauth", "copilot", "copilot-acp", "vertex"}
    flagship_priority = {
        "openrouter": 500, "openai-codex": 480, "anthropic": 470, "openai-api": 460,
        "gemini": 450, "deepseek": 430, "groq": 410, "ollama": 400, "nous": 390,
        "xai": 380, "copilot-acp": 370, "copilot": 365, "fireworks": 350, "nvidia": 340,
        "alibaba": 330, "deepinfra": 320, "kimi-coding": 310, "minimax": 300,
        "lmstudio": 290, "zai": 280
    }

    quota_out = {}
    or_probe = probe_results.get("openrouter") or {}
    if or_probe.get("quota") and cur_provider == "openrouter":
        quota_out = dict(or_probe["quota"])
    elif or_probe.get("quota") and not account_quota_windows:
        quota_out = dict(or_probe["quota"])
    if account_quota_windows:
        quota_out.setdefault("provider", cur_provider)
        quota_out["windows"] = account_quota_windows
        quota_out["plan"] = account_plan

    session_usage = query_session_usage(db_path_str, None)
    quota_out["todayRequests"] = session_usage.get("todayRequests", 0)

    # Merge probe results, Hermes inventory, and reasoning_caps into each provider
    enriched = []
    for p in providers:
        pid = p["id"]
        pr = probe_results.get(pid)
        inv = hermes_inv_by_slug.get(pid) or {}
        u_info = usage_map.get(pid.lower(), {"sessions": 0, "calls": 0})
        u_count = u_info["sessions"]

        # Determine key status accurately
        key_status = "missing"
        key_detail = ""
        if pr:
            key_status = pr.get("keyStatus") or ("local" if pid == "ollama" else "missing")
            key_detail = pr.get("keyDetail") or ""
        elif inv.get("authenticated") or inv.get("configured") or inv.get("has_credential"):
            key_status = "oauth" if pid in oauth_pids else "valid"
            key_detail = "Authenticated in Hermes"
        elif pid in auth_providers:
            key_status = "oauth" if pid in oauth_pids else "valid"
            key_detail = "Credentials in auth.json"
        elif p.get("envVar") and env_keys.get(p["envVar"]):
            key_status = "unverified"
            key_detail = "API key saved in .env"

        has_key = key_status in ("valid", "oauth", "local", "unverified")
        if pid in ("ollama", "lmstudio") and pr and pr.get("keyStatus") != "local":
            has_key = False
            key_status = "offline" if pr.get("keyStatus") == "offline" else "missing"

        # Build merged model list
        existing_by_id = {m["id"]: dict(m) for m in (p.get("models") or [])}
        # Merge Hermes inventory models if present
        inv_models = inv.get("models") or []
        inv_caps = inv.get("capabilities") or {}
        for mid_raw in inv_models:
            mid = mid_raw.get("id") if isinstance(mid_raw, dict) else str(mid_raw)
            if not mid:
                continue
            if mid not in existing_by_id:
                existing_by_id[mid] = {"id": mid, "name": clean_model_name(mid), "tag": "Catalog"}
            cap = inv_caps.get(mid) or {}
            if isinstance(cap, dict):
                if "supports_reasoning" in cap:
                    existing_by_id[mid]["reasoning"] = bool(cap["supports_reasoning"])
                if cap.get("context_length"):
                    existing_by_id[mid]["contextLimit"] = int(cap["context_length"])

        # Merge live probe models (highest precedence!)
        if pr and pr.get("models"):
            live_by_id = {}
            for lm in pr["models"]:
                mid = lm["id"]
                merged_m = dict(existing_by_id.get(mid, {}))
                merged_m.update(lm)
                live_by_id[mid] = merged_m
            # Retain previous static entries not returned only for fallback
            for mid, em in existing_by_id.items():
                if mid not in live_by_id and len(live_by_id) < 20:
                    live_by_id[mid] = em
            existing_by_id = live_by_id

        # Apply reasoning_caps metadata
        m_list = list(existing_by_id.values())
        for m in m_list:
            mid = m["id"]
            rc = reasoning_caps.get(mid)
            if isinstance(rc, dict):
                if "supports_reasoning" in rc:
                    m["reasoning"] = bool(rc["supports_reasoning"])
                if rc.get("supported_efforts"):
                    m["reasoningEfforts"] = list(rc["supported_efforts"])
                if "mandatory" in rc:
                    m["reasoningMandatory"] = bool(rc["mandatory"])
            elif "reasoning" not in m:
                low_id = mid.lower()
                if any(k in low_id for k in ("-r1", "o1", "o3", "o4", "thinking", "reason", "sonnet-4", "opus-4", "gemini-2.5", "gemini-3", "gpt-5")):
                    m["reasoning"] = True

        # Ensure current model appears under current provider
        if pid == cur_provider and cur_model and cur_model not in existing_by_id:
            m_list.insert(0, {"id": cur_model, "name": clean_model_name(cur_model), "tag": "Active"})

        if pid == "openrouter":
            m_list.sort(key=lambda x: (0 if x["id"] == cur_model else 1, 0 if x.get("tag") == "Free" else (1 if x.get("tag") in ("Top Rated", "Recommended") else 2)))
            m_list = m_list[:150]

        p_obj = dict(p)
        p_obj["hasKey"] = has_key
        p_obj["keyStatus"] = key_status
        p_obj["keyDetail"] = key_detail
        p_obj["usageCount"] = u_count
        p_obj["apiCallCount"] = u_info["calls"]
        p_obj["models"] = m_list
        if pr and pid == "openrouter" and pr.get("quota"):
            p_obj["quota"] = pr["quota"]
        enriched.append(p_obj)

    # Smart ranking: Active > Valid & Used > Valid > OAuth/Local > Configured > Flagship > Remaining
    def _rank_key(item):
        pid = item["id"]
        is_cur = 1 if pid == cur_provider else 0
        ks = item.get("keyStatus") or "missing"
        ks_score = 3 if ks == "valid" else (2 if ks in ("oauth", "local") else (1 if ks == "unverified" else 0))
        has_live_models = 1 if len(item.get("models") or []) > 0 else 0
        u_cnt = int(item.get("usageCount") or 0)
        calls = int(item.get("apiCallCount") or 0)
        f_score = flagship_priority.get(pid, 0)
        return (-is_cur, -ks_score, -u_cnt, -calls, -f_score, -has_live_models, pid)

    enriched.sort(key=_rank_key)
    for idx, item in enumerate(enriched):
        item["rank"] = idx + 1
        item["isTopPriority"] = idx < 20

    cur_obj = dict(base_data.get("current") or {})
    if reasoning_effort:
        cur_obj["reasoningEffort"] = reasoning_effort

    return {
        "current": cur_obj,
        "providers": enriched,
        "quota": quota_out,
        "todayRequests": session_usage.get("todayRequests", 0),
        "syncTimestamp": int(time.time() * 1000),
        "topLimit": 20,
        "totalProviders": len(enriched)
    }


def get_model_config(hermes_home_str=None):
    print(json.dumps(query_model_config(hermes_home_str)))

def do_save_model_config(hermes_home_str, provider, model, api_key=None, base_url=None):
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

                lines = [l for l in env_content.splitlines() if not re.match(rf'^#?\s*{re.escape(env_var)}\s*=', l.strip(), re.I)]
                lines.append(f"{env_var}={api_key.strip()}")
                env_content = "\n".join(lines) + "\n"

                with open(env_file, "w", encoding="utf-8") as f:
                    f.write(env_content)

        return {"success": True, "provider": provider, "model": model}
    except Exception as e:
        sys.stderr.write(f"Error saving model config: {e}\n")
        return {"success": False, "error": str(e)}

def save_model_config(hermes_home_str, provider, model, api_key=None, base_url=None):
    print(json.dumps(do_save_model_config(hermes_home_str, provider, model, api_key, base_url)))

def run_daemon():
    """Persistent warm IPC daemon for fast JSON requests via stdin/stdout without cold starts."""
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            action = req.get("action")
            res_data = None

            if action == "list":
                db_p = req.get("dbPath") or ""
                limit = int(req.get("limit") or 50)
                res_data = query_sessions(db_p, limit)
            elif action == "messages":
                db_p = req.get("dbPath") or ""
                sid = req.get("sessionId") or ""
                res_data = query_messages(db_p, sid)
            elif action == "archive":
                db_p = req.get("dbPath") or ""
                sid = req.get("sessionId") or ""
                arch = bool(req.get("archive", True))
                res_data = do_archive_session(db_p, sid, arch)
            elif action == "delete":
                db_p = req.get("dbPath") or ""
                sid = req.get("sessionId") or ""
                res_data = do_delete_session(db_p, sid)
            elif action in ("clear_messages", "clearMessages", "clear"):
                db_p = req.get("dbPath") or ""
                sid = req.get("sessionId") or ""
                res_data = do_clear_session_messages(db_p, sid)
            elif action == "skills":
                h_home = req.get("hermesHome") or ""
                res_data = query_skills(h_home)
            elif action == "models":
                h_home = req.get("hermesHome") or ""
                res_data = query_model_config(h_home)
            elif action in ("sync_catalog", "syncCatalog"):
                h_home = req.get("hermesHome") or ""
                db_p = req.get("dbPath") or ""
                f_ref = bool(req.get("forceRefresh", True))
                res_data = sync_live_catalog(h_home, db_p, f_ref)
            elif action in ("session_usage", "sessionUsage"):
                db_p = req.get("dbPath") or ""
                sid = req.get("sessionId") or ""
                res_data = query_session_usage(db_p, sid)
            elif action == "save_model":
                h_home = req.get("hermesHome") or ""
                prov = req.get("provider") or "openrouter"
                mdl = req.get("model") or ""
                k = req.get("apiKey")
                b_url = req.get("baseUrl")
                res_data = do_save_model_config(h_home, prov, mdl, k, b_url)
            elif action == "ping":
                res_data = "pong"
            else:
                raise ValueError(f"Unknown daemon action: {action}")

            out = {"id": req_id, "success": True, "data": res_data}
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
        except Exception as e:
            out = {"id": req_id, "success": False, "error": str(e)}
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    if action in {"--daemon", "daemon"}:
        run_daemon()
    elif action == "list":
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
    elif action in ("sync_catalog", "sync-catalog"):
        h_home = sys.argv[2] if len(sys.argv) > 2 else ""
        db_path = sys.argv[3] if len(sys.argv) > 3 else ""
        print(json.dumps(sync_live_catalog(h_home, db_path, True)))
    elif action in ("session_usage", "session-usage"):
        db_path = sys.argv[2] if len(sys.argv) > 2 else ""
        sid = sys.argv[3] if len(sys.argv) > 3 else ""
        print(json.dumps(query_session_usage(db_path, sid)))
    elif action == "archive":
        args = sys.argv[2:]
        if len(args) >= 3:
            db_path = args[0]
            sid = args[1]
            unarch = args[2] in {"unarchive", "0", "restore", "false"}
        elif len(args) == 2:
            db_path = args[0]
            sid = args[1]
            unarch = False
        elif len(args) == 1:
            db_path = ""
            sid = args[0]
            unarch = False
        else:
            db_path = ""
            sid = ""
            unarch = False
        archive_session(db_path, sid, archive=not unarch)
    elif action == "delete":
        args = sys.argv[2:]
        if len(args) >= 2:
            db_path = args[0]
            sid = args[1]
        elif len(args) == 1:
            db_path = ""
            sid = args[0]
        else:
            db_path = ""
            sid = ""
        delete_session(db_path, sid)
    elif action in ("clear_messages", "clear-messages", "clear"):
        args = sys.argv[2:]
        if len(args) >= 2:
            db_path = args[0]
            sid = args[1]
        elif len(args) == 1:
            db_path = ""
            sid = args[0]
        else:
            db_path = ""
            sid = ""
        clear_session_messages(db_path, sid)
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
