"""Train XGBoost model on the provided CSV and save to models/."""
import sys
import os
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from xgboost import XGBClassifier

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from ml.features import engineer_features, make_target

MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'models', 'model.pkl')


def train(csv_path: str) -> dict:
    df = pd.read_csv(csv_path)
    print(f"Loaded {len(df)} rows, {len(df.columns)} columns")

    y = make_target(df)
    X = engineer_features(df)

    print(f"Class distribution:\n{y.value_counts()}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        scale_pos_weight=(y_train == 0).sum() / (y_train == 1).sum(),
        eval_metric='logloss',
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = model.predict(X_test)
    auc = roc_auc_score(y_test, y_prob)
    report = classification_report(y_test, y_pred, output_dict=True)

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")
    print(f"AUC: {auc:.4f}")
    print(classification_report(y_test, y_pred))

    return {'auc': auc, 'report': report, 'model_path': MODEL_PATH}


if __name__ == '__main__':
    csv = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.expanduser('~/Downloads/aws_canvas_training_ready_completed.csv')
    train(csv)
