# backend/src/app/routers/router_cs25_outline.py

from typing import Optional, Tuple
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Use ONLY the utils runtime (no dependency on agent.py)
from src.graphs.cs25_graph.utils import ManifestGraph, GraphOps

# This file is meant to be included in main.py like:
#   app.include_router(router_cs25_outline.router, prefix="/api")
# which yields endpoint:
#   POST /api/cs25/outline/details
router = APIRouter(prefix="/cs25/outline", tags=["cs25-outline"])


# -------------------------
# Lazy, local runtime cache
# -------------------------

_OPS: Optional[GraphOps] = None

def _get_ops() -> GraphOps:
    """Initialize ManifestGraph + GraphOps once, reuse thereafter."""
    global _OPS
    if _OPS is not None:
        return _OPS
    mg = ManifestGraph()    # looks for manifest.json next to utils.py (your current behavior)
    mg.load()               # builds mg.G
    _OPS = GraphOps(mg.G)
    return _OPS


# -------------------------
# Request model
# -------------------------

class OutlineDetailIn(BaseModel):
    uuid: str = Field(..., description="UUID of a Section, Trace, or (optionally) Paragraph node")
    bottom_uuid: Optional[str] = Field(
        None,
        description="Optional bottom Paragraph UUID when resolving Trace nodes (overrides trace.bottom_uuid if provided)."
    )
    cit_limit: Optional[int] = Field(
        None, ge=1,
        description="Optional pagination size for citations (flat rows). If omitted, returns grouped cites per node."
    )
    cit_offset: Optional[int] = Field(
        0, ge=0,
        description="Optional pagination offset for citations (only used when cit_limit is provided)."
    )


# -------------------------
# Route
# -------------------------

@router.post("/details")
async def get_outline_details(payload: OutlineDetailIn):
    """
    Resolve a CS-25 outline node (Section or Trace) to UI-ready details.

    - Section → { type, meta, intent, intents }
    - Trace   → { type, meta{bottom_uuid}, intent(bottom), hierarchy(Document→…→Paragraph),
                  citations(flat when paged or grouped otherwise), citations_page? }
    - Paragraph (optional): if anchored by a Trace (HAS_ANCHOR), treat as Trace-from-bottom.
    """
    ops = _get_ops()
    G = ops.G

    if payload.uuid not in G:
        raise HTTPException(status_code=404, detail="uuid_not_found")

    # These helper methods were proposed for GraphOps; ensure they exist.
    if not hasattr(ops, "get_node_type") or not hasattr(ops, "get_node_meta"):
        raise HTTPException(status_code=500, detail="GraphOps missing required helpers (get_node_type/get_node_meta)")

    ntype = ops.get_node_type(payload.uuid)

    # ---- Section branch -------------------------------------------------
    if ntype == "Section":
        if not hasattr(ops, "build_records_for_section"):
            raise HTTPException(status_code=500, detail="GraphOps missing build_records_for_section()")
        bundle = ops.build_records_for_section(payload.uuid)  # { section_uuid, trace, intents }
        intents = bundle.get("intents") or []
        meta = ops.get_node_meta(payload.uuid)
        return JSONResponse({
            "type": "section",
            "meta": meta,
            "intent": intents[0] if intents else None,
            "intents": intents,
        }, status_code=200)

    # ---- Trace branch ---------------------------------------------------
    if ntype == "Trace":
        for attr in ("build_records_for_trace_uuid", "pick_bottom_intent", "paginate_citations"):
            if not hasattr(ops, attr):
                raise HTTPException(status_code=500, detail=f"GraphOps missing {attr}()")

        tb = ops.build_records_for_trace_uuid(payload.uuid, bottom_uuid=payload.bottom_uuid)
        meta = ops.get_node_meta(payload.uuid)
        meta["bottom_uuid"] = tb.get("bottom_uuid")

        bottom_intent = ops.pick_bottom_intent(tb.get("intents") or [], tb.get("bottom_uuid"))

        cites = tb.get("cites") or []
        if payload.cit_limit:
            flat_rows, total = ops.paginate_citations(cites, payload.cit_limit, payload.cit_offset)
            citations = flat_rows
            citations_page = {"limit": payload.cit_limit, "offset": payload.cit_offset or 0, "total": total}
        else:
            citations = cites
            citations_page = None

        return JSONResponse({
            "type": "trace",
            "meta": meta,
            "intent": bottom_intent,
            "hierarchy": tb.get("trace") or [],
            "citations": citations,
            "citations_page": citations_page,
        }, status_code=200)

    # ---- Optional Paragraph support → trace-from-bottom -----------------
    if ntype == "Paragraph":
        # Find a Trace that anchors this paragraph (Trace --HAS_ANCHOR--> bottom)
        for trc, _, d in G.in_edges(payload.uuid, data=True):
            if d.get("relation") == "HAS_ANCHOR" and G.nodes.get(trc, {}).get("ntype") == "Trace":
                if not hasattr(ops, "build_records_for_trace_uuid"):
                    raise HTTPException(status_code=500, detail="GraphOps missing build_records_for_trace_uuid()")
                tb = ops.build_records_for_trace_uuid(trc, bottom_uuid=payload.uuid)

                meta = ops.get_node_meta(trc)
                meta["bottom_uuid"] = payload.uuid

                bottom_intent = ops.pick_bottom_intent(tb.get("intents") or [], payload.uuid) \
                    if hasattr(ops, "pick_bottom_intent") else None

                cites = tb.get("cites") or []
                if payload.cit_limit and hasattr(ops, "paginate_citations"):
                    flat_rows, total = ops.paginate_citations(cites, payload.cit_limit, payload.cit_offset)
                    citations = flat_rows
                    citations_page = {"limit": payload.cit_limit, "offset": payload.cit_offset or 0, "total": total}
                else:
                    citations = cites
                    citations_page = None

                return JSONResponse({
                    "type": "trace",
                    "meta": meta,
                    "intent": bottom_intent,
                    "hierarchy": tb.get("trace") or [],
                    "citations": citations,
                    "citations_page": citations_page,
                }, status_code=200)

        raise HTTPException(status_code=400, detail="paragraph_not_anchored_by_trace")

    # Unsupported types are explicit 400
    raise HTTPException(status_code=400, detail=f"unsupported_ntype:{ntype}")