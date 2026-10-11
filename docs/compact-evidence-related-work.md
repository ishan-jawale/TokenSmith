# Compact evidence: related work and team overlap

Checked October 6, 2026. This is a targeted prior-work check, not an exhaustive literature review. No implementation or latency measurements were performed for TokenSmith in this check.

## Finding

The broad idea has already been tried: retrieve source material, select the parts relevant to the question, and supply the reduced text to the answer model. It is commonly described as query-aware context compression or contextual compression. Public frameworks provide implementations, research papers investigate its quality/cost tradeoff, and the supplied team slides contain a directly overlapping proposed direction.

The useful TokenSmith contribution would be a small application experiment: determine whether a cheap, source-preserving selector reduces Gemma answer-ready time on the chosen server after accounting for its own cost, without removing required facts. The selector itself should not be presented as a new research technique.

## Closest team overlap

Source: `/Users/Skaterboi/Downloads/Untitled.pdf`, titled **Special Problems | Fall 2026**, 83 PDF pages. Page numbers below are physical PDF page numbers. The weekly sections establish the dates; the individual slides do not all repeat them. Text was extracted across the deck and the relevant slides were visually inspected.

| Contributor and date | Evidence in the slides | Relationship to this proposal |
| --- | --- | --- |
| Jinseo, September 23, PDF page 22 | Under **Next Step: Improve Evidence Selection**, proposes retrieving more candidates, reranking them, and supplying only relevant complete formula/context units. | Direct conceptual overlap with selective evidence before generation. Their stated context is quantitative reasoning. The slide records an intended next step, not a completed selector. |
| Aditya, September 16, PDF page 60 | Reports trying RAPTOR-style summarization between chunks and encountering substantial memory/hardware problems. | Related work on document representation and summarization, with a different mechanism and larger pipeline. It reinforces the practical reason to keep the first prototype lightweight. |
| Vedant Bhatt, September 30, PDF page 3 | Reports high relevance scores for some unsupported generated answers and explores NLI for grounding. | Related caution: relevance scoring is not proof of factual support. Our lexical coverage or cosine scores must not be presented as answer-confidence guarantees. |

The timing and accuracy table on Jinseo's page 22 reports the JavaScript reasoning comparison: 20 cases per arm, 12/20 complete answers in both arms, 12/20 versus 16/20 correct calculations, and 8.83 versus 8.61 seconds latency. It does not report results for the proposed evidence-selection step. Those values are not evidence of a compression speedup.

Jinseo's September 30 update discusses the JavaScript reasoning path and its tradeoff; it does not establish whether the evidence-selection proposal was implemented. The supplied deck cannot confirm current ownership, implementation status, or a future roadmap as of October 6. No teammate was contacted and no private branch was inspected.

## Public implementations and research

### LlamaIndex Sentence Embedding Optimizer

The documented postprocessor removes sentences that are irrelevant to the query using embedding similarity. It supports keeping a top percentage or applying a similarity threshold. Its example compares token usage and total elapsed time with and without optimization. This is a close implementation analogue to selecting smaller passages within already retrieved sources. Its published example is not a TokenSmith or Gemma performance guarantee.

Source: [official developer documentation](https://developers.llamaindex.ai/python/examples/node_postprocessor/optimizerdemo/).

### LangChain contextual compression, April 2023

LangChain documents a compressor after a base retriever. Its examples include splitting retrieved documents into smaller pieces and filtering them using embeddings, as well as extracting relevant statements through an LLM. The split-then-filter pipeline directly resembles our proposal; the implementation choice determines whether extra embedding or generation work is required.

Source: [LangChain's original explanation](https://www.langchain.com/blog/improving-document-retrieval-with-contextual-compression).

### RECOMP, October 2023 / ICLR 2024

Fangyuan Xu, Weijia Shi, and Eunsol Choi study compression before retrieved text is added to the model input. Their extractive compressor selects useful sentences; their abstractive compressor generates summaries. The compressors are trained for downstream tasks, unlike our proposed rule-based selector. Their selective augmentation can omit retrieved information entirely; it should not be confused with our fallback to the existing source packet.

Sources: [paper](https://arxiv.org/abs/2310.04408), [authors' implementation](https://github.com/carriex/recomp).

### LongLLMLingua, October 2023 / ACL 2024

Huiqiang Jiang and colleagues study prompt compression for long-context scenarios, improving the density of useful information and evaluating latency. They report end-to-end acceleration in their tested setups. Their model-based compression machinery differs from selecting intact original paragraph spans. Its published speedups should not be transferred to local Gemma, shorter TokenSmith inputs, or this proposed lexical selector.

Sources: [paper](https://arxiv.org/abs/2310.06839), [Microsoft's implementation](https://github.com/microsoft/LLMLingua).

### Adaptive compression for edge RAG, August 2026

Zlatan Feric, Amir Taherin, Yanzhi Wang, and David Kaeli evaluate LLMLingua-2 compression with Llama and Qwen generators on NVIDIA Jetson AGX Thor. They explicitly account for compressor overhead and examine the tradeoff between compression, quality, and device costs. Their proposed telemetry-driven controller is a research direction supported by measurements, not a universal deployed policy. This recent work closely matches our need to measure net benefit, but uses different hardware, models, datasets, and compression.

Source: [paper and experimental discussion](https://arxiv.org/html/2608.19535v1).

## Keep the next step simple

Follow the current detailed implementation plan as the authoritative sequence. Close prior work establishes the approach; the prototype uses the existing Nomic retrieval and the user-selected middle Gemma model on Ada, without an additional compression model, framework, or learned classifier.

Use the existing plan as one bounded experiment:

1. Keep the Nomic retrieval results, Gemma generator, answer instructions, and runtime settings fixed between arms.
2. Implement one transparent selector for original source passages, with an explicit evidence-mode parameter, a configurable token budget, and conservative fallbacks.
3. Measure selection overhead, preflight, generation, and answer-ready time; inspect the actual evidence and answers on the fixed cases.

The planned 1,500 estimated evidence-token target and lexical coverage thresholds are experimental choices, not validated sufficiency tests. They must remain labeled that way. Chapter summarization and complete quantitative examples continue through standard evidence; that fallback does not guarantee complete chapter coverage from limited retrieval.

Before pitching a separate general-purpose evidence-selection feature, establish how Jinseo's September 23 proposal relates to the prototype. For tomorrow, the precise contribution can be a local latency experiment using source-preserving compression, with the overlap acknowledged. This is a recommendation based on the slides, not a claim that Jinseo is currently implementing the same code.

## Meeting framing

Suggested title: **Can smaller evidence make local Gemma answers faster?**

Describe the work as adapting an established approach to TokenSmith. Cite LlamaIndex or RECOMP for the method, acknowledge the team overlap, and show whether the reduction helps the entire answer pipeline. A smaller prompt alone is not the final outcome; preservation of required facts and net latency determine whether it is useful.
