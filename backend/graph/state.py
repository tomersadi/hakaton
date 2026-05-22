from typing import TypedDict, Optional, Any


class PipelineState(TypedDict):
    file_path: str
    raw_df_json: Optional[str]          # DataFrame serialized as JSON
    data_quality_report: Optional[dict]
    data_quality_issues: list[str]
    predictions: Optional[list[dict]]   # sorted by payment_probability desc
    explanations: Optional[dict]        # customerid -> explanation string
    review_status: str                  # "pending" | "approved" | "rejected"
    final_call_list: Optional[list[dict]]
    error: Optional[str]
    job_id: str
