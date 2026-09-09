# Analytics workload baseline

For repeatable comparisons across tuned PostgreSQL, ClickHouse, DuckDB/Parquet, and StarRocks, use the [portable performance suite](portable/README.md) and its [tuning protocol](portable/TUNING.md). The [long-range report](long-range/README.md) contains the week, month, six-month, and 24-monthly-day raw PostgreSQL measurements.

Measured read-only on 2026-09-08 against the configured analytics PostgreSQL 15.17 database. SQL targets `lesswrong.com`, the completed UTC day 2026-09-07, and its first hour. Historical SSR association uses 2023-10-03 00:00–01:00 UTC. No database objects or data were changed.

## Results

Execution times below are server milliseconds from `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)`. A timeout is a censored observation, not a measured completion time. First attempts are **not cold-cache measurements**: discovery and earlier queries may have warmed relevant pages. Later attempts benefited from earlier work, including canceled scans. Fast successful queries received up to three repetitions. Slow successful queries were not repeated. This is a single-client baseline, not a concurrency or percentile study.

| Case | Server execution milliseconds, in attempt order |
| --- | --- |
| `time_range_1h` | >5000 (timeout); then 408.1, 582.3, 393.8 |
| `user_1h` | >5000 (timeout); then 629.8, 110.1, 164.8 |
| `session_1h` | >5000 (timeout); then 116.7, 183.8, 155.3 |
| `tab_1d` | 1713.4 |
| `feature_1d` | >5000 (timeout); then >15000 (timeout) |
| `ab_assignments_1d` | >5000 (timeout); then >15000 (timeout) |
| `ua_bot_1d` | >5000 (timeout); then >15000 (timeout) |
| `ssr_raw_1d` | 0.1, 0.1, 0.1 |
| `traffic_1h` | 51.1, 17.9, 22.7 |
| `traffic_1d` | >15000 (timeout) |
| `ab_assignments_1h` | 127.2, 58.2, 57.8 |
| `ua_bot_1h` | 63.5, 66.2, 64.8 |
| `feature_1h` | 2.2, 2.5, 2.6 |
| `tab_metadata_join_1h` | >15000 (timeout) |
| `ab_outcome_1h` | 3186.0 |
| `ssr_historical_join_1h` | 6987.9 |
| `post_paths_1h` | 66.5, 297.0, 202.6 |
| `feature_funnel_1h` | 32.2, 17.9, 35.6 |
| `tab_metadata_materialized_1h` | >15000 (timeout) |
The zero-row current SSR check is a coverage diagnostic and must be excluded from performance comparisons. Syntax-error traffic drafts, the original path query that missed absolute URLs, the earlier nullable-tab funnel, and a superseded metadata implementation are excluded from these published results.

## Findings

- One-hour traffic contains 2,345 initial loads and 1,066 navigations; this is event traffic, not deduplicated page views. One-day aggregation still exceeded 15 seconds despite the event/time index.
- The selected populated user filter returned 73 events but examined 187,100 rows: 187,027 were removed by filtering. Its first successful run touched 63,940 shared hit blocks and read 890 blocks. The session filter likewise scans the timestamp range; it lacks the tab lookup's selective expression index.
- A selected tab returned 15 events across the day in 1.713 seconds, reading 4,730 shared blocks. One sampled identity is not representative of all users or tabs.
- Narrow feature queries were fast: 1,415 `ultraFeedItemViewed` events and 19 expansion events in the hour. The linked logged-in cohort contains 530 distinct tab/item exposures and 19 with a subsequent positive expansion. Multiple view-duration emissions are deduplicated. This describes observed behavior, not causal feature effectiveness.
- Joining page events to tab metadata exceeded 15 seconds for both indexed per-page lookups and a set-based join over a seven-day metadata window. Estimated plans are retained; canceled queries do not supply actual buffers or row counts. A timeout cannot by itself establish whether scanning, matching, sorting, or another operation dominated.
- Experiment assignments in the hour: 3,493 control tab starts and 3,230 welcome-box tab starts. The descriptive subsequent-navigation query found 160 and 184 tabs respectively and took 3.186 seconds. Follow-up is truncated at the hour boundary; tabs are not independent randomized users. These numbers are not an A/B-test effect estimate.
- User-agent regex classified 99 tab starts as bot-like and 6,624 as not matched. “Not matched” is not verified human traffic. Missing metadata is kept as `unknown` in enrichment queries. JavaScript event telemetry misses bots that never execute the client.
- There were no raw SSR events in the current day. PostgreSQL statistics show historical snapshots: `ssr` in January 2021, `ssr_with_stats` in August–September 2021, and `ssrs_cleaned` in September–October 2023. These are statistics bounds, not verified full minimum/maximum dates. The historical benchmark found 3,512 SSR rows, 1,140 with a same-tab page-load event in the allowed time interval, taking 6.988 seconds and reading 10,321 shared blocks. This is temporal tab association, not an exact request correlation: multiple SSRs may associate with one load.

