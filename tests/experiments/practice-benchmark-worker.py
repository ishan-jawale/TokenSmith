"""Isolated production index/search worker. No installed app data is opened."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python_engine"))
import tokensmith_engine as engine


def inspect_pdf(payload):
    pdf = engine.pdfium.PdfDocument(payload["path"])
    try:
        pages = []
        for number in (1, 14, 36, 68, 76):
            if number > len(pdf):
                continue
            page = pdf[number - 1]
            text = page.get_textpage()
            try:
                pages.append({"pdfPage": number, "text": text.get_text_range()})
            finally:
                text.close()
                page.close()
        return {"pageCount": len(pdf), "samples": pages}
    finally:
        pdf.close()


engine.COMMANDS["inspect_pdf"] = inspect_pdf
# Production hybrid retrieval can degrade to keywords when embeddings fail.
# Preserve that diagnostic and do not silently label a degraded run as hybrid.
original_search = engine.search_library


def checked_search(payload):
    result = original_search(payload)
    semantic = [s for s in result.get("latencySpans", []) if s.get("stage") == "Semantic search"]
    if payload.get("searchMode") == "hybrid" and not any(s.get("outCount", 0) > 0 for s in semantic):
        raise RuntimeError("Hybrid retrieval returned no vector hits; check the embedding model. No keyword-only substitution was used.")
    return result


engine.COMMANDS["search"] = checked_search
engine.main()
