# Isolated ClickHouse pilot

This harness only connects to ClickHouse. It imports the portable SQL renderer, but no runner, export module or database driver that can connect to PostgreSQL. PostgreSQL comparisons use the saved JSON evidence.

The immutable `benchmark_20260910.raw` cohort includes `lesswrong.com` events from August 31, 2026 inclusive through September 8 at 00:05 UTC exclusive. It preserves the original hour/day workloads' metadata lookback and SSR lookahead. Earlier unseen windows cannot use `metadata_join` without a corresponding earlier source lookback.

Run from the repository root:

```sh
python -m unittest discover -s docs/analytics-benchmark/clickhouse-pilot
python docs/analytics-benchmark/clickhouse-pilot/pilot.py metadata
python docs/analytics-benchmark/clickhouse-pilot/pilot.py build --layouts raw
python docs/analytics-benchmark/clickhouse-pilot/live_test.py
python docs/analytics-benchmark/clickhouse-pilot/pilot.py benchmark --layouts raw --repeats 0 --output baseline.json
python docs/analytics-benchmark/clickhouse-pilot/pilot.py build --layouts minmax,projection,typed
python docs/analytics-benchmark/clickhouse-pilot/pilot.py benchmark --passes 2
python docs/analytics-benchmark/clickhouse-pilot/evidence.py
```

Build commands deliberately fail if a table already exists. They never append after a partially failed build. Inspect `build-journal.json`, `system.processes`, `system.query_log`, `system.mutations` and the table's row count before recovery. A lost client response does not prove an INSERT failed. Never retry an INSERT blindly. The source table is never altered.

Queries reuse one HTTPS connection, disable query and condition caches, use UTC, exact distinct counts, null-preserving joins, two threads and a 4GB per-query memory bound. Timing includes execute/fetch. `statistics.elapsed` records server elapsed separately. The first request can include connection/wakeup time. `evidence.json` collects server query-log timing, peak memory and selected marks after logs become visible; it never collects query text.

`baseline.json` is the all-case raw reference. `results.json` records one warmup and three measurements per layout/case in seeded shuffled order, repeated in another seeded pass when `--passes 2` is supplied. Every completed sample is compared with available saved PostgreSQL hashes and the raw reference. No matching PostgreSQL hash is inferred for its timed-out cases. Re-running the same output resumes missing repeat/pass slots; use a new output filename to run a fresh experiment. Error slots are preserved, not silently overwritten.

`pilot.Client.query(sql, timeout=180, mutation=False)` returns `(observation, rows)`; `Client.mutate(label, sql, timeout=600)` persists mutation submission/completion and raises on failure. `sql_for(layout, case, profile, params, custom_windows=None)` preserves canonical SQL. Layouts beginning `typed` use canonical stored columns. Other layouts normalize raw JSON through `raw_projection`. Private parameters are available at `client.params` and must never be written to reports. Plans are redacted before saving.

Physical limitations: copying a bounded time range, parallel insertion, part boundaries and subsequent merges can change chronological clustering. `ORDER BY tuple()` does not promise source-order preservation. A minmax benefit on this cohort does not establish the same benefit on the existing 2.32-billion-row source. Monthly partitioning, sorting and typed extraction are combined in the typed candidate, so its latency improvement cannot be assigned to any single change. Build/storage costs are separate from query costs. The old PostgreSQL hardware is unknown and old ClickHouse client timing included a new TLS connection per request.

`semantic_fixture.py` checks all 15 workloads using the original 27-row synthetic edge-case fixture. It compares raw JSON adaptation and a stored typed ClickHouse table against local DuckDB, including metadata tie-breaking, expired metadata, cross-environment exclusion, funnel chronology, exact large IDs and SSR lookahead/deduplication. It creates `typed_fixture` once and fails if rerun against an existing fixture table. Run with a Python environment containing DuckDB; in this workspace:

```sh
LD_LIBRARY_PATH=/nix/store/ab3753m6i7isgvzphlar0a8xb84gl96i-gcc-15.2.0-lib/lib /tmp/analytics-perf-venv/bin/python docs/analytics-benchmark/clickhouse-pilot/semantic_fixture.py
python docs/analytics-benchmark/clickhouse-pilot/summarize.py
```
