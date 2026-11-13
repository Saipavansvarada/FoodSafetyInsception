"""Deterministic, capacity-aware report dispatch rules."""
from __future__ import annotations

from datetime import datetime, timezone

# Six explicit PIN zones. The first digit of a six-digit PIN is the routing key.
PIN_ZONE_TABLE = {
    "1": ("Z1", "North Zone"),
    "2": ("Z1", "North Zone"),
    "3": ("Z2", "West Zone"),
    "4": ("Z2", "West Zone"),
    "5": ("Z3", "South-Central Zone"),
    "6": ("Z4", "South Zone"),
    "7": ("Z5", "East Zone"),
    "8": ("Z5", "East Zone"),
    "9": ("Z6", "Special Postal Zone"),
}

CATEGORY_PRIORITY = {
    "Critical": (0, "P0 - Emergency"),
    "Major": (1, "P1 - High"),
    "Minor": (2, "P2 - Normal"),
    "Advisory": (3, "P3 - Low"),
    "Passed": (4, "P4 - Routine"),
}


def classify_matches(matched_categories):
    """Resolve overlapping rule matches using severity-first deterministic precedence."""
    valid = [category for category in matched_categories if category in CATEGORY_PRIORITY]
    if not valid:
        return None
    return min(valid, key=lambda category: CATEGORY_PRIORITY[category][0])


def resolve_zone(pin_code: str):
    pin = (pin_code or "").strip()
    if len(pin) != 6 or not pin.isdigit():
        return None, "Unknown / malformed PIN code; sent to central correction queue."
    entry = PIN_ZONE_TABLE.get(pin[0])
    if not entry:
        return None, "PIN prefix is not mapped; sent to central correction queue."
    return {"zone_id": entry[0], "zone_name": entry[1]}, "Zone resolved from PIN prefix."


def priority_for(category: str, urgency: str):
    if (urgency or "").lower() == "emergency" or category == "Critical":
        return 0, "P0 - Emergency"
    return CATEGORY_PRIORITY.get(category, (99, "Unmapped"))


def choose_handler(conn, zone_id: str):
    """Least-loaded eligible officer; deterministic tie break by handler_id."""
    rows = conn.execute(
        """SELECT h.handler_id, h.name, h.zone_id, h.available, h.max_open_cases,
                  (SELECT COUNT(*) FROM reports r
                   WHERE r.assigned_handler = h.handler_id
                     AND r.status != 'Resolved'
                     AND r.validation_status = 'Accepted') AS open_cases
           FROM handlers h
           WHERE h.zone_id = ? AND h.pool = 'DISTRICT'
           ORDER BY open_cases ASC, h.handler_id ASC""",
        (zone_id,),
    ).fetchall()
    for row in rows:
        if row["available"] and row["open_cases"] < min(10, row["max_open_cases"]):
            return row, "Assigned to the least-loaded eligible district officer."

    deputies = conn.execute(
        """SELECT h.handler_id, h.name, h.zone_id, h.available, h.max_open_cases,
                  (SELECT COUNT(*) FROM reports r
                   WHERE r.assigned_handler = h.handler_id
                     AND r.status != 'Resolved'
                     AND r.validation_status = 'Accepted') AS open_cases
           FROM handlers h
           WHERE h.pool = 'DEPUTY'
           ORDER BY open_cases ASC, h.handler_id ASC"""
    ).fetchall()
    for row in deputies:
        if row["available"] and row["open_cases"] < min(10, row["max_open_cases"]):
            return row, "District capacity unavailable; assigned to eligible deputy pool."
    return None, "No eligible district or deputy handler; retained in the priority queue."


def dispatch_report(conn, report_id: str):
    """Dispatch one validated, unassigned report. Caller owns an IMMEDIATE transaction."""
    report = conn.execute("SELECT * FROM reports WHERE report_id = ?", (report_id,)).fetchone()
    if not report:
        return {"assigned": False, "reason": "Report not found."}
    if report["validation_status"] != "Accepted":
        return {"assigned": False, "reason": "Rejected report cannot be dispatched."}
    if report["status"] == "Resolved" or report["assigned_handler"]:
        return {"assigned": False, "reason": "Report is already assigned or resolved."}

    zone, zone_reason = resolve_zone(report["pin_code"])
    if zone is None:
        routed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute(
            "UPDATE reports SET zone_id = ?, zone_name = ?, assignment_status = ?, route_reason = ?, routed_at = ?, updated_at = ? WHERE report_id = ?",
            ("CENTRAL_QUEUE", "Central Correction Queue", "Queued", zone_reason, routed_at, routed_at, report_id),
        )
        return {"assigned": False, "queued": True, "reason": zone_reason}

    handler, handler_reason = choose_handler(conn, zone["zone_id"])
    if handler is None:
        routed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute(
            "UPDATE reports SET zone_id = ?, zone_name = ?, assignment_status = ?, route_reason = ?, routed_at = ?, updated_at = ? WHERE report_id = ?",
            (zone["zone_id"], zone["zone_name"], "Queued", handler_reason, routed_at, routed_at, report_id),
        )
        return {"assigned": False, "queued": True, "reason": handler_reason}

    priority_label = report["priority_label"]
    route_reason = f"{zone_reason} {handler_reason}"
    if report["priority_rank"] == 0:
        route_reason = "CRITICAL PRIORITY OVERRIDE: " + route_reason
    routed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        """UPDATE reports
           SET zone_id = ?, zone_name = ?, assigned_handler = ?, handler_name = ?,
               assignment_status = 'Assigned', status = 'Assigned', route_reason = ?,
               routed_at = ?, updated_at = ?
           WHERE report_id = ? AND assigned_handler IS NULL""",
        (zone["zone_id"], zone["zone_name"], handler["handler_id"], handler["name"], route_reason, routed_at, routed_at, report_id),
    )
    return {
        "assigned": True,
        "handler_id": handler["handler_id"],
        "handler_name": handler["name"],
        "zone": zone["zone_name"],
        "priority": priority_label,
        "reason": route_reason,
    }


def process_pending_queue(conn):
    """Process the whole queue in deterministic priority/time/report-id order."""
    pending = conn.execute(
        """SELECT report_id FROM reports
           WHERE validation_status = 'Accepted'
             AND assigned_handler IS NULL
             AND status != 'Resolved'
             AND assignment_status != 'Rejected'
           ORDER BY priority_rank ASC, created_at ASC, report_id ASC"""
    ).fetchall()
    results = []
    for item in pending:
        results.append({"report_id": item["report_id"], **dispatch_report(conn, item["report_id"])})
    return results