## Query semantics

- All time intervals are half-open; raw timestamps have PostgreSQL `timestamp without time zone` type and benchmark literals are interpreted as UTC by convention.
- User/session/tab benchmark identifiers were selected from a populated timer event during the fixed hour and retained only in a protected temporary file. They are redacted in plans and absent from SQL files.
- Path filtering selects the destination of navigation, URL of initial load, or timer path, stripping an absolute HTTP(S) URL's origin before matching `/posts/%`.
- Feature exposure/outcome join uses environment, tab ID, and feed item ID; only logged-in, linkable exposures count. An expansion must have `expansionLevel > 0` and occur after the first view within the same hour. Late-hour cohorts have shorter observation windows.
- Tab metadata is the latest `tabStarted` on the same environment/tab in the preceding seven days, allowing five seconds of ingestion skew. This is a benchmark assumption, not a guaranteed telemetry clock contract. Missing older metadata remains unknown. Selection of one metadata row per page prevents fanout. Both metadata queries have equivalent selection semantics.
- The historical SSR association checks environment/tab and page-load timestamp from five seconds before SSR to five minutes after SSR. No exact request identifier was verified.
- JSON user-agent extraction uses `tabStarted.userAgent`; assignment extraction uses `tabStarted.abTestGroups.welcomeBoxABTest`, both observed in actual bounded samples and checked against client instrumentation.

## Reproduce

Requires Node supporting `node:util.parseEnv` and PostgreSQL `psql`. The runner imports no application code. It loads `.env.local` relative to the repository root, obtains `private_analytics_connectionString`, and supplies connection credentials through child-process environment variables. It forces read-only transactions, a 10-second connection timeout, and a statement timeout of 5 seconds by default, capped at 15 seconds.

List cases without connecting:

```sh
node docs/analytics-benchmark/run.mjs
```

Run selected cases sequentially:

```sh
ANALYTICS_TIMEOUT_MS=15000 node docs/analytics-benchmark/run.mjs traffic_1h feature_funnel_1h
```

Set `PSQL_BIN` if `psql` is not on PATH. This machine used `/nix/store/y37nxb0qmpjsqqh1mk5jbpl2h3f28qj9-postgresql-17.11/bin/psql`. `ANALYTICS_ENV_FILE` overrides the settings file. `ANALYTICS_RESULTS_FILE` overrides `/tmp/analytics-benchmark-results.json` (created with mode 0600). `--all` explicitly runs the entire suite.

For user/session/tab cases, set `ANALYTICS_PARAMS_FILE` to a mode-0600 JSON file outside the repository containing nonempty `user_id`, `session_id`, and `tab_id` string values. Choose these from an authorized, populated cohort in the benchmark window. Do not commit that file. The runner supplies these as psql variables and redacts them from saved plans. It executes only aggregate SELECTs after successful analyzed plans; no raw event payloads are saved.

`*.sql` files are the single source of query text; `suite.json` references them. `results.json` records estimated and actual plans, timing, buffers, aggregate results, and per-attempt timeout limits. Client elapsed times include fresh process/connection setup and plan transfer, so they do not measure application pool or UI behavior.

## Next comparison

Keep this fixed logical dataset and these query semantics for PostgreSQL tuning and DuckDB/Parquet. Export the fact window plus the preceding seven days of tab metadata; otherwise enrichment comparisons will differ. Historical SSR is a separate historical dataset. Preserve typed dimensions and original IDs for joins, validate aggregate agreement, and compare first/repeated execution separately. Include export time, data freshness, storage and source database load. This task has not exported data or measured DuckDB.

## Longer ranges

The [long-range follow-up](long-range/README.md) measures week, month, six-month, and 24 monthly first-day windows. Its direct coverage probes also identify raw SSR events during 2024–2025; historical snapshot statistics above should not be read as the full raw-table coverage.
