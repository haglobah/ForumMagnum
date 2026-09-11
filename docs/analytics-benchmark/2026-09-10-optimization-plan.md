# ClickHouse optimization experiment handoff

Historical stage record. The completed experiment and final validation are in [clickhouse-pilot/FINAL_HANDOFF.md](clickhouse-pilot/FINAL_HANDOFF.md).

Scope: test ClickHouse layout and query changes using the existing imported data. Do not connect to PostgreSQL. Reuse saved PostgreSQL evidence. Keep `default.public_raw` unchanged and put experimental objects in a separate benchmark database or uniquely named tables.

## Existing evidence and reusable code

- `2026-09-10-cloud-results.json`: 30 hour/day cases, including completed PostgreSQL aggregate hashes for 21 cases. Compare the `sha256` values in completed `cases[case/profile].postgres.attempts`. Missing PostgreSQL results remain unavailable; do not rerun them.
- `2026-09-10-investigation.json`: source DDL, resource observations, source hash records, full-scan diagnostics and ClickHouse hourly event-count equality with PostgreSQL.
- `portable/queries.py`: canonical column definitions, all 15 workload SQL definitions, exact UTC windows, and the query renderer. `render(..., custom_windows=...)` supports additional unseen windows.
- `portable/runner.py`: `ch_rows` converts integer, decimal and timestamp JSON results; `result_digest` hashes an unordered multiset while preserving duplicate rows and nulls. Use these semantics for old-result comparison.
- `/tmp/analytics-cloud-comparison/run.py`: raw JSON projection and existing query adapter. Importing loads credentials and private query parameters but does not itself connect. **Never run its main function or call `postgres()`: these connect to PostgreSQL.**
- `/tmp/analytics-cloud-comparison/check.py`: synthetic raw normalization and workload fixtures. Its main function also connects to PostgreSQL; adapt the fixture logic for ClickHouse and local DuckDB only.
- `/tmp/analytics-benchmark/private-params.json`: existing private user/session/tab selections. Do not publish those values.
- `.env.local`, parsed by `/tmp/analytics-clickpipe/api.py:read_settings`, provides `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`. The existing HTTPS endpoint is in `run.py`. No secret values belong in committed scripts or reports.

Inspection did not issue any PostgreSQL query. Attempts to import the existing harness failed before networking: system Python lacks psycopg; `/tmp/analytics-perf-venv/bin/python` has dependencies but DuckDB needs a discoverable `libstdc++.so.6`. A standalone stdlib HTTP client avoids both imports. A local DuckDB fixture run can instead set its library search path to an installed compatible library.

## Dataset boundary and build cost

For the original hour/day workloads, a contiguous cohort of `lesswrong.com` events from **2026-08-31 00:00:00 UTC inclusive to 2026-09-08 00:05:00 UTC exclusive** preserves every join interval. Main windows are September 7 00:00–01:00 and September 7–8.

`metadata_join` needs metadata from seven days before each page through five seconds after it. `ssr_association` needs page loads from five seconds before each SSR through five minutes after it. Copying only September 7 would silently change answers. The eight-day cohort also permits additional earlier unseen hour/day windows, but those windows need an earlier lookback if metadata joins are included.

A narrower alternative copies all September 7 events, only `tabStarted`/`ssr` lookback events from August 31, and `pageLoadFinished` events in the first five minutes of September 8. This is a workload-specific dataset and must be labeled accordingly. Prefer the contiguous cohort if its storage/build cost is acceptable.

The source has 2,315,652,132 rows, `ORDER BY tuple()`, and no partition key. A bounded timestamp predicate still scans all timestamp values. Historical diagnostics measured a timestamp-only scan at 99 seconds and 18.5 GB read. The JSON column occupied about 118 GB compressed and 772 GB uncompressed across the whole source. Use explicit timestamp/environment PREWHERE during the one source-to-pilot copy, bounded execution/memory, and sequential builds. The cohort row count and copy duration have not been measured. Do not claim the copy is cheap merely because its output is bounded.

Source IDs are `Nullable(Int64)`, timestamps `DateTime64(6)`, environment/event type `String`, payload `String`; the source also has three PeerDB bookkeeping columns. Preserve ID nullability, exact decimals, and null versus empty string when building typed columns. The existing raw adapter uses `Nullable(String)` JSON extraction, exact decimal parsing, URL-origin stripping, and the fixed `welcomeBoxABTest` variant key. Reuse its semantics.

## Candidate sequence

1. Create one immutable raw cohort with the original five analytical columns and `ORDER BY tuple()`. Preserve its source ordering as far as practical and record this limitation: a small copy cannot reproduce every physical property of the full source.
2. Capture raw cohort aggregate hashes for all 30 original cases. Compare completed hashes to saved PostgreSQL results immediately. The raw cohort supplies the reference for cases PostgreSQL did not finish.
3. Create independent raw cohort copies for timestamp minmax and lightweight `(environment,timestamp)` projection experiments, keeping an unmodified raw reference. Define the projection with `_part_offset`; optionally measure a hybrid with event type stored. Materialize on the pilot only and record build time, status, bytes, and actual EXPLAIN selection.
4. Build a typed table with monthly partitions and `ORDER BY (environment,occurred_at,event_type)`; environment can remain nonnullable because the source is nonnullable. Store nullable user/client/session/tab/path/feed-item/user-agent/variant columns and exact expansion values. Run unchanged canonical SQL and require hash equality.
5. Measure event-first and identity-first projections only for cases that remain costly; verify the optimizer actually uses them. Each projection should have a measured query benefit and storage/build cost.
6. Optimize joins separately. A compact metadata table ordered by environment/tab/time can reduce the metadata side. Preserve the latest candidate ordering `(occurred_at DESC,event_id DESC)`, the +5-second allowance and seven-day lower bound. A funnel rewrite can aggregate per tab/feed item once, but must preserve exposure eligibility and expansion ordering.
7. Build exact hourly event/traffic rollups with mergeable `uniqExact` states. Daily distinct clients require state merging, never summing hourly distinct counts. Rollup queries must handle the original windows exactly; arbitrary partial-hour windows need raw edges or must be explicitly unsupported. Report materialization cost separately.

## Repeat protocol and interpretation

Use sequential requests on the same node, one warmup and at least three measured repeats per case, a seeded shuffled layout/case order, and a second shuffled pass after the first comparison. Include additional unseen windows for pruning evidence. Disable result cache and condition cache for the primary comparison; optionally measure condition caching in a separate labeled pass. Keep `join_use_nulls=1`, exact distinct implementation, UTC, and explicit query/memory limits.

Record client execute/fetch duration, server duration, rows/bytes read, selected parts/granules, result hash, peak memory where available, query ID and error/cancellation status. Reuse a connection for the new harness, but label comparisons to old PostgreSQL and ClickHouse client results carefully because the old ClickHouse adapter included TLS connection setup. Do not convert old PostgreSQL EXPLAIN server timings into speedups against client timings.

The node previously exposed two cores and 8 GiB memory; PostgreSQL hardware is unknown. A pilot victory does not establish billion-row scaling. Report original-window matches, pilot layout wins, preprocessing costs, and unknowns separately. Empty SSR cohorts are diagnostics, not representative successful analytics workloads.

## Remaining checks

Live grants and current metadata remain unverified by this inspection. Read-only metadata should establish CREATE/INSERT/ALTER privileges, current version/settings, source activity and available storage. User authorization already covers isolated benchmark mutations. Source table mutations, full-source materialization, global cache eviction and service resizing are unnecessary for this pilot.
