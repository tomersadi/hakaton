"""
Payment probability scoring using a business rules scorecard.
Used instead of a statistical ML model because the available dataset
is synthetic and has no real correlation between features and payment speed.
A scorecard is standard practice in real-world debt collection systems.
"""
import pandas as pd
import numpy as np

PD_RATING_SCORE = {'High': 30, 'Medium': 18, 'Low': 5}
CARD_STATUS_SCORE = {'Active': 25, 'Expired': 10, 'Blocked': 0}


def _score_row(row: pd.Series) -> float:
    score = 0.0

    # Credit worthiness signals
    score += PD_RATING_SCORE.get(str(row.get('PD_Rating', '')), 10)
    score += CARD_STATUS_SCORE.get(str(row.get('CardStatus', '')), 0)

    # Customer behaviour signals
    if int(row.get('ReturningCustomer', 0) or 0):
        score += 12
    if int(row.get('BackupCard', 0) or 0):
        score += 6
    if int(row.get('StandingOrder', 0) or 0):
        score += 6
    if int(row.get('IsBankCard', 0) or 0):
        score += 4

    # Socioeconomic index (1–10 scale)
    sei = float(row.get('SocioEconomicIndex', 5) or 5)
    score += sei * 1.5  # up to 15 pts

    # Historical collection speed (lower days = easier to collect)
    hist_days = []
    for i in range(2, 6):
        val = row.get(f'DebtHistory_{i}_CollectionDays')
        if val is not None and str(val) not in ('', 'nan', 'NaN'):
            try:
                hist_days.append(float(val))
            except (ValueError, TypeError):
                pass
    if hist_days:
        avg_days = np.mean(hist_days)
        if avg_days < 45:
            score += 20
        elif avg_days < 75:
            score += 14
        elif avg_days < 105:
            score += 8
        elif avg_days < 150:
            score += 3

    # Penalty: rejection patterns in history
    for i in range(2, 6):
        reason = str(row.get(f'DebtHistory_{i}_ReturnReason', '') or '')
        if reason == 'InsufficientFunds':
            score -= 8
        elif reason == 'TechnicalError':
            score -= 3
        elif reason == 'CardExpired':
            score -= 2

    # Penalty: unresolved alerts
    alert_count = sum(
        1 for i in range(1, 6)
        if row.get(f'Alert_{i}_Code') is not None
        and str(row.get(f'Alert_{i}_Code', '')) not in ('', 'nan', 'NaN')
    )
    score -= alert_count * 2

    return score


def predict_dataframe(df: pd.DataFrame) -> list[dict]:
    scores = df.apply(_score_row, axis=1)

    # Normalize scores to 0.05–0.95 range
    s_min, s_max = scores.min(), scores.max()
    if s_max > s_min:
        probs = 0.05 + 0.90 * (scores - s_min) / (s_max - s_min)
    else:
        probs = pd.Series([0.5] * len(df), index=df.index)

    results = []
    for i, (_, row) in enumerate(df.iterrows()):
        results.append({
            'customerid': str(row.get('CustomerID', i)),
            'payment_probability': float(round(probs.iloc[i], 4)),
            'gender': str(row.get('Gender', '')),
            'cardstatus': str(row.get('CardStatus', '')),
            'pd_rating': str(row.get('PD_Rating', '')),
            'creditproducts': str(row.get('CreditProducts', '')),
            'returningcustomer': bool(int(row.get('ReturningCustomer', 0) or 0)),
            'backupcard': bool(int(row.get('BackupCard', 0) or 0)),
            'collectiondays': float(row.get('DebtHistory_1_CollectionDays', 0) or 0),
            'zip': str(row.get('ZIP', '')),
            'socioeconomicindex': int(row.get('SocioEconomicIndex', 0) or 0),
            'isbankcard': bool(int(row.get('IsBankCard', 0) or 0)),
            'age': 0,
            'debtamount': 0,
            'debtagedays': 0,
        })

    results.sort(key=lambda x: x['payment_probability'], reverse=True)
    return results
