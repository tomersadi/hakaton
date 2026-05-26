import axios from 'axios';

const BASE = 'http://localhost:8001';

export interface Job {
  job_id: string;
  filename: string;
  status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'rejected' | 'error';
  step: string | null;
  data_quality_report: Record<string, unknown> | null;
  data_quality_issues: string[];
  predictions: Customer[] | null;
  explanations: Record<string, string> | null;
  final_call_list: Customer[] | null;
  error: string | null;
}

export interface Customer {
  rank: number;
  customerid: string;
  payment_probability: number;
  age: number;
  gender: string;
  debtamount: number;
  debtagedays: number;
  cardstatus: string;
  pd_rating: string;
  creditproducts: string;
  returningcustomer: boolean;
  backupcard: boolean;
  collectiondays: number;
  zip: string;
  explanation?: string;
}

export const api = {
  upload: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await axios.post<{ job_id: string; filename: string; rows: number }>(
      `${BASE}/upload`, form
    );
    return res.data;
  },

  getJob: async (jobId: string) => {
    const res = await axios.get<Job>(`${BASE}/jobs/${jobId}`);
    return res.data;
  },

  review: async (jobId: string, approved: boolean) => {
    const res = await axios.post(`${BASE}/jobs/${jobId}/review`, { approved });
    return res.data;
  },

  downloadUrl: (jobId: string) => `${BASE}/jobs/${jobId}/download`,

  trainUpload: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await axios.post<{ job_id: string }>(`${BASE}/train`, form);
    return res.data;
  },

  getTrainJob: async (jobId: string) => {
    const res = await axios.get<{ job_id: string; status: string; auc: number | null; error: string | null }>(
      `${BASE}/train/${jobId}`
    );
    return res.data;
  },
};
