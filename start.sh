#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Debt Collection Prioritizer ==="
echo ""

# Check for ANTHROPIC_API_KEY
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -f "$ROOT/backend/.env" ]; then
    export $(grep -v '^#' "$ROOT/backend/.env" | xargs)
  fi
fi

if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "your_api_key_here" ]; then
  echo "WARNING: ANTHROPIC_API_KEY not set. AI explanations will use fallback mode."
  echo "  Set it with: export ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
fi

# Kill existing processes on our ports
lsof -ti:8001 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Train model if not present
if [ ! -f "$ROOT/backend/models/model.pkl" ]; then
  echo "No model found. Training from scratch..."
  if [ -f "$HOME/Downloads/aws_canvas_training_ready_completed.csv" ]; then
    (cd "$ROOT/backend" && python3 ml/train.py "$HOME/Downloads/aws_canvas_training_ready_completed.csv")
  else
    echo "ERROR: Training data not found at ~/Downloads/aws_canvas_training_ready_completed.csv"
    exit 1
  fi
fi

# Start backend
echo "Starting backend on http://localhost:8001..."
(cd "$ROOT/backend" && python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload) &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend on http://localhost:5173..."
(cd "$ROOT/frontend" && npm run dev -- --port 5173) &
FRONTEND_PID=$!

echo ""
echo "App running at: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
