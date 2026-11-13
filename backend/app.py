from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

from validators import validate_inspector_id, validate_violation_code
from routing import CATEGORY_PRIORITY, PIN_ZONE_TABLE, classify_matches, dispatch_report, process_pending_queue, priority_for, resolve_zone

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("FOOD_SAFETY_DB", BASE_DIR / "food_safety.db"))

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

# Violation-code catalog: the exact code maps to one of the five required report categories.
VIOLATION_CATALOG = {
    "V01-CONTAMINATION": {"domain": "Contamination", "category": "Critical", "description": "Confirmed or suspected food contamination"},
    "V02-TEMPERATURE": {"domain": "Temperature control", "category": "Critical", "description": "Unsafe food holding or cooking temperature"},
    "V03-HYGIENE": {"domain": "Food-handler hygiene", "category": "Major", "description": "Serious hygiene or sanitation breach"},
    "V04-STORAGE": {"domain": "Storage", "category": "Major", "description": "Unsafe storage or cross-contamination risk"},
    "V05-PEST": {"domain": "Pest control", "category": "Major", "description": "Pest infestation or ineffective pest control"},
    "V06-LABEL": {"domain": "Labelling", "category": "Minor", "description": "Incorrect or incomplete product labelling"},
    "V07-EQUIPMENT": {"domain": "Equipment", "category": "Minor", "description": "Equipment maintenance or calibration issue"},
    "V08-CLEANLINESS": {"domain": "Cleanliness", "category": "Advisory", "description": "Advisory cleanliness observation"},
    "V09-ADVISORY": {"domain": "General advisory", "category": "Advisory", "description": "Non-critical advisory observation"},
    "V10-PASSED": {"domain": "Compliant inspection", "category": "Passed", "description": "No reportable food-safety violation found"},
}

