# Core pilot handoff

Historical stage record. The completed experiment and final validation are in [FINAL_HANDOFF.md](FINAL_HANDOFF.md).

Objective: optimize/test ClickHouse against saved PostgreSQL evidence without any new PostgreSQL activity. Production `default.public_raw` is unchanged. All mutations are isolated under `benchmark_20260910`.

Core builds completed:

- Raw contiguous eight-day cohort: source copy 182.04s.
- Raw minmax candidate: copy 19.94s, timestamp minmax materialization 6.13s.
- Raw lightweight time projection candidate: copy 19.51s, materialization 10.16s. Projection name `time_order`, `SELECT _part_offset ORDER BY (environment,timestamp)`.
- Typed candidate: 38.25s extraction/copy, monthly partitions, `ORDER BY (environment,occurred_at,event_type)`. Exact nullable IDs and `Decimal(38,6)` expansion values preserve raw adapter semantics.

Validation: local unit tests passed after initial red run. Live raw-normalization fixture passed. All 30 raw workload references completed and all 21 available saved PostgreSQL results matched. The 27-row local DuckDB semantic fixture passed all 15 original workload assertions. Live raw/typed semantic checks and timed measurements are tracked in their JSON artifacts.

APIs in `pilot.py`: `Client.query`, journaled `Client.mutate`, `sql_for`, `raw_projection`, `result_digest`, `save`. `Client.params` contains PRIVATE selection parameters; never print or persist them. No imported module can connect to PostgreSQL. `queries.py` is the only project module imported by the standard-library runner. `semantic_fixture.py` additionally imports DuckDB and safely copied pure original fixture functions, not the original PG-capable test module.

Core results: `baseline.json` contains raw references; `results.json` contains measured samples with hash checks; `summarize.py` produces `summary.json`/`summary.md`. `evidence.py` collects table/projection footprint, range/counts, mutation status, redacted plans and query-log counters (without query text). `build-journal.json` records each submitted mutation before network execution and preserves failures.

Next work after core handoff:

1. Inspect full pass and selected projection/granule evidence. Run a second shuffled core pass with `pilot.py benchmark --passes 2`; existing pass 0 slots are skipped, pass 1 is fresh. It uses 1 warmup + 3 measured repeats.
2. Additional unseen time windows: pass tuples `(label, start_utc, end_utc)` through `sql_for(..., custom_windows=...)`. Windows within September 7 preserve metadata lookback; earlier windows require earlier metadata coverage and must omit that workload or expand coverage explicitly. Label new-window hashes against raw pilot only, not old PG windows.
3. Event-first/identity-first projections on separate typed pilot copies where costs justify them. Record materialization duration/storage and optimizer selection.
4. Compact metadata table and exact funnel rewrite, preserving canonical tie/order/time/null semantics; compare all outcomes and synthetic edge cases.
5. Exact hourly rollups using mergeable `uniqExact` states for daily distinct clients; label preprocessing cost separately and handle partial-hour edges correctly or explicitly reject them.
6. Integrate findings into comparison report, separating pilot scaling, original full-source evidence, connection overhead, unknown PG hardware and empty SSR cohorts.

Do not retry a failed INSERT blindly. Check build journal query ID, server processes, query log and existing table rows first. Source copy succeeded; there is no need to scan PostgreSQL or recopy the full ClickHouse source. Local DuckDB requires `LD_LIBRARY_PATH=/nix/store/ab3753m6i7isgvzphlar0a8xb84gl96i-gcc-15.2.0-lib/lib` with `/tmp/analytics-perf-venv/bin/python` in this environment.

Operational note: the first sandboxed metadata attempt failed DNS resolution. An escalated read-only attempt then stalled awaiting an HTTP response and was interrupted; no writes had been attempted. The next metadata run completed, and `system.processes` showed no earlier pilot requests before cohort creation. Network escalation was approved. No cohort INSERT was interrupted or retried.

## Completed initial stage

- Core pass 0: **480/480 requests complete**, all 480 match raw reference; all **336/336** observations with saved PostgreSQL hashes match. Each layout/case has one warmup and three measured repeats.
- Live semantic fixture: all **15/15 workloads**, both raw and typed, match local DuckDB. `semantic-fixture.json` preserves query IDs and hashes.
- `evidence.json` contains logs for **all 480 timed-pass query IDs**, so peak memory/server time/selected marks are available without missing-replica gaps.
- Cohort: **13,711,369 rows**, no null IDs, all nine UTC date slices recorded. No SSR rows anywhere in the cohort; retain synthetic SSR fixture as semantic evidence and do not generalize zero-SSR benchmark wins.
- Storage bytes: raw 647,932,914; minmax 650,871,350; projection 694,635,275 (43,300,011 projection bytes); typed 220,469,912. All main layouts have identical row counts. Raw/minmax/projection each have five active parts; typed has seven across two months.
- Source copy query log: 181,966ms server time, 2,315,652,132 rows / 75,993,340,118 bytes read, 13,711,369 rows / 5,201,184,642 bytes written, 880,376,160 peak query-memory bytes.
- EXPLAIN confirms timestamp minmax selects 472/1675 granules for hour event counts; typed selects 12/1675. Lightweight projection is explicitly selected with 13 projection marks / 106,496 candidate projection rows and two parts filtered. Read `EXPLAIN indexes=1, projections=1`: indexes alone omits lightweight projection filtering. Projection marks are not the same as final base-table read granules; use query-log/HTTP read counters too.
- Typed median client examples: feature funnel/day 310.2ms (raw 1612.5ms; saved PG 7496.4ms), AB outcome/day 422.0ms (raw 2070.4ms; saved PG 8486.7ms), metadata/day 1762.1ms (raw 5037.5ms). Typed feature counts/day 185.5ms remains slower than saved PG 116.6ms. Do not conflate saved-client, server or full-source comparisons.
- All four local tests pass, Python compilation passes, private identity leak scan found no matches in persisted artifacts. No unrelated tree files changed.
- No active build or benchmark process remains. The next stage owns the second pass, unseen-window testing and advanced candidates.

Projection EXPLAIN syntax verified against [ClickHouse official projection documentation](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/data-modeling/projections/1_projections.md). The live plan confirms selection; the documentation only informed how to display it.
