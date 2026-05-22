"""LangGraph pipeline assembly."""
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from graph.state import PipelineState
from graph.agents import (
    data_quality_agent,
    ml_scoring_agent,
    explanation_agent,
    review_agent,
    report_agent,
    route_after_review,
)


def build_graph():
    builder = StateGraph(PipelineState)

    builder.add_node('data_quality', data_quality_agent)
    builder.add_node('ml_scoring', ml_scoring_agent)
    builder.add_node('explanation', explanation_agent)
    builder.add_node('review', review_agent)
    builder.add_node('report', report_agent)

    builder.set_entry_point('data_quality')
    builder.add_edge('data_quality', 'ml_scoring')
    builder.add_edge('ml_scoring', 'explanation')
    builder.add_edge('explanation', 'review')

    builder.add_conditional_edges(
        'review',
        route_after_review,
        {
            'report': 'report',
            'end': END,
            'wait': END,   # Graph pauses; caller must re-invoke with updated state
        },
    )
    builder.add_edge('report', END)

    memory = MemorySaver()
    return builder.compile(checkpointer=memory)


GRAPH = build_graph()
