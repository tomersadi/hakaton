"""FastAPI backend for the debt collection ML pipeline."""
import io
import os
import uuid
import json
import tempfile
import asyncio
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from graph.pipeline import GRAPH
from ml.train import train as run_xgboost_training

app = FastAPI(title="Debt Collection Prioritizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# In-memory job store (use Redis/DB in production)
JOBS: dict[str, dict] = {}
TRAIN_JOBS: dict[str, dict] = {}


class ReviewDecision(BaseModel):
    approved: bool


def run_pipeline(job_id: str, df_json: str):
    """Run the LangGraph pipeline synchronously in a thread."""
    config = {"configurable": {"thread_id": job_id}}
    initial_state = {
        "file_path": "",
        "raw_df_json": df_json,
        "data_quality_report": None,
        "data_quality_issues": [],
        "predictions": None,
        "explanations": None,
        "review_status": "pending",
        "final_call_list": None,
        "error": None,
        "job_id": job_id,
    }

    try:
        JOBS[job_id]["status"] = "running"
        JOBS[job_id]["step"] = "data_quality"

        # Run graph up to the review node (it will pause there)
        for chunk in GRAPH.stream(initial_state, config=config):
            node_name = list(chunk.keys())[0]
            JOBS[job_id]["step"] = node_name
            JOBS[job_id]["state"] = chunk[node_name]

        # After streaming, get the full state
        snapshot = GRAPH.get_state(config)
        final = dict(snapshot.values)

        JOBS[job_id]["full_state"] = final
        JOBS[job_id]["status"] = "awaiting_review"
        JOBS[job_id]["data_quality_report"] = final.get("data_quality_report")
        JOBS[job_id]["data_quality_issues"] = final.get("data_quality_issues", [])
        JOBS[job_id]["predictions"] = final.get("predictions", [])
        JOBS[job_id]["explanations"] = final.get("explanations", {})

    except Exception as e:
        JOBS[job_id]["status"] = "error"
        JOBS[job_id]["error"] = str(e)


def finalize_pipeline(job_id: str):
    """Resume the graph after review approval."""
    config = {"configurable": {"thread_id": job_id}}
    try:
        JOBS[job_id]["status"] = "running"
        for chunk in GRAPH.stream(None, config=config):
            node_name = list(chunk.keys())[0]
            JOBS[job_id]["step"] = node_name

        snapshot = GRAPH.get_state(config)
        final = dict(snapshot.values)
        JOBS[job_id]["full_state"] = final
        JOBS[job_id]["final_call_list"] = final.get("final_call_list", [])
        JOBS[job_id]["status"] = "completed"
    except Exception as e:
        JOBS[job_id]["status"] = "error"
        JOBS[job_id]["error"] = str(e)


@app.post("/upload")
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Accept CSV or XLSX upload and start the pipeline."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ('.csv', '.xlsx', '.xls'):
        raise HTTPException(400, "Only CSV and XLSX files are supported")

    contents = await file.read()
    try:
        if ext == '.csv':
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")

    job_id = str(uuid.uuid4())
    df_json = df.to_json(orient='records')

    JOBS[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "status": "queued",
        "step": None,
        "data_quality_report": None,
        "data_quality_issues": [],
        "predictions": None,
        "explanations": None,
        "final_call_list": None,
        "error": None,
    }

    background_tasks.add_task(run_pipeline, job_id, df_json)
    return {"job_id": job_id, "filename": file.filename, "rows": len(df)}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Job not found")
    job = JOBS[job_id].copy()
    job.pop("full_state", None)
    return job


@app.post("/jobs/{job_id}/review")
def review_job(job_id: str, decision: ReviewDecision, background_tasks: BackgroundTasks):
    if job_id not in JOBS:
        raise HTTPException(404, "Job not found")
    if JOBS[job_id]["status"] != "awaiting_review":
        raise HTTPException(400, f"Job is not awaiting review (status={JOBS[job_id]['status']})")

    if not decision.approved:
        JOBS[job_id]["status"] = "rejected"
        return {"status": "rejected"}

    # Inject approval into the graph state and continue
    config = {"configurable": {"thread_id": job_id}}
    GRAPH.update_state(config, {"review_status": "approved"})
    background_tasks.add_task(finalize_pipeline, job_id)
    return {"status": "finalizing"}


@app.get("/jobs/{job_id}/download")
def download_call_list(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Job not found")
    if JOBS[job_id]["status"] != "completed":
        raise HTTPException(400, "Job not completed yet")

    call_list = JOBS[job_id].get("final_call_list", [])
    df = pd.DataFrame(call_list)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=call_list_{job_id[:8]}.csv"},
    )


def run_training(job_id: str, tmp_path: str):
    try:
        TRAIN_JOBS[job_id]["status"] = "running"
        result = run_xgboost_training(tmp_path)
        TRAIN_JOBS[job_id].update({"status": "completed", "auc": round(result["auc"], 4)})
    except Exception as e:
        TRAIN_JOBS[job_id].update({"status": "error", "error": str(e)})
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


@app.post("/train")
async def upload_training_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Accept a CSV/XLSX from a manager and retrain the XGBoost model."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    ext = Path(file.filename).suffix.lower()
    if ext not in ('.csv', '.xlsx', '.xls'):
        raise HTTPException(400, "Only CSV and XLSX files are supported")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    tmp.write(contents)
    tmp.close()

    job_id = str(uuid.uuid4())
    TRAIN_JOBS[job_id] = {"job_id": job_id, "status": "queued", "auc": None, "error": None}
    background_tasks.add_task(run_training, job_id, tmp.name)
    return {"job_id": job_id}


@app.get("/train/{job_id}")
def get_train_job(job_id: str):
    if job_id not in TRAIN_JOBS:
        raise HTTPException(404, "Training job not found")
    return TRAIN_JOBS[job_id]


@app.get("/health")
def health():
    return {"status": "ok"}