STATUSES = {"Pending", "Assigned", "In Progress", "Resolved"}


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS handlers (
            handler_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            zone_id TEXT NOT NULL,
            zone_name TEXT NOT NULL,
            pool TEXT NOT NULL DEFAULT 'DISTRICT',
            available INTEGER NOT NULL DEFAULT 1,
            max_open_cases INTEGER NOT NULL DEFAULT 10 CHECK(max_open_cases BETWEEN 1 AND 10)
        );
        CREATE TABLE IF NOT EXISTS reports (
            report_id TEXT PRIMARY KEY,
            inspector_id TEXT NOT NULL,
            violation_code TEXT NOT NULL,
            domain TEXT,
            establishment TEXT NOT NULL,
            inspector_name TEXT NOT NULL,
            pin_code TEXT NOT NULL,
            description TEXT NOT NULL,
            urgency TEXT NOT NULL DEFAULT 'Normal',
            category TEXT NOT NULL DEFAULT 'Unclassified',
            priority_rank INTEGER NOT NULL DEFAULT 99,
            priority_label TEXT NOT NULL DEFAULT 'Not routed',
            validation_status TEXT NOT NULL,
            validation_reason TEXT NOT NULL,
            validation_details TEXT NOT NULL,
            zone_id TEXT,
            zone_name TEXT,
            assigned_handler TEXT,
            handler_name TEXT,
            assignment_status TEXT NOT NULL DEFAULT 'Not dispatched',
            route_reason TEXT,
            routed_at TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(assigned_handler) REFERENCES handlers(handler_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority_rank, created_at, report_id);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
        """
    )
    count = conn.execute("SELECT COUNT(*) FROM handlers").fetchone()[0]
    if count == 0:
        seeds = []
        zones = [
            ("Z1", "North Zone"), ("Z2", "West Zone"), ("Z3", "South-Central Zone"),
            ("Z4", "South Zone"), ("Z5", "East Zone"), ("Z6", "Special Postal Zone"),
        ]
        names = ["Aarav Sharma", "Diya Mehta", "Kabir Rao", "Ananya Iyer", "Ishaan Verma", "Meera Nair",
                 "Rohan Das", "Sana Khan", "Vihaan Patel", "Tara Menon", "Arjun Roy", "Nisha Kapoor"]
        idx = 0
        for zone_id, zone_name in zones:
            for suffix in ("A", "B"):
                seeds.append((f"OFF-{zone_id}-{suffix}", names[idx], zone_id, zone_name, "DISTRICT", 1, 10))
                idx += 1
        seeds.extend([
            ("DEP-01", "Deputy Response Alpha", "DEPUTY", "Deputy Officer Pool", "DEPUTY", 1, 10),
            ("DEP-02", "Deputy Response Beta", "DEPUTY", "Deputy Officer Pool", "DEPUTY", 1, 10),
        ])
        conn.executemany(
            "INSERT INTO handlers(handler_id,name,zone_id,zone_name,pool,available,max_open_cases) VALUES(?,?,?,?,?,?,?)",
            seeds,
        )
    conn.commit()
    conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def report_to_dict(row):
    item = dict(row)
    item["validation_details"] = json.loads(item.get("validation_details") or "{}")
    item["is_emergency"] = item.get("urgency", "Normal").lower() == "emergency"
    return item


def handler_to_dict(row):
    return dict(row)


def make_report_id(conn):
    day = datetime.now().strftime("%Y%m%d")
    prefix = f"FS-{day}-"
    count = conn.execute("SELECT COUNT(*) FROM reports WHERE report_id LIKE ?", (prefix + "%",)).fetchone()[0]
    return f"{prefix}{count + 1:04d}"


def validate_payload(data):
    required = ["inspector_id", "violation_code", "establishment", "inspector_name", "pin_code", "description"]
    missing = [field for field in required if not str(data.get(field, "")).strip()]
    inspector = validate_inspector_id(str(data.get("inspector_id", "")))
    violation = validate_violation_code(str(data.get("violation_code", "")))
    code_info = VIOLATION_CATALOG.get(str(data.get("violation_code", "")).strip())
    errors = []
    if missing:
        errors.append("Missing required fields: " + ", ".join(missing))
    if not inspector.accepted:
        errors.append(inspector.reason)
    if not violation.accepted:
        errors.append(violation.reason)
    elif code_info is None:
        errors.append("Violation code is well-formed but is not present in the supported code catalogue.")
    if len(str(data.get("pin_code", "")).strip()) != 6 or not str(data.get("pin_code", "")).strip().isdigit():
        errors.append("PIN code must contain exactly 6 digits; report will not be assigned to a district zone.")
    urgency = str(data.get("urgency", "Normal")).title()
    if urgency not in {"Normal", "Emergency"}:
        errors.append("Urgency must be Normal or Emergency.")
    details = {
        "inspector_id": inspector.as_dict(),
        "violation_code": violation.as_dict(),
        "catalog_match": code_info is not None,
        "catalog_domain": code_info["domain"] if code_info else None,
    }
    # A malformed PIN is retained for correction/fallback; it does not invalidate the two DFA identifiers.
    blocking_errors = [e for e in errors if not e.startswith("PIN code must")]
    return {
        "accepted": not blocking_errors,
        "errors": errors,
        "details": details,
        "code_info": code_info,
        "urgency": urgency,
    }


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
    return response


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "Food Safety Inspection Portal"})


@app.get("/api/catalog")
def catalog():
    return jsonify({
        "violation_codes": VIOLATION_CATALOG,
        "categories": list(CATEGORY_PRIORITY.keys()),
        "pin_zones": {k: {"zone_id": v[0], "zone_name": v[1]} for k, v in PIN_ZONE_TABLE.items()},
        "rules": {
            "district_capacity": 10,
            "selection": "Least-loaded available officer; handler_id breaks ties.",
            "fallback": "Deputy pool, then priority queue. Unknown PIN routes to Central Correction Queue.",
            "priority": "Critical or Emergency = P0; Major=P1; Minor=P2; Advisory=P3; Passed=P4.",
            "queue_order": "priority rank, creation timestamp, report ID.",
            "classification_precedence": "Critical > Major > Minor > Advisory > Passed; if multiple rule patterns match, the highest-severity match wins.",
        },
    })


@app.post("/api/validate")
def validate_endpoint():
    data = request.get_json(silent=True) or {}
    result = validate_payload(data)
    return jsonify({
        "accepted": result["accepted"],
        "errors": result["errors"],
        "details": result["details"],
        "category": result["code_info"]["category"] if result["code_info"] else None,
        "domain": result["code_info"]["domain"] if result["code_info"] else None,
        "priority": priority_for(result["code_info"]["category"], result["urgency"])[1] if result["accepted"] else None,
    })


@app.post("/api/reports")
def create_report():
    data = request.get_json(silent=True) or {}
    result = validate_payload(data)
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        report_id = make_report_id(conn)
        info = result["code_info"]
        category = classify_matches([info["category"]]) if result["accepted"] and info else "Unclassified"
        rank, priority_label = priority_for(category, result["urgency"]) if result["accepted"] else (99, "Not routed")
        created = now_iso()
        validation_status = "Accepted" if result["accepted"] else "Rejected"
        reason = "Validation successful. DFA and regex agree." if result["accepted"] else " ".join(result["errors"])
        conn.execute(
            """INSERT INTO reports(
                report_id, inspector_id, violation_code, domain, establishment, inspector_name,
                pin_code, description, urgency, category, priority_rank, priority_label,
                validation_status, validation_reason, validation_details, assignment_status,
                status, created_at, updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                report_id, str(data.get("inspector_id", "")).strip(), str(data.get("violation_code", "")).strip(),
                info["domain"] if info else None, str(data.get("establishment", "")).strip(),
                str(data.get("inspector_name", "")).strip(), str(data.get("pin_code", "")).strip(),
                str(data.get("description", "")).strip(), result["urgency"], category, rank, priority_label,
                validation_status, reason, json.dumps(result["details"]),
                "Not dispatched" if not result["accepted"] else "Queued", "Pending", created, created,
            ),
        )
        dispatch = {"assigned": False, "reason": "Rejected report cannot be dispatched."}
        if result["accepted"]:
            queue_results = process_pending_queue(conn)
            dispatch = next((item for item in queue_results if item["report_id"] == report_id), dispatch)
        row = conn.execute("SELECT * FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return jsonify({
        "report": report_to_dict(row),
        "validation": {"accepted": result["accepted"], "errors": result["errors"], "details": result["details"]},
        "dispatch": dispatch,
    }), 201


