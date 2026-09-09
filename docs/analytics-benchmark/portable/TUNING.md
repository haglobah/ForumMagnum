# How to use this suite to choose a storage design

The question is which design serves this workload at an acceptable ingestion cost, freshness, operating cost, and concurrency. A faster scan alone does not answer that question.

## What prompted the suite

The [original measurements](../long-range/README.md) found 52 of 67 primary queries exceeded a 15-second budget. Week traffic and the comparison of 24 monthly first days also exceeded 60 seconds. Selective tab lookups completed in milliseconds using an existing expression index. Broad scans and selective lookups need different physical designs.

The inspected PostgreSQL `raw` table already had an `(event_type, timestamp)` index, and bounded page-view predicates reached that index through the views. Adding another timestamp index is therefore not an evidence-based general fix. Two existing timestamp B-trees were exact duplicates, about 60 GB each, but removal still requires dependency and workload review. The table had roughly 2.3 billion events, about 978 GB of table storage and 441 GB of indexes at inspection time. These are historical observations, not suite prerequisites.

Instrumentation also changed over time: the selected historical dates had SSR metadata before `tabStarted` appeared. Missing events must not become zero feature adoption or verified human traffic. The portable workloads make those choices explicit; consult their definitions before comparing their outputs to older raw queries.

## Keep three experiments separate

| Experiment | Question | Conditions |
| --- | --- | --- |
| Existing raw PostgreSQL | How slow is the current access path? | Use the existing raw runner and record its JSON extraction and server execution timing. |
| Canonical typed events on all four engines | Which engine/layout best serves identical logical data? | Same frozen snapshot, parameters, workload definitions, complete result hashes and timing boundary. |
| Derived tables or aggregates | What can a maintained read model buy us? | Same final answers; separately report materialization, freshness, correction and rebuild costs. |

Do not place old `EXPLAIN ANALYZE` server times and new client execute/fetch times in one speedup column. Likewise, moving JSON extraction into ingestion is a design improvement whose cost must remain visible.

## Tune PostgreSQL in measured steps

Start with the canonical table, collect statistics, and save representative plans. Candidate indexes follow equality filters with the time range: `(event_type, occurred_at)`, `(user_id, occurred_at)`, `(session_id, occurred_at)`, and `(tab_id, occurred_at)`. An environment prefix is most useful when it is selective; the inspected workload was overwhelmingly `lesswrong.com`. Test each index against the cases it should help and measure its storage and ingest cost.

For large scans, test parallel execution and a memory budget that accounts for concurrent operators and workers. Do not treat `work_mem` as a single per-server allocation. BRIN deserves a separate experiment on physically time-correlated data; raw timestamp correlation was only about 0.57 at inspection. Partitioning deserves an experiment for pruning and retention, with the operational cost of managing partitions recorded.

Use `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)` on bounded diagnostic cases separately from measured repetitions. A canceled statement has no completed actual plan. Save estimates for timeout cases, but do not infer actual I/O or spill from estimates. PostgreSQL's [EXPLAIN documentation](https://www.postgresql.org/docs/current/using-explain.html) describes the distinction.

## Test physical layouts without changing answers

| Engine | Candidate layouts | Additional costs to record |
| --- | --- | --- |
| PostgreSQL | Typed table, targeted B-trees, time partitions, BRIN where correlation supports it | Index bytes, write amplification, vacuum/analyze, ingest throughput |
| ClickHouse | Time-oriented order versus event/environment/time order; separate projection for identity lookups | Parts/merges, compression, ingestion latency, projection storage |
| DuckDB/Parquet | Compacted files, time partitioning, row groups sorted by useful filters; local disk versus object storage | Export/compaction time, file count, remote requests/bytes, worker startup and memory |
| StarRocks | Time partitions and alternative distribution/sort keys; optional materialized views as a separate experiment | Load latency, replicas, compaction, refresh and extra storage |

The provided DDL and batch loader establish correctness. They are not the final tuned layouts or a recommended billion-row ingestion pipeline. In particular, exporter batches should be compacted into an intentional Parquet layout for performance tests. Repartitioning or sorting must preserve every logical event; keep the original dataset identity and record the new physical layout and its checksums separately.

For exact distinct clients, daily counts cannot be obtained by adding hourly distinct counts. Approximate distinct sketches require a separately named workload and error contract. Materialized feature or A/B results must retain the same deduplication, attribution windows, late-event handling, and missing-metadata rules.

## Run protocol

1. Freeze one source snapshot including the join lookback/forward intervals. Verify exported checksums and counts; load the same data into each candidate. Do not substitute an ID watermark for a consistent snapshot.
2. Run fixtures and correctness checks before timing. Use fixed private identity parameters and inspect coverage: an empty historical identity lookup is a diagnostic, not representative lookup performance.
3. Record engine version, CPU, RAM, disk/object-store location, connection location, table layout, indexes, settings, and dataset size. Keep a configuration file alongside each report. Never include credentials.
4. Run explicitly selected cases with the same timeout, repetitions, seeded order and cache policy. Label first observed runs and subsequent runs; neither proves a cold cache. Disable result caches for storage-engine comparisons. Cache clearing, if desired, belongs on an isolated instance and must be described.
5. Compare only complete, matching, populated results. Report timeout counts and budgets separately; a timeout is a lower bound, not a measured runtime. Keep transport failures distinct from confirmed server cancellation.

The supplied harness runs one query at a time. A deployment decision additionally needs a separate concurrency experiment at the expected arrival rate: report throughput, latency distributions, queueing, failures, and freshness while ingestion continues. Single-client medians are not dashboard p95 latency or evidence that an embedded engine needs no serving layer.

## Decide using total cost

For each candidate, record initial backfill duration, steady-state ingest rows/second, time until new events become queryable, refresh cost, retained bytes, peak memory, query cost, and operator work. Exercise a late event, duplicate delivery, correction/deletion and rebuild before choosing a refresh architecture. The current suite benchmarks immutable snapshots; it does not implement CDC or those maintenance guarantees.

Choose thresholds before looking at winners: an interactive latency target for selective lookups, an exploration budget for long scans, a freshness limit, an expected concurrency level and a monthly cost ceiling. Prefer the least operationally demanding design that meets those thresholds. ClickHouse, DuckDB/Parquet, and StarRocks remain candidates until measurements under those conditions distinguish them.
