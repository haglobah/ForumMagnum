# Long-range analytics benchmark

Extends the [short-range baseline](../README.md) with the same workload definitions. Measurements are read-only and sequential. The fixed end is 2026-09-08 00:00 UTC.

| Profile | Included UTC timestamps |
| --- | --- |
| Week | [2026-09-01, 2026-09-08) |
| Month | [2026-08-08, 2026-09-08), one calendar month |
| Six months | [2026-03-08, 2026-09-08) |
| Monthly first days | 24 separate [day 1, day 2) intervals, October 2024 through September 2026 |

The monthly query expresses 24 separate index-eligible timestamp ranges, rather than a day-of-month filter over two contiguous years. PostgreSQL still chooses the physical scan strategy. Literal timestamp bounds allow the planner to estimate each range separately. Each output includes its input window bucket. Joins and cohorts are evaluated within each window; monthly cohort attribution cannot cross into another selected month.

## Measured results

Measured on 2026-09-08. Successful values are server execution time from `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)`. `>15 s budget` means the statement did not complete within its 15-second budget, which includes planning; it is not a completed execution time. All estimated-plan requests succeeded.

| Workload | Week | Month | Six months | 24 first days |
| --- | --- | --- | --- | --- |
| `coverage` | 2.960 ms | 13.154 ms | 14.602 ms | 400.611 ms |
| `time_range` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `traffic` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `user` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `session` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `tab` | 0.296 ms | 0.283 ms | 10.206 ms | 1222.701 ms |
| `post_paths` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `feature` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `feature_funnel` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `ab_assignments` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `ab_outcome` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `ua_bot` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `tab_metadata_join` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `tab_metadata_materialized` | >15 s budget | >15 s budget | >15 s budget | >15 s budget |
| `ssr_raw` | 39.296 ms | 19.241 ms | 3.507 ms | >15 s budget |
| `ssr_historical_join` | 0.114 ms | 0.115 ms | 0.156 ms | 31.391 ms |

The tab lookup returns the same 43 events across the rolling ranges. It uses the existing `raw__index_tab_id` index. The 24-day fixed-tab query returns 24 empty buckets and is a coverage diagnostic, not evidence of fast representative historical lookups. All rolling SSR checks return zero; the `ssrs_cleaned` snapshot query also returns zero for every selected monthly day.

The three additional monthly queries—exact daily traffic, raw SSR/page-load association, and historical SSR-or-tabStarted metadata enrichment—also exceeded the 15-second budget. Their SQL and estimated plans are recorded. No complete 24-day traffic comparison was produced within that budget.

See [results.json](results.json) for all 67 primary cases, exact SQL/hashes, estimated plans, available actual buffer and temporary-file statistics, client elapsed time, and output-query status. Empty or canceled cases must not be mixed with populated successful cases when comparing engines.

## Longer-budget diagnostics

Both selected traffic queries also failed to complete within a **60-second statement budget**:

| Query | Budget | Outcome |
| --- | --- | --- |
| Week, hourly traffic and distinct clients | 60 seconds | Timed out |
| 24 monthly first days, daily traffic and exact distinct clients | 60 seconds | Timed out |

These are single additional attempts, not completed runtimes. The second query returns one daily aggregate per selected month when allowed to finish; its timeout means no complete 24-row comparison was obtained. [extended-results.json](extended-results.json) records both attempts with matching SQL hashes, estimated plans, and client elapsed times. These stronger bounds do not establish that month or six-month queries would finish sooner than the week query.

## Observed historical coverage

| Event family | Selected days with at least one event | Observed selected-day span |
| --- | --- | --- |
| Initial page loads, navigation, timers | 24 / 24 each | October 2024–September 2026 |
| UltraFeed views and expansions | 14 / 24 each | August 2025–September 2026 |
| `tabStarted` | 11 / 24 | November 2025–September 2026 |
| Raw `ssr` | 13 / 24 | October 2024–October 2025 |

These are direct probes of the 24 requested days, not deployment dates or proof of coverage on every intervening date. The complete per-day, per-event checks and sampled-field flags are in [coverage.json](coverage.json). Raw SSR samples on the earlier 13 days contain tab IDs, user agents, and A/B-group fields. Therefore older user-agent/A/B metadata exists, but the baseline tabStarted-only queries cannot access it.

The separate `tab_metadata_historical` query combines SSR and tabStarted metadata, retains the chosen metadata source in its output, and preserves unknown matches. It uses the same seven-day lookback and five-second tolerance. This supports investigation across the instrumentation transition; it does not establish identical experiment definitions or semantics across that transition. The separate `ssr_raw_join` query associates raw SSR rows with same-tab page loads within -5 seconds/+5 minutes, rather than querying the obsolete snapshot.