@app.get("/api/reports")
def list_reports():
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    category = request.args.get("category", "").strip()
    conn = get_db()
    query = "SELECT * FROM reports WHERE 1=1"
    params = []
    if search:
        like = f"%{search}%"
        query += " AND (report_id LIKE ? OR inspector_id LIKE ? OR establishment LIKE ? OR handler_name LIKE ?)"
        params.extend([like, like, like, like])
    if status:
        query += " AND status = ?"
        params.append(status)
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " ORDER BY priority_rank ASC, created_at DESC, report_id DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([report_to_dict(row) for row in rows])


@app.get("/api/reports/<report_id>")
def get_report(report_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM reports WHERE report_id = ?", (report_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Report not found."}), 404
    return jsonify(report_to_dict(row))


@app.patch("/api/reports/<report_id>/status")
def update_status(report_id):
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")
    if new_status not in STATUSES:
        return jsonify({"error": "Status must be Pending, Assigned, In Progress, or Resolved."}), 400
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        if not row:
            conn.rollback()
            return jsonify({"error": "Report not found."}), 404
        if row["validation_status"] != "Accepted":
            conn.rollback()
            return jsonify({"error": "Rejected reports cannot be progressed."}), 409
        if new_status in {"Assigned", "In Progress"} and not row["assigned_handler"]:
            conn.rollback()
            return jsonify({"error": "This report has no handler yet. Run dispatch or wait for an eligible handler."}), 409
        handler = data.get("handler_id")
        if handler and row["assigned_handler"] != handler:
            conn.rollback()
            return jsonify({"error": "Handler does not match the report's current assignment."}), 409
        conn.execute("UPDATE reports SET status = ?, updated_at = ? WHERE report_id = ?", (new_status, now_iso(), report_id))
        queue_results = []
        if new_status == "Resolved":
            queue_results = process_pending_queue(conn)
        updated = conn.execute("SELECT * FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return jsonify({"report": report_to_dict(updated), "queue_processed": queue_results})


@app.get("/api/handlers")
def list_handlers():
    conn = get_db()
    rows = conn.execute(
        """SELECT h.*,
          (SELECT COUNT(*) FROM reports r WHERE r.assigned_handler=h.handler_id AND r.status!='Resolved' AND r.validation_status='Accepted') AS open_cases,
          (SELECT COUNT(*) FROM reports r WHERE r.assigned_handler=h.handler_id AND r.status='Resolved') AS resolved_cases
          FROM handlers h ORDER BY CASE h.pool WHEN 'DISTRICT' THEN 0 ELSE 1 END, h.zone_id, h.handler_id"""
    ).fetchall()
    conn.close()
    return jsonify([handler_to_dict(row) for row in rows])


@app.patch("/api/handlers/<handler_id>")
def update_handler(handler_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM handlers WHERE handler_id = ?", (handler_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Handler not found."}), 404
    available = data.get("available", bool(row["available"]))
    capacity = data.get("max_open_cases", row["max_open_cases"])
    try:
        capacity = int(capacity)
    except (TypeError, ValueError):
        conn.close()
        return jsonify({"error": "Capacity must be a whole number between 1 and 10."}), 400
    if capacity < 1 or capacity > 10:
        conn.close()
        return jsonify({"error": "Capacity cannot exceed 10 open cases."}), 400
    conn.execute("UPDATE handlers SET available = ?, max_open_cases = ? WHERE handler_id = ?",
                 (1 if available else 0, capacity, handler_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "Handler settings updated."})


