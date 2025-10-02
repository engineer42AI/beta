

# ------------------ Test: graph load / integrity checks ------------------

from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps
import json

# Initialise
graph = ManifestGraph()  # or "" if test.py is in same folder as manifest.json

# 1. Load the graph
result = graph.load()
print("LOAD RESULT:")
print(result)

# 2. Update the manifest with a fresh checksum (optional)
update = graph.update_manifest()
print("UPDATE RESULT:")
print(update)

# 3. Access metadata directly
print("META:")
print(graph.meta())

# 4. If you want to use the graph itself (networkx object):
G = graph.G
print("Graph object:", G)
print("Nodes:", G.number_of_nodes())
print("Edges:", G.number_of_edges())

# Query helpers unchanged
ops = GraphOps(G)
sec = ops.find_section_by_number("CS 25.103")
print(sec, ops.get_section_label(sec))

bundle = ops.build_records_for_bottom(bottom_uuid="05b430f7-fae4-47ac-baa0-fc4dc0ff48b7")
bundle_trace = json.dumps(bundle["trace"], indent=4)
bundle_cites = json.dumps(bundle["cites"], indent=4)
bundle_intent = json.dumps(bundle["intents"], indent=4)

trace_block = ops.format_trace_block(bundle["trace"], include_uuids=False, include_text=True)
cites_block = ops.format_citations_block(bundle["trace"], bundle["cites"], include_uuids=False)
intents_block = ops.format_intents_block(bundle["trace"], bundle["intents"], fields=["intent", "section_intent"], include_uuids=False)


# ------------------ Test: agent deploy ------------------

import asyncio
from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps
from src.graphs.cs25_graph.agent import stream_all_traces, collect_report_from_stream
from dotenv import load_dotenv, find_dotenv
from openai import OpenAI
import os

# ---- env / client -----------------------------------------------------------
load_dotenv(find_dotenv(".env"))  # finds .env anywhere up the tree
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY not found in .env")
client = OpenAI(api_key=api_key)

# 1) Load graph (will return status JSON and set .G)
mg = ManifestGraph()                      # defaults to folder of utils.py in cs25_graph
load_status = mg.load()                   # returns a dict; mg.G has the graph
print("LOAD STATUS:", load_status)
ops = GraphOps(mg.G)

stream = stream_all_traces(
    mg.G, ops,
    query="Are there CS-25 rules relevant to approaches below 200 ft decision height, and why?",
    model="gpt-5-nano",
    batch_size=5,  # == parallelism
    limit=10,  # or 500 while testing
    pricing_per_million=(0.05, 0.40),  # adjust to model
)

# Option A: consume as it comes (e.g., print or log):
async for evt in stream:
        print(evt)  # or push to a file/socket/etc.

# Option B: if you need a final report, use the collector:
report = await collect_report_from_stream(stream)
print(report["summary"])

