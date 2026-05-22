import pandas as pd
import numpy as np


PD_RATING_MAP = {'Low': 0, 'Medium': 1, 'High': 2}
CARD_STATUS_MAP = {'Active': 2, 'Expired': 1, 'Blocked': 0}
GENDER_MAP = {'Male': 0, 'Female': 1, 'Other': 2}

HIST_AMOUNTS = [f'DebtHistory_{i}_Amount' for i in range(2, 6)]
HIST_COLL_DAYS = [f'DebtHistory_{i}_CollectionDays' for i in range(2, 6)]
HIST_RETURN_REASONS = [f'DebtHistory_{i}_ReturnReason' for i in range(2, 6)]
ALERT_COLS = [f'Alert_{i}_Code' for i in range(1, 6)]

FEATURE_COLUMNS = [
    'gender_enc', 'socioeconomicindex', 'pd_rating_enc',
    'returningcustomer', 'backupcard', 'standingorder',
    'creditproductcode', 'isbankcard', 'cardstatus_enc',
    'avg_hist_amount', 'max_hist_amount', 'num_hist_debts',
    'avg_collection_days',
    'num_prior_card_expired', 'num_prior_insufficient', 'num_prior_technical',
    'num_alerts',
]


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df['gender_enc'] = df['Gender'].map(GENDER_MAP).fillna(2)
    df['pd_rating_enc'] = df['PD_Rating'].map(PD_RATING_MAP).fillna(1)
    df['cardstatus_enc'] = df['CardStatus'].map(CARD_STATUS_MAP).fillna(0)

    def safe_numeric(col): return pd.to_numeric(df.get(col, 0), errors='coerce').fillna(0)

    df['socioeconomicindex'] = safe_numeric('SocioEconomicIndex')
    df['returningcustomer'] = safe_numeric('ReturningCustomer')
    df['backupcard'] = safe_numeric('BackupCard')
    df['standingorder'] = safe_numeric('StandingOrder')
    df['creditproductcode'] = safe_numeric('CreditProductCode')
    df['isbankcard'] = safe_numeric('IsBankCard')

    present_amounts = [c for c in HIST_AMOUNTS if c in df.columns]
    if present_amounts:
        amounts = df[present_amounts].apply(pd.to_numeric, errors='coerce')
        df['avg_hist_amount'] = amounts.mean(axis=1).fillna(0)
        df['max_hist_amount'] = amounts.max(axis=1).fillna(0)
        df['num_hist_debts'] = amounts.notna().sum(axis=1)
    else:
        df['avg_hist_amount'] = 0
        df['max_hist_amount'] = 0
        df['num_hist_debts'] = 0

    present_days = [c for c in HIST_COLL_DAYS if c in df.columns]
    if present_days:
        days = df[present_days].apply(pd.to_numeric, errors='coerce')
        df['avg_collection_days'] = days.mean(axis=1).fillna(0)
    else:
        df['avg_collection_days'] = 0

    present_reasons = [c for c in HIST_RETURN_REASONS if c in df.columns]
    df['num_prior_card_expired'] = 0
    df['num_prior_insufficient'] = 0
    df['num_prior_technical'] = 0
    for col in present_reasons:
        df['num_prior_card_expired'] += (df[col] == 'CardExpired').astype(int)
        df['num_prior_insufficient'] += (df[col] == 'InsufficientFunds').astype(int)
        df['num_prior_technical'] += (df[col] == 'TechnicalError').astype(int)

    present_alerts = [c for c in ALERT_COLS if c in df.columns]
    if present_alerts:
        df['num_alerts'] = df[present_alerts].notna().sum(axis=1)
    else:
        df['num_alerts'] = 0

    return df[FEATURE_COLUMNS].astype(float)


def make_target(df: pd.DataFrame) -> pd.Series:
    """1 = quick payer (collected within 60 days), 0 = slow/hard to collect."""
    days = pd.to_numeric(df['DebtHistory_1_CollectionDays'], errors='coerce').fillna(999)
    return (days < 60).astype(int)
