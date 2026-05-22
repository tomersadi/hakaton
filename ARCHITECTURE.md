# Architecture — Debt Collection Prioritizer

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER  (http://localhost:5173)                    │
│                                                                             │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  Upload  │───▶│  Processing │───▶│   Supervisor │───▶│   Call List   │  │
│  │  Screen  │    │   Status    │    │    Review    │    │   + Download  │  │
│  └──────────┘    └─────────────┘    └──────────────┘    └───────────────┘  │
│       │            polls /jobs          approve/reject        shows ranks   │
└───────┼────────────────────────────────────┼────────────────────────────────┘
        │ POST /upload                       │ POST /jobs/{id}/review
        ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FASTAPI  (http://localhost:8001)                     │
│                                                                             │
│   /upload → parse CSV/XLSX → start background job                          │
│   /jobs/{id} → return current job status + predictions                     │
│   /jobs/{id}/review → inject approval into LangGraph state                 │
│   /jobs/{id}/download → stream ranked CSV                                  │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │ runs in background thread
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LANGGRAPH PIPELINE                                    │
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ Node 1          │  Checks schema, null rates, duplicate IDs              │
│  │ DataQualityAgent│  → produces data_quality_report + issues list          │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐          ┌──────────────────────────────┐              │
│  │ Node 2          │─────────▶│     XGBoost model.pkl        │              │
│  │ MLScoringAgent  │◀─────────│  (trained by us on your CSV) │              │
│  └────────┬────────┘  scores  │  20 features → pay prob 0–1  │              │
│           │           ranked  │  AUC = 0.68                  │              │
│           │           list    └──────────────────────────────┘              │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐          ┌──────────────────────────────┐              │
│  │ Node 3          │─────────▶│     Anthropic Claude API     │              │
│  │ ExplanationAgent│◀─────────│  claude-sonnet-4-6           │              │
│  └────────┬────────┘  1-line  │  Input:  top 20 customer     │              │
│           │           reason  │          summaries           │              │
│           │           per     │  Output: JSON {id: reason}   │              │
│           │           customer└──────────────────────────────┘              │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Node 4          │  Graph PAUSES here — waits for human decision          │
│  │ ReviewAgent     │  Status becomes "awaiting_review"                      │
│  └────────┬────────┘  FastAPI /review endpoint injects approved=true/false  │
│           │                                                                 │
│     ┌─────┴──────┐                                                          │
│  approved?  rejected?                                                       │
│     │            └──▶ END (list discarded)                                  │
│     ▼                                                                       │
│  ┌─────────────────┐                                                        │
│  │ Node 5          │  Merges scores + explanations → final ranked list      │
│  │ ReportAgent     │  Status becomes "completed"                            │
│  └─────────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Interactions

| Component | Role |
|---|---|
| **XGBoost model.pkl** | Ranks ALL customers by payment probability (pure math, no LLM) |
| **Claude (claude-sonnet-4-6)** | Explains WHY the top 20 are ranked high (natural language) |
| **LangGraph** | Orchestrates all 5 steps, handles pause/resume for human review |
| **FastAPI** | Bridge between the browser and the LangGraph pipeline |
| **React frontend** | 4-screen UI: upload → processing → review → call list |

> The LLM does **not** make predictions — the XGBoost model does.
> Claude only reads the model's output and translates it into plain English
> so supervisors understand why a customer is ranked #1 vs #50.

## Scoring Logic (Transparent & Explainable)

Instead of a black-box ML model, the system uses a **business rules scorecard** — the standard approach in real-world credit scoring systems. Every point awarded or deducted has a clear business reason, making it auditable and explainable to supervisors.

### How a customer's payment probability is calculated

```
Final score (raw points) → normalized to 0.05–0.95 range = payment_probability
```

#### Positive signals (points added)

| Factor | Condition | Points |
|---|---|---|
| **PD Rating** | High | +30 |
| | Medium | +18 |
| | Low | +5 |
| **Card Status** | Active | +25 |
| | Expired | +10 |
| | Blocked | +0 |
| **Returning Customer** | Yes | +12 |
| **Backup Card** | Yes | +6 |
| **Standing Order** | Yes | +6 |
| **Is Bank Card** | Yes | +4 |
| **Socioeconomic Index** | 1–10 scale | +1.5 per point (up to +15) |
| **Avg historical collection days** | < 45 days | +20 |
| | < 75 days | +14 |
| | < 105 days | +8 |
| | < 150 days | +3 |

#### Negative signals (points deducted)

| Factor | Condition | Points |
|---|---|---|
| **Historical return reason** | InsufficientFunds | −8 per occurrence |
| | TechnicalError | −3 per occurrence |
| | CardExpired | −2 per occurrence |
| **Alert codes** | Each unresolved alert | −2 per alert |

#### Example calculation

```
Customer A: PD=High (+30), Card=Active (+25), Returning=Yes (+12),
            SEI=8 (+12), avg_days=40 (+20), 1x TechnicalError (−3)
            ──────────────────────────────────────────────────────
            Raw score = 96 pts  →  normalized  →  payment_probability ≈ 88%

Customer B: PD=Low (+5), Card=Blocked (+0), Returning=No (+0),
            SEI=2 (+3), avg_days=180 (+0), 2x InsufficientFunds (−16)
            ──────────────────────────────────────────────────────────
            Raw score = −8 pts  →  normalized  →  payment_probability ≈ 12%
```

> Scores are normalized across the full uploaded batch so the range is always 5%–95%.
> This means rankings are **relative** within each uploaded file.

## ML Model Details

- **Scoring approach:** Business rules scorecard (`backend/ml/predict.py`)
- **Supported file formats:** Old format (lowercase columns) and new format (PascalCase columns)
- **Optional columns** (`BackupCard`, `StandingOrder`, `ReturningCustomer`): default to 0 if absent
- **Sparse columns ignored in quality check:** `DebtHistory_4/5_*`, `Alert_*` (legitimately sparse)

## Project File Structure

```
hakatonTomer/
├── start.sh                          ← single command to start everything
├── ARCHITECTURE.md                   ← this file
├── backend/
│   ├── main.py                       ← FastAPI endpoints
│   ├── .env                          ← ANTHROPIC_API_KEY
│   ├── ml/
│   │   ├── features.py               ← 20 engineered features
│   │   ├── train.py                  ← XGBoost training script
│   │   └── predict.py                ← inference + sorted output
│   ├── graph/
│   │   ├── state.py                  ← LangGraph state schema
│   │   ├── agents.py                 ← 5 agent node functions
│   │   └── pipeline.py               ← graph assembly
│   └── models/
│       └── model.pkl                 ← trained XGBoost model
└── frontend/
    └── src/
        ├── App.tsx                   ← 4-screen UI
        ├── App.css                   ← styles
        └── api.ts                    ← typed API client
```

## How to Run

```bash
# Set your Anthropic API key (for AI explanations)
export ANTHROPIC_API_KEY=sk-ant-...

# Start both servers with one command
cd /Users/tomersadi/Projects/hakatonTomer
./start.sh
```

Then open **http://localhost:5173** in your browser.
