"""LangGraph agent nodes for the debt collection pipeline."""
import os
import io
import json
import pandas as pd
from anthropic import Anthropic

from graph.state import PipelineState
from ml.predict import predict_dataframe

ANTHROPIC_CLIENT = None


def get_client():
    global ANTHROPIC_CLIENT
    if ANTHROPIC_CLIENT is None:
        ANTHROPIC_CLIENT = Anthropic()
    return ANTHROPIC_CLIENT


# Minimum columns required — supports both old (lowercase) and new (PascalCase) formats
EXPECTED_COLUMNS_OLD = {'customerid', 'gender', 'pd_rating', 'cardstatus', 'socioeconomicindex'}
EXPECTED_COLUMNS_NEW = {'CustomerID', 'Gender', 'PD_Rating', 'CardStatus', 'SocioEconomicIndex',
                        'DebtHistory_1_Amount', 'DebtHistory_1_CollectionDays'}

# Columns that are naturally sparse — exclude from high-null warnings
SPARSE_COLUMN_PREFIXES = ('DebtHistory_4_', 'DebtHistory_5_', 'Alert_')

TOP_N_EXPLAIN = 20


# ── Node 1: DataQualityAgent ──────────────────────────────────────────────────

def data_quality_agent(state: PipelineState) -> dict:
    try:
        df = pd.read_json(io.StringIO(state['raw_df_json']), orient='records')
    except Exception as e:
        return {'error': f'Failed to parse data: {e}', 'data_quality_issues': []}

    issues = []
    cols = set(df.columns)

    # Detect format and check required columns
    if EXPECTED_COLUMNS_NEW.issubset(cols):
        pass  # new PascalCase format — all required columns present
    elif EXPECTED_COLUMNS_OLD.issubset(cols):
        pass  # old lowercase format — all required columns present
    else:
        missing_new = EXPECTED_COLUMNS_NEW - cols
        missing_old = EXPECTED_COLUMNS_OLD - cols
        missing = missing_new if len(missing_new) < len(missing_old) else missing_old
        issues.append(f"Missing expected columns: {', '.join(sorted(missing))}")

    # Null rate check — skip naturally sparse columns (DebtHistory_4/5, Alert_*)
    null_pct = df.isnull().mean() * 100
    high_null = [
        c for c, v in null_pct.items()
        if v > 50 and not any(c.startswith(p) for p in SPARSE_COLUMN_PREFIXES)
    ]
    if high_null:
        issues.append(f"High null rate (>50%) in: {', '.join(high_null)}")

    # Debt amount check (old format)
    if 'debtamount' in df.columns:
        neg = (pd.to_numeric(df['debtamount'], errors='coerce') < 0).sum()
        if neg > 0:
            issues.append(f"{neg} rows with negative debtamount")

    # Age check — both formats
    age_col = 'Age' if 'Age' in df.columns else ('age' if 'age' in df.columns else None)
    if age_col:
        invalid_age = (~df[age_col].between(0, 120, inclusive='both')).sum()
        if invalid_age > 0:
            issues.append(f"{invalid_age} rows with invalid age (outside 0–120)")

    # Duplicate customer check — both formats
    id_col = 'CustomerID' if 'CustomerID' in df.columns else ('customerid' if 'customerid' in df.columns else None)
    duplicates = int(df.duplicated(subset=[id_col]).sum()) if id_col else 0
    if duplicates > 0:
        issues.append(f"{duplicates} duplicate customer IDs detected")

    report = {
        'total_rows': len(df),
        'total_columns': len(df.columns),
        'duplicate_customers': int(duplicates),
        'columns_present': sorted(df.columns.tolist()),
        'null_percentages': {c: round(float(v), 2) for c, v in null_pct.items()},
    }

    return {
        'data_quality_report': report,
        'data_quality_issues': issues,
        'error': None,
    }


# ── Node 2: MLScoringAgent ────────────────────────────────────────────────────

def ml_scoring_agent(state: PipelineState) -> dict:
    if state.get('error'):
        return {}
    try:
        df = pd.read_json(io.StringIO(state['raw_df_json']), orient='records')
        predictions = predict_dataframe(df)
        return {'predictions': predictions, 'error': None}
    except Exception as e:
        return {'error': f'ML scoring failed: {e}', 'predictions': None}


# ── Node 3: ExplanationAgent ──────────────────────────────────────────────────

def explanation_agent(state: PipelineState) -> dict:
    if state.get('error') or not state.get('predictions'):
        return {}

    top_n = state['predictions'][:TOP_N_EXPLAIN]
    client = get_client()

    customer_summaries = []
    for c in top_n:
        customer_summaries.append(
            f"ID {c['customerid']}: age={c['age']}, gender={c['gender']}, "
            f"debt=${c['debtamount']:.0f}, debt_age={c['debtagedays']}d, "
            f"card={c['cardstatus']}, pd_rating={c['pd_rating']}, "
            f"returning={c['returningcustomer']}, backup_card={c['backupcard']}, "
            f"product={c['creditproducts']}, pay_prob={c['payment_probability']:.2%}"
        )

    prompt = (
        "You are a debt collection analyst. For each customer below, write ONE concise sentence "
        "explaining the main reason why this customer has a high probability of paying their debt. "
        "Focus on specific data points. Be direct and professional.\n\n"
        "Customers (sorted by payment probability, highest first):\n"
        + "\n".join(customer_summaries)
        + "\n\nRespond with a JSON object mapping customer ID (as string) to explanation string. "
        "Example: {\"123\": \"Active card with low utilization and short debt age suggest strong repayment capacity.\"}"
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Extract JSON from response (may be wrapped in markdown)
        if '```' in raw:
            raw = raw.split('```')[1].lstrip('json').strip()
        explanations = json.loads(raw)
    except Exception as e:
        explanations = {c['customerid']: f"High payment probability score: {c['payment_probability']:.2%}"
                        for c in top_n}

    return {'explanations': explanations, 'error': None}


# ── Node 4: ReviewAgent (human-in-the-loop pause) ────────────────────────────

def review_agent(state: PipelineState) -> dict:
    # This node just ensures status is "pending" — the actual approval
    # comes via the /review API endpoint updating state externally.
    if state.get('review_status') not in ('approved', 'rejected'):
        return {'review_status': 'pending'}
    return {}


# ── Node 5: ReportAgent ───────────────────────────────────────────────────────

def report_agent(state: PipelineState) -> dict:
    if state.get('error') or not state.get('predictions'):
        return {'final_call_list': []}

    predictions = state['predictions']
    explanations = state.get('explanations') or {}

    call_list = []
    for rank, customer in enumerate(predictions, start=1):
        cid = customer['customerid']
        entry = {**customer, 'rank': rank, 'explanation': explanations.get(cid, '')}
        call_list.append(entry)

    return {'final_call_list': call_list, 'review_status': 'approved'}


# ── Router: should we proceed after review? ────────────────────────────────────

def route_after_review(state: PipelineState) -> str:
    if state.get('review_status') == 'approved':
        return 'report'
    if state.get('review_status') == 'rejected':
        return 'end'
    return 'wait'  # still pending — graph halts here