This updates the short-range report’s coverage picture: its current-day SSR absence was correct, but historical snapshot statistics did not establish absence of SSR events in the main raw table during 2024–2025.

## What these measurements establish

Existing event/time indexes are selected for many broad queries, while user/session lookups scan a timestamp range and filter JSON. The selective tab index provides a working fast path. The measurements do not rank the cost of the canceled queries or identify which operator dominated them; the estimated plans alone cannot answer that.

For a DuckDB/Parquet comparison, preserve these exact date windows and event definitions, include raw SSR for historical metadata, and include the seven-day metadata lookback plus five seconds of forward tolerance. SSR association also needs page loads from five seconds before each selected start through five minutes after each selected end. Monthly distinct clients must be calculated per selected day, not summed from hourly distinct counts. Measure import/refresh cost separately. A comparison of a completed DuckDB query against a PostgreSQL timeout can establish only a lower-bound speedup.

Early development attempts using parameterized window wrappers were excluded because those wrappers could hide literal range selectivity from the planner. The published primary measurements all use the final literal-bound renderer and matching SQL hashes.

## Interpretation

- Timeouts are censored execution attempts, not successful runtimes or evidence that a specific plan operator dominates. Estimated plans are retained; canceled EXPLAIN ANALYZE executions cannot provide actual buffer statistics.
- Runs share the database and its cache with other work. Client elapsed time includes connection and transfer overhead. These are neither cold-cache measurements nor latency percentiles. No concurrency benchmark is included.
- User, session, and tab filters retain the original private sampled IDs from September 7. Rolling windows include the original sample. Monthly first-day windows exclude September 7, and those fixed-identity queries are diagnostic only: a fast empty result is not representative history-reconstruction performance. One identity does not represent the population.
- Coverage probes inspect the first event of each selected type in each window. Event absence is established by the bounded probe; field booleans describe that sampled event only, not every event or complete schema availability. An unknown probe after timeout is not an absent event.
- Git history places session instrumentation in July 2025, ultraFeedItemViewed in July 2025, and tabStarted in September 2025. Commit dates do not establish deployment dates. Earlier missing instrumentation must not be interpreted as zero feature adoption, assignments, or human traffic.
- Missing user agents remain unknown. Regex-unmatched user agents are not verified humans. The tabStarted-based classification deliberately retains the baseline definition instead of silently switching older months to page-load user agents.
- Feature funnels deduplicate logged-in tab/item exposures, exclude collapse events, and allow expansion from the first exposure until the selected window ends. Longer windows therefore change follow-up duration. All outcomes are right-censored at the window end and descriptive, not causal estimates.
- A/B outcomes use the earliest tab assignment within each selected window and subsequent navigation before that window ends. Metadata enrichment separately allows seven days of lookback and five seconds of forward tolerance relative to each page event, matching the baseline. The set-based variant deduplicates metadata matches by page event ID.
- Hourly traffic preserves baseline semantics. Distinct clients are calculated within each hour and cannot be summed to obtain distinct clients across a day or month.
- The raw SSR count is populated for 13 monthly first days; it is empty in the three rolling profiles. The old ssrs_cleaned association is a coverage diagnostic in all requested profiles. The new raw SSR association is a separate populated historical workload. Same-tab temporal association is not exact request correlation.

## Reproduce

The standalone Node runner reads `.env.local` by default, without importing application code. It accepts explicit case names or `--all`; invoking it without arguments only lists cases. SQL templates are under `templates/`, with workload definitions in `suite.json`.

```sh
ANALYTICS_PARAMS_FILE=/tmp/analytics-benchmark/private-params.json \
ANALYTICS_RESULTS_FILE=/tmp/analytics-long-range-results.json \
node docs/analytics-benchmark/long-range/run.mjs week/traffic monthly_first_days/traffic
```

Optional environment variables: `PSQL_BIN`, `ANALYTICS_ENV_FILE`, `ANALYTICS_TIMEOUT_MS`, and `ANALYTICS_RESUME=1` to skip cases already in the selected result file; resuming rejects a matching case name if its SQL hash or timeout differs. Private parameters are `user_id`, `session_id`, and `tab_id`; they are needed only when selecting those cases and remain outside the repository. The runner redacts their values from plans/results.

`--render` writes canonical parameterized SQL with SHA-256 hashes to `/tmp/analytics-long-range-rendered.json` without connecting. Each recorded execution also includes its exact parameterized SQL and hash, preserving provenance when a template changes. Successful EXPLAIN ANALYZE executions are followed by a separate aggregate-output execution; its status and elapsed time are recorded separately. A second output execution can time out even when the first succeeded.
