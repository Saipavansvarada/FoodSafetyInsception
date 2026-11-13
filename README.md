# Food Safety Inspection Portal

A responsive food-inspection operations portal with DFA + regex validation, five-level risk classification, six-zone PIN routing, handler capacity controls, priority dispatch, case tracking and analytics.

## Technology choice and assignment note

The assignment pages contain two different stack instructions: the Part C heading / final note mention **MERN**, while Part C item 10 explicitly asks for a **React frontend + Flask backend + SQLite database**. This deliverable follows the item 10 integration requirement and keeps the DFA implementation in Python:

- **Frontend:** React + Vite (responsive single-page application)
- **Backend:** Python Flask REST API
- **Database:** SQLite
- **Automata:** explicit Python DFA simulations, checked against Python regular expressions

This is a React–Flask–SQLite hybrid, not a full MERN stack. Confirm with your faculty which of the conflicting stack instructions they will grade against before the final submission.

## Features implemented

- Inspector ID DFA and regex: `INS` + exactly 2 uppercase letters + exactly 4 digits. Example: `INSAB1234`.
- Violation code DFA and regex: `V` + exactly 2 digits + `-` + uppercase category token. Example: `V03-HYGIENE`.
- DFA and regex results are both returned, including an explicit agreement flag.
- Supported violation catalogue maps each accepted code to exactly one of **Critical / Major / Minor / Advisory / Passed**. A syntactically valid but unmapped code is rejected and stored as `Unclassified`.
- Overlapping classification matches use deterministic severity precedence: **Critical > Major > Minor > Advisory > Passed**.
- Six PIN routing zones, derived from the first digit of the six-digit PIN:

  | PIN first digit | Zone |
  | --- | --- |
  | 1, 2 | Z1 — North |
  | 3, 4 | Z2 — West |
  | 5 | Z3 — South-Central |
  | 6 | Z4 — South |
  | 7, 8 | Z5 — East |
  | 9 | Z6 — Special Postal |

  Prefix `0`, malformed PINs or unknown keys go to the **Central Correction Queue**. The mapping is a project rule for this prototype; adjust it if your hackathon problem statement supplies an official district/PIN mapping.
- Least-loaded available district handler is selected first; ties are broken by `handler_id`.
- An officer is never assigned more than 10 open cases. When a zone's officers are unavailable/full, the deputy pool is tried; otherwise the report remains queued.
- Critical reports and reports marked Emergency receive the P0 priority override.
- Queue processing order is priority rank, submission timestamp, then report ID. SQLite `BEGIN IMMEDIATE` transactions and an assignment guard prevent duplicate assignments during concurrent submissions/dispatch cycles.
- Status workflow: Pending → Assigned → In Progress → Resolved.
- Persistent validation decisions, classification, priority, zone, handler, route reason, route timestamp and status timestamps.
- Interactive dashboards: overview, report submission, report registry/search, handler workspace, routing management and analytics.
- 27 documented backend regression tests.

## Run the project

### 1. Start the Flask backend

Open a terminal in `food-safety-inspection/backend`:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

macOS / Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The API runs at `http://localhost:5000`. The SQLite database (`food_safety.db`) is created automatically and seeded with two district officers in each of six zones and two deputy officers.

### 2. Start the React frontend

Open a second terminal in `food-safety-inspection/frontend`:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

The frontend uses `http://localhost:5000/api` by default. To change it, create `frontend/.env`:

```env
VITE_API_URL=http://localhost:5000/api
```

### 3. Run tests

From the `backend` directory, after installing the requirements:

```bash
python -m unittest discover -s tests -v
```

## Example inputs

| Field | Example | Meaning |
| --- | --- | --- |
| Inspector ID | `INSAB1234` | Valid inspector ID |
| Violation code | `V01-CONTAMINATION` | Critical risk |
| Violation code | `V03-HYGIENE` | Major risk |
| Violation code | `V06-LABEL` | Minor risk |
| Violation code | `V08-CLEANLINESS` | Advisory observation |
| Violation code | `V10-PASSED` | Passed inspection |
| PIN code | `560001` | Z3 — South-Central Zone |

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Backend health |
| GET | `/api/catalog` | Supported codes, categories and routing rules |
| POST | `/api/validate` | Immediate DFA + regex validation preview |
| POST | `/api/reports` | Persist, classify and dispatch a report |
| GET | `/api/reports` | Search/list reports (optional `search`, `status`, `category`) |
| GET | `/api/reports/<report_id>` | Get a single report |
| PATCH | `/api/reports/<report_id>/status` | Update case status |
| GET | `/api/dashboard` | Overview cards and recent activity |
| GET | `/api/analytics` | Category, zone, status and handler statistics |
| GET | `/api/handlers` | Handler loads and availability |
| PATCH | `/api/handlers/<handler_id>` | Update availability / max open cases (1–10) |
| GET | `/api/routing/table` | Explicit PIN-zone routing table |
| POST | `/api/dispatch/run` | Process the priority-ordered waiting queue |

## Notes for your hackathon demo

1. Submit `INSAB1234` + `V01-CONTAMINATION` + PIN `560001`; show the Critical badge, P0 override and South-Central-zone handler assignment.
2. Submit a malformed inspector ID such as `INS123`; it is stored as Rejected, and the UI displays the DFA/regex reason. It is never dispatched.
3. Submit a valid-looking but unsupported code such as `V88-UNKNOWN`; it is rejected rather than silently mapped to a category.
4. Set both Z4 officers unavailable in Routing Management, then submit another Z4 report; the deputy pool should receive it.
5. Set all district and deputy handlers unavailable, submit reports, and show the waiting queue. Re-enable an officer and click **Run dispatch cycle**.
6. Update a case from Assigned → In Progress → Resolved in Handler Workspace; verify the dashboard and analytics refresh.

This is a hackathon prototype. Before production use, add authentication/role-based authorization, audit-log immutability, stronger input limits, deployment configuration and official jurisdiction data.
