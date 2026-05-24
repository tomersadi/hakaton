import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';
import type { Job, Customer } from './api';
import { Upload, CheckCircle, XCircle, Clock, Download, Phone, AlertTriangle, FileText } from 'lucide-react';
import Landing from './Landing';
import './App.css';

type Step = 'landing' | 'upload' | 'processing' | 'review' | 'result';

const POLL_MS = 2500;

function StatusBadge({ status }: { status: Job['status'] }) {
  const map: Record<Job['status'], { label: string; bg: string }> = {
    queued:           { label: 'Queued',           bg: '#8096C0' },
    running:          { label: 'Processing…',      bg: 'linear-gradient(135deg,#0F3485,#1B5ECE)' },
    awaiting_review:  { label: 'Awaiting Review',  bg: '#f59e0b' },
    completed:        { label: 'Completed',        bg: '#10b981' },
    rejected:         { label: 'Rejected',         bg: '#ef4444' },
    error:            { label: 'Error',            bg: '#ef4444' },
  };
  const { label, bg } = map[status];
  return (
    <span style={{
      background: bg, color: '#fff', borderRadius: 12,
      padding: '3px 14px', fontSize: 13, fontWeight: 700,
      boxShadow: '0 2px 6px rgba(0,0,0,.15)',
    }}>{label}</span>
  );
}

function ProbabilityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontWeight: 700, color, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function CustomerRow({ c, rank }: { c: Customer; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer', background: rank % 2 === 0 ? '#F7F9FF' : '#fff' }}
      >
        <td style={{ padding: '10px 12px', fontWeight: 800, color: '#1B5ECE' }}>#{rank}</td>
        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.customerid}</td>
        <td style={{ padding: '10px 12px' }}>{c.age} / {c.gender}</td>
        <td style={{ padding: '10px 12px' }}>₪{c.debtamount.toLocaleString()}</td>
        <td style={{ padding: '10px 12px' }}>{c.debtagedays}d</td>
        <td style={{ padding: '10px 12px' }}>
          <span style={{
            background: c.cardstatus === 'Active' ? '#E3EDFB' : c.cardstatus === 'Expired' ? '#fef3c7' : '#fee2e2',
            color: c.cardstatus === 'Active' ? '#0F3485' : c.cardstatus === 'Expired' ? '#92400e' : '#991b1b',
            borderRadius: 8, padding: '2px 8px', fontSize: 12, fontWeight: 700,
          }}>{c.cardstatus}</span>
        </td>
        <td style={{ padding: '10px 12px', minWidth: 160 }}>
          <ProbabilityBar value={c.payment_probability} />
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
          <Phone size={16} color="#1B5ECE" />
        </td>
      </tr>
      {expanded && c.explanation && (
        <tr style={{ background: '#E3EDFB' }}>
          <td colSpan={8} style={{ padding: '8px 48px', fontSize: 13, color: '#0F3485', fontStyle: 'italic' }}>
            💡 {c.explanation}
          </td>
        </tr>
      )}
    </>
  );
}

function CalNav() {
  return (
    <nav className="cal-nav">
      <div className="cal-nav-logo">
        <img src="/cal-logo.svg" alt="Cal" className="app-logo-img" />
        <span className="logo-collect">Collect</span>
      </div>
    </nav>
  );
}

