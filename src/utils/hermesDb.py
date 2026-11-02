import sys
import os
import sqlite3
import json
from pathlib import Path

def get_db(db_path_str=None):
    if db_path_str:
        db_path = Path(db_path_str)
    else:
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            db_path = Path(local) / "hermes" / "state.db"
        else:
            db_path = Path.home() / ".hermes" / "state.db"
    
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
                    "name": r["tool_name"] or "tool_result",
                    "result": r["content"],
                    "status": "done"
                }]

            result.append({
                "id": str(r["id"]),
                "role": r["role"],
                "content": r["content"] or "",
                "toolCalls": tc,
                "thinking": r["reasoning"] or "",
                "timestamp": r["timestamp"] or 0
            })
        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error getting messages: {e}\n")
        print(json.dumps([]))

def list_skills(hermes_home_str):
    if not hermes_home_str:
        local = os.environ.get("LOCALAPPDATA", "")
        hermes_home = Path(local) / "hermes" if local else Path.home() / ".hermes"
    else:
        hermes_home = Path(hermes_home_str)

    skills_dir = hermes_home / "skills"
    if not skills_dir.exists():
        print(json.dumps([]))
        return

    # Check curator ledger to know which skills are learned/custom
    curated_skills = set()
    ledger_file = skills_dir / ".curator_ledger.jsonl"
    if ledger_file.exists():
        try:
            with open(ledger_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            if "skill" in entry:
                                curated_skills.add(entry["skill"])
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
        # Sort so learned skills appear first, then alphabetically
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