@app.get("/api/routing/table")
def routing_table():
    conn = get_db()
    handlers = conn.execute(
        """SELECT h.*,
          (SELECT COUNT(*) FROM reports r WHERE r.assigned_handler=h.handler_id AND r.status!='Resolved' AND r.validation_status='Accepted') AS open_cases
          FROM handlers h ORDER BY h.zone_id, h.handler_id"""
    ).fetchall()
    conn.close()
    zones = []
    for digit, (zone_id, zone_name) in PIN_ZONE_TABLE.items():
        existing = next((z for z in zones if z["zone_id"] == zone_id), None)
        if not existing:
            existing = {"zone_id": zone_id, "zone_name": zone_name, "pin_prefixes": [], "handlers": []}
            zones.append(existing)
        existing["pin_prefixes"].append(digit)
    for handler in handlers:
        for zone in zones:
            if handler["zone_id"] == zone["zone_id"]:
                zone["handlers"].append(handler_to_dict(handler))
    return jsonify(zones)


@app.post("/api/dispatch/run")
def run_dispatch():
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        results = process_pending_queue(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return jsonify({"processed": len(results), "results": results})


@app.get("/api/dashboard")
def dashboard():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]
    valid = conn.execute("SELECT COUNT(*) FROM reports WHERE validation_status='Accepted'").fetchone()[0]
    rejected = conn.execute("SELECT COUNT(*) FROM reports WHERE validation_status='Rejected'").fetchone()[0]
    counts = {row["status"]: row["n"] for row in conn.execute("SELECT status, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY status")}
    category_rows = conn.execute("SELECT category, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY category").fetchall()
    zone_rows = conn.execute("SELECT COALESCE(zone_name,'Unrouted') zone_name, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY zone_name ORDER BY n DESC").fetchall()
    priority_rows = conn.execute("SELECT priority_label, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY priority_label ORDER BY MIN(priority_rank)").fetchall()
    recent = conn.execute("SELECT * FROM reports ORDER BY created_at DESC LIMIT 7").fetchall()
    handlers = conn.execute("SELECT COUNT(*) FROM handlers WHERE available=1").fetchone()[0]
    open_assigned = conn.execute("SELECT COUNT(*) FROM reports WHERE assigned_handler IS NOT NULL AND status!='Resolved'").fetchone()[0]
    queued = conn.execute("SELECT COUNT(*) FROM reports WHERE validation_status='Accepted' AND assigned_handler IS NULL").fetchone()[0]
    conn.close()
    return jsonify({
        "total": total, "valid": valid, "rejected": rejected,
        "pending": counts.get("Pending", 0), "assigned": counts.get("Assigned", 0),
        "in_progress": counts.get("In Progress", 0), "resolved": counts.get("Resolved", 0),
        "categories": [dict(r) for r in category_rows], "zones": [dict(r) for r in zone_rows],
        "priorities": [dict(r) for r in priority_rows], "recent": [report_to_dict(r) for r in recent],
        "available_handlers": handlers, "open_assigned": open_assigned, "queued": queued,
    })


@app.get("/api/analytics")
def analytics():
    conn = get_db()
    categories = conn.execute("SELECT category, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY category").fetchall()
    zones = conn.execute("SELECT COALESCE(zone_name,'Unrouted') zone_name, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY zone_name ORDER BY n DESC").fetchall()
    statuses = conn.execute("SELECT status, COUNT(*) n FROM reports WHERE validation_status='Accepted' GROUP BY status").fetchall()
    daily = conn.execute("SELECT substr(created_at,1,10) day, COUNT(*) n FROM reports GROUP BY day ORDER BY day DESC LIMIT 7").fetchall()
    top_handlers = conn.execute(
        """SELECT h.handler_id, h.name, h.zone_name,
          (SELECT COUNT(*) FROM reports r WHERE r.assigned_handler=h.handler_id AND r.status!='Resolved') open_cases,
          (SELECT COUNT(*) FROM reports r WHERE r.assigned_handler=h.handler_id AND r.status='Resolved') resolved_cases
          FROM handlers h ORDER BY open_cases DESC, resolved_cases DESC LIMIT 8"""
    ).fetchall()
    conn.close()
    return jsonify({"categories": [dict(r) for r in categories], "zones": [dict(r) for r in zones],
                    "statuses": [dict(r) for r in statuses], "daily": [dict(r) for r in daily],
                    "handlers": [dict(r) for r in top_handlers]})


@app.get("/")
def root():
    return jsonify({"service": "Food Safety Inspection Portal API", "docs": "/api/health"})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