export default function App() {
  const [step, setStep] = useState<Step>('landing');
  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const j = await api.getJob(jobId);
      setJob(j);
      if (j.status === 'awaiting_review') { stopPolling(); setStep('review'); }
      else if (j.status === 'completed') { stopPolling(); setStep('result'); }
      else if (j.status === 'error' || j.status === 'rejected') { stopPolling(); }
    } catch { /* ignore transient errors */ }
  }, [stopPolling]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(() => pollJob(jobId), POLL_MS);
  }, [pollJob, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const { job_id } = await api.upload(file);
      const j = await api.getJob(job_id);
      setJob(j);
      setStep('processing');
      startPolling(job_id);
    } catch (e: unknown) {
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleReview = async (approved: boolean) => {
    if (!job || reviewLoading) return;
    setReviewLoading(true);
    try {
      await api.review(job.job_id, approved);
      if (!approved) { setJob(j => j ? { ...j, status: 'rejected' } : j); return; }
      setJob(j => j ? { ...j, status: 'running' } : j);
      setStep('processing');
      startPolling(job.job_id);
    } catch (e: unknown) {
      alert(`Review failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReviewLoading(false);
    }
  };

  const reset = () => { stopPolling(); setJob(null); setStep('landing'); setReviewComment(''); };

  // ── Landing Step ─────────────────────────────────────────────────────────
  if (step === 'landing') return <Landing onStart={() => setStep('upload')} />;

  // ── Upload Step ──────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <>
    <CalNav />
    <div className="container">
      <div className="header">
        <h1>Upload Customer File</h1>
        <p>Upload a CSV or XLSX file to rank customers by payment probability</p>
      </div>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {uploading
          ? <><Clock size={48} color="#3b82f6" /><p>Uploading…</p></>
          : <><Upload size={48} color="#9ca3af" /><p>Drop your CSV or XLSX here, or click to browse</p></>
        }
      </div>
    </div>
    </>
  );

  // ── Processing Step ──────────────────────────────────────────────────────
  if (step === 'processing') {
    const steps = ['data_quality', 'ml_scoring', 'explanation', 'review'];
    const current = steps.indexOf(job?.step ?? '');
    return (
      <>
      <CalNav />
      <div className="container">
        <div className="header">
          <h1>Processing your file…</h1>
          {job && <StatusBadge status={job.status} />}
        </div>
        <div className="pipeline-steps">
          {[
            { key: 'data_quality', label: 'Data Quality Check' },
            { key: 'ml_scoring', label: 'ML Scoring' },
            { key: 'explanation', label: 'AI Explanations' },
            { key: 'review', label: 'Human Review' },
          ].map((s, i) => (
            <div key={s.key} className={`step ${i < current ? 'done' : i === current ? 'active' : ''}`}>
              {i < current ? <CheckCircle size={20} color="#10b981" /> : <Clock size={20} />}
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {job?.error && <div className="error-box"><AlertTriangle /> {job.error}</div>}
      </div>
      </>
    );
  }

  // ── Review Step ──────────────────────────────────────────────────────────
  if (step === 'review' && job) {
    const topN = (job.predictions ?? []).slice(0, 10);
    return (
      <>
      <CalNav />
      <div className="container wide">
        <div className="header">
          <h1>Supervisor Review</h1>
          <p>Review the ML results before generating the final call list</p>
        </div>

        {(job.data_quality_issues?.length ?? 0) > 0 && (
          <div className="warning-box">
            <AlertTriangle size={16} />
            <strong>Data Quality Warnings:</strong>
            <ul>{job.data_quality_issues.map(i => <li key={i}>{i}</li>)}</ul>
          </div>
        )}

        {job.data_quality_report && (
          <div className="stats-row">
            <div className="stat">
              <span className="stat-n">{(job.data_quality_report.total_rows as number).toLocaleString()}</span>
              <span>Total Customers</span>
            </div>
            <div className="stat">
              <span className="stat-n">{(job.predictions ?? []).filter(p => p.payment_probability >= 0.7).length}</span>
              <span>High Probability (&gt;70%)</span>
            </div>
            <div className="stat">
              <span className="stat-n">{(job.predictions ?? []).filter(p => p.payment_probability >= 0.4 && p.payment_probability < 0.7).length}</span>
              <span>Medium (40–70%)</span>
            </div>
            <div className="stat">
              <span className="stat-n">{(job.predictions ?? []).filter(p => p.payment_probability < 0.4).length}</span>
              <span>Low (&lt;40%)</span>
            </div>
          </div>
        )}

        <h3>Top 10 Customers to Call</h3>
        <table className="customer-table">
          <thead><tr>
            <th>#</th><th>Customer ID</th><th>Age/Gender</th><th>Debt</th>
            <th>Debt Age</th><th>Card Status</th><th>Pay Probability</th><th>Call</th>
          </tr></thead>
          <tbody>
            {topN.map((c, i) => (
              <CustomerRow key={c.customerid} c={{ ...c, explanation: job.explanations?.[c.customerid] ?? '' }} rank={i + 1} />
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Click a row to see AI explanation</p>

        <textarea
          placeholder="Optional notes for the record…"
          value={reviewComment}
          onChange={e => setReviewComment(e.target.value)}
          style={{ width: '100%', marginTop: 16, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', resize: 'vertical', minHeight: 80, fontSize: 14 }}
        />

        <div className="review-actions">
          <button className="btn-reject" disabled={reviewLoading} onClick={() => handleReview(false)}>
            <XCircle size={18} /> Reject — Do Not Proceed
          </button>
          <button className="btn-approve" disabled={reviewLoading} onClick={() => handleReview(true)}>
            {reviewLoading ? <Clock size={18} /> : <CheckCircle size={18} />}
            {reviewLoading ? 'Processing…' : 'Approve & Generate Call List'}
          </button>
        </div>
      </div>
      </>
    );
  }

  // ── Result Step ──────────────────────────────────────────────────────────
  if (step === 'result' && job) {
    const list = job.final_call_list ?? [];
    return (
      <>
      <CalNav />
      <div className="container wide">
        <div className="header">
          <CheckCircle size={32} color="#10b981" />
          <h1>Call List Ready</h1>
          <p>{list.length} customers ranked by payment probability</p>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <a href={api.downloadUrl(job.job_id)} className="btn-download">
            <Download size={18} /> Download Full CSV
          </a>
          <button className="btn-reset" onClick={reset}>
            <FileText size={18} /> Process Another File
          </button>
        </div>

        <table className="customer-table">
          <thead><tr>
            <th>#</th><th>Customer ID</th><th>Age/Gender</th><th>Debt</th>
            <th>Debt Age</th><th>Card Status</th><th>Pay Probability</th><th>Call</th>
          </tr></thead>
          <tbody>
            {list.map(c => <CustomerRow key={c.customerid} c={c} rank={c.rank} />)}
          </tbody>
        </table>
      </div>
      </>
    );
  }

  return null;
}
