# ClickHouse Cloud versus analytics PostgreSQL — September 10, 2026

## Completed optimization pilot

**ClickHouse can be substantially faster on these workloads with a suitable layout.** The completed bounded pilot found repeatable gains from typed time-sorted columns, compact historical metadata and exact hourly rollups with small granules. PostgreSQL was not queried again; comparisons use its saved results.

The isolated cohort contains **13,711,369 rows**, preserving the original windows and their join lookback/follow-up. Across **2,616 benchmark requests**, every result matched the raw ClickHouse reference; all **1,192 observations with saved PostgreSQL evidence** matched it. Original candidates received two shuffled passes, each with one warmup and three measured repeats. Four new timestamp predicates—including a partial-hour range—also passed. Both query and condition caches were disabled.

Core client medians below pool six measured samples from two passes on the same pilot:

| Workload | Raw ClickHouse | Typed, time-sorted ClickHouse | Saved PostgreSQL |
|---|---:|---:|---:|
| event_counts/hour | 411.6 ms | 84.4 ms | 141.5 ms |
| feature_funnel/day | 1562.1 ms | 314.2 ms | 7496.4 ms |
| ab_outcome/day | 1935.9 ms | 428.7 ms | 8486.7 ms |
| feature_counts/day | 864.8 ms | 189.0 ms | 116.6 ms |

Independent advanced repeats confirmed compact metadata at **611.3 ms/day (2.68× its same-pass typed control)**, a one-pass funnel at **263.4 ms/day (1.19×)**, and fine exact traffic rollups at **82.8 ms/day (2.50×)**. Coarse rollups regressed for hourly traffic; finer granules corrected that regression. Event/identity projections mostly gave small or absent gains, despite some being selected.

On the previously unqueried **September 7 10:00–11:00 UTC predicate**, typed event counts read **73,728 rows at 80.5 ms**, versus all **13,711,369 raw pilot rows at 407.1 ms**. This verifies pruning without condition-cache reuse. The partial-hour range passes raw/typed and join rewrites; rollups explicitly reject it.

Prefer the typed time-sorted layout as the broad candidate, compact metadata for the historical join, and fine exact rollups for stable hour-aligned summaries. Typed sorting, partitioning and extraction were tested together; their individual contributions are not isolated. Rollups/metadata are static backfills, with no live refresh or ingestion cost measured. All build/storage costs and negative findings are retained in the detailed report.

**Limits:** this is an eight-day cohort, not a full 2.32-billion-row build or an equal-cost engine comparison. PostgreSQL hardware and a shared transactional snapshot are unavailable; saved equality covers 21 original case/window outputs. The new ClickHouse harness reuses HTTPS connections. Source-copy clustering differs from the original table, and typed storage omits full JSON payloads. The cohort contains no SSR events, so its SSR timings are not representative. Source DDL and part totals remain unchanged. An unresolved initial advanced-query-log gap is preserved; every independent repeated benchmark request has server logs.

[Final detailed report](clickhouse-pilot/FINAL_REPORT.md) · [Machine-readable summary](clickhouse-pilot/final-summary.json) · [Per-query new-window evidence](clickhouse-pilot/novel-results.json) · [Final operational checks](clickhouse-pilot/final-verification.json)

---

## Original full-source investigation (before optimization pilot)

The imported layout and the original measurement protocol both contributed to the uniform timeouts. **This is not evidence that ClickHouse cannot execute these workloads quickly.** A completed warmup changed the exact hourly event-count benchmark from 38.1 seconds to a 60.6 ms median on the server. Its aggregate results matched PostgreSQL exactly.

## Findings and controls

| Check | ClickHouse server time | Rows read | Result |
| --- | ---: | ---: | --- |
| Metadata-only total count | 1.6 ms | 1 metadata row | 2,315,652,132 stored rows |
| One-hour count, timestamp column only | 98.927 s | 2,315,652,132 | 187,100 matches across environments |
| Direct one-hour event counts, no adapter or JSON extraction | 73.686 s | 2,315,652,132 | 86,679 LessWrong events across 84 event types; exact PostgreSQL match |
| Exact direct-query repeat, condition cache enabled | 62.6 ms | 1,261,568 | Exact PostgreSQL match |
| Same direct query, condition cache disabled | >15 s, server timeout | 521,461,760 before cancellation | No completed result |
| Exact portable adapter, extended 120-second limit | 38.070 s | 1,324,992,332 | Exact PostgreSQL match; already partly warmed by earlier probes |
| Same adapter, three subsequent repeats | 59.2–65.3 ms | 1,245,184–1,277,952 | All three exactly match PostgreSQL |

For the exact `event_counts/hour` workload, the three-repeat **client** medians were **262.2 ms on ClickHouse and 141.5 ms on PostgreSQL**. ClickHouse includes fresh HTTPS connection setup; PostgreSQL uses an established connection. Do not compare the 60.6 ms ClickHouse server median directly with PostgreSQL’s client median. This warmed comparison covers one workload, not the entire suite. It follows uncontrolled earlier cache activity, not a cold-cache experiment.

### Contributing factors

1. **The raw table was imported without an access path for time filters.** The stored import request has `sortingKeys: []`, `useCustomSortingKey: false`, and no partition key. Actual DDL is `ORDER BY tuple()`. The table has no primary key or partition key. A simple one-hour filter selects all 17 parts and 282,679 data granules. No excessive-small-part problem was observed.
2. **The serving node has limited scan CPU.** Its actual cgroup quota is two CPU cores and 8 GiB RAM; `max_threads=2`. The cache-disabled control consumed 27.43 CPU seconds in 15 wall seconds, reading 2.30 GB from the filesystem cache and zero from its source. Together with the direct no-JSON controls, this points to CPU scan/decompression work over cached columns. We did not collect a CPU flamegraph, so individual function costs are not established.
3. **The short warmup cutoff hid repeated-query performance.** The initial protocol abandoned a case after a 15-second warmup timeout. All 30 ClickHouse cases stopped there, while PostgreSQL completed 21 and timed out on nine. Those observations measure failure to produce an initial result within the budget; they do not describe warmed steady-state latency. We should have paused after the first few uniform failures to investigate this distinction.
4. **Condition-cache reuse depends on the filter execution plan.** After a completed direct scan, that query became fast. The adapter did not reuse the same warmed condition and still timed out. After its own extended execution, all three adapter repeats were fast, with 17 condition-cache hits each. Turning the cache off on the direct query restored the timeout. An explicit timestamp `PREWHERE` rewrite and a repeat of timestamp-only `COUNT` still timed out at 15 seconds, so that rewrite is not a demonstrated general fix.

ClickHouse’s condition cache remembers which granules cannot satisfy a repeated filter; it does not cache the final aggregate answer. Result caching was disabled throughout. This explains the measured reduction in rows read. It also means a fast repeat is not evidence that a new time window will be fast. [Official condition-cache documentation](https://clickhouse.com/docs/concepts/features/performance/caches/query-condition-cache).

### Checks that ruled out other explanations

- SQL access is functional: metadata queries complete in milliseconds, and the direct event counts return the correct historical data. Server logs identify actual `TIMEOUT_EXCEEDED` errors (code 159), rather than transport failures masquerading as query timeouts.
- `EXPLAIN` shows the environment and timestamp filters pushed into `PREWHERE`. The predicates are not accidentally omitted by the adapter.
- The timestamp-only control contains neither JSON extraction nor CTEs, yet scans the whole table. Adapter overhead and JSON parsing are therefore not necessary causes of the long initial scan. Some join workloads independently select two or three copies of the table’s granules, adding further work.
- Synthetic SELECT-only fixtures passed before timing: all 15 workloads on both raw adapters matched the canonical DuckDB fixture, with exact IDs, decimals, timestamps and null behavior.
- Both direct and adapter hourly event counts matched PostgreSQL exactly. This validates that cohort; it does not prove full-import row equality or completeness for every historical range.
- The final active-query check found no other running queries. No schema, data, index, global setting or service sizing change was made during this investigation.

## Layout solutions and recommended next experiment

Start by comparing a **lightweight time projection** with a time-sorted copy on a representative bounded dataset. A projection is a promising first retrofit because it can index the existing raw table without duplicating its large JSON payload column. The measured server version, 26.2, includes the granule-level `_part_offset` projection pruning introduced in 25.11. This is a candidate to measure, not an already demonstrated speedup. [Official release details](https://clickhouse.com/blog/clickhouse-release-25-11).

| Option | Concrete layout | Benefit and tradeoff |
| --- | --- | --- |
| Lightweight time projection — first candidate | Sorting key `(environment, timestamp)` plus `_part_offset`; optionally store `event_type` too | Adds an access path to the existing table, using row offsets to fetch other columns. Avoids a second copy of the JSON payload. Still requires building the projection for existing data, and scattered reads can cost more than a fully ordered table. |
| Time-sorted analytics table — broader redesign | `ORDER BY (environment, timestamp, event_type)`; consider `PARTITION BY toYYYYMM(timestamp)` | Direct time-range pruning and physical locality. Monthly partitions help coarse pruning and retention. Requires a new ordered dataset and backfill; monthly partitioning alone is insufficient for selective hourly access. |
| Timestamp minmax skipping index — small candidate | `INDEX timestamp_minmax timestamp TYPE minmax GRANULARITY 1` | Small index that may exclude most granules if their timestamp ranges are narrow. It can be ineffective if most granules span wide time ranges. Test actual granule rejection before selecting this approach. Existing data needs index materialization. |
| Stored typed analytics dimensions | Extract user/session/tab IDs, normalized path, feed item ID, expansion level and relevant metadata during backfill | Removes repeated JSON parsing for analytical queries and permits additional identity-oriented projections. It does not by itself fix the full timestamp scan; implement it together with an access path. Preserve null/empty-string and exact-number semantics already checked by the fixture suite. |

Lightweight projections store the ordering key and offsets into the base table, and may also store selected payload columns. Existing data must be materialized before it benefits. [Projection documentation](https://clickhouse.com/docs/concepts/features/projections/projections).

A time-first key is a reasonable default here because every workload filters environment and time, and several do not filter event type. An event-first projection can be tested for event-specific workloads. If user/tab lookups or metadata joins remain slow after time pruning, test focused identity-oriented projections on stored ID columns. Do not add every possible ordering without measuring storage and write costs. [Primary-key guidance](https://clickhouse.com/docs/concepts/best-practices/choosing-a-primary-key), [skipping-index guidance](https://clickhouse.com/docs/concepts/features/performance/skip-indexes/skipping-indexes).

For the pilot, compare exact aggregate hashes, first completed execution, repeated execution, selected granules, rows/bytes read and build/storage cost. Run with condition caching disabled to isolate index/layout pruning, then separately enabled to measure repeated-filter behavior. Use the same hardware. A successful candidate should substantially reduce rows read for a previously unseen time window before a full 2.32-billion-row build is considered. No candidate layout, index or projection has been created yet.

[Detailed investigation evidence](2026-09-10-investigation.json) includes query plans, DDL, import mapping, resource limits, controlled timings, cache-hit counters and source hashes. Local control scripts and logs are in `/tmp/analytics-cloud-comparison/`.

## Initial 15-second-budget pass

**The following table is the initial censored pass, not a warmed engine ranking.** The successful warmed follow-up above supersedes any interpretation that every ClickHouse execution must exceed 15 seconds.

Measurements use the existing portable suite, with JSON fields projected into its canonical columns at query time on both databases. This tests the imported raw ClickHouse layout against the existing analytics PostgreSQL layout. It does not measure the earlier locally loaded, typed and sorted canonical tables.

| Workload/window | PostgreSQL repeated median, ms | ClickHouse initial attempt | Initial-pass aggregate agreement |
| --- | ---: | ---: | --- |
| `ab_assignments/day` | 702.7 | >15,000 (timeout) | Unavailable (incomplete) |
| `ab_assignments/hour` | 206.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `ab_outcome/day` | 8,486.7 | >15,000 (timeout) | Unavailable (incomplete) |
| `ab_outcome/hour` | 404.2 | >15,000 (timeout) | Unavailable (incomplete) |
| `coverage/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `coverage/hour` | 168.7 | >15,000 (timeout) | Unavailable (incomplete) |
| `event_counts/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `event_counts/hour` | 141.5 | >15,000 (timeout) | Unavailable (incomplete) |
| `feature_counts/day` | 116.6 | >15,000 (timeout) | Unavailable (incomplete) |
| `feature_counts/hour` | 67.7 | >15,000 (timeout) | Unavailable (incomplete) |
| `feature_funnel/day` | 7,496.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `feature_funnel/hour` | 349.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `metadata_join/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `metadata_join/hour` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `post_paths/day` | 1,028.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `post_paths/hour` | 104.6 | >15,000 (timeout) | Unavailable (incomplete) |
| `session/day` | 1,043.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `session/hour` | 148.8 | >15,000 (timeout) | Unavailable (incomplete) |
| `ssr_association/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `ssr_association/hour` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `tab/day` | 230.2 | >15,000 (timeout) | Unavailable (incomplete) |
| `tab/hour` | 76.9 | >15,000 (timeout) | Unavailable (incomplete) |
| `traffic_day/day` | 353.4 | >15,000 (timeout) | Unavailable (incomplete) |
| `traffic_day/hour` | 100.2 | >15,000 (timeout) | Unavailable (incomplete) |
| `traffic_hour/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `traffic_hour/hour` | 78.5 | >15,000 (timeout) | Unavailable (incomplete) |
| `ua_bot/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `ua_bot/hour` | 283.8 | >15,000 (timeout) | Unavailable (incomplete) |
| `user/day` | >15,000 (timeout) | >15,000 (timeout) | Unavailable (incomplete) |
| `user/hour` | 145.9 | >15,000 (timeout) | Unavailable (incomplete) |

## Initial-pass method and limits

- Fixed UTC windows: September 7, 2026, 00:00–01:00 and September 7–8. The existing private user/session/tab parameters were reused. Metadata joins retain their seven-day lookback and follow-up windows.
- Fifteen workload definitions, two windows, both engines. Sequential execution, case order shuffled with seed 1729; PostgreSQL precedes ClickHouse for each case. One warmup and three measured repetitions. An error or server timeout stops further repetitions for that engine/case. A timeout during warmup is recorded as an incomplete attempt, not a measured median.
- A 15-second server query limit on each engine; read-only execution. ClickHouse result cache disabled, exact distinct counts, UTC time zone and nullable joins enabled. Caches and concurrent service activity are uncontrolled. No cold-cache claim.
- Times include client execution and full result fetch, excluding result hashing. ClickHouse HTTPS connection setup is included; PostgreSQL connection setup is excluded. These are single-client observations, not p95 estimates.
- The initial import and live source are not a shared frozen snapshot. Compare only completed, populated cases with equal aggregate hashes. Zero-event SSR results are coverage diagnostics. Incomplete queries provide no aggregate agreement evidence.
- Before real-data timing, SELECT-only synthetic fixtures verified both raw projections against the canonical normalizer, including null versus empty strings, IDs above 2^53, decimal values and path normalization. All 15 workload fixtures on both servers matched the canonical DuckDB fixture.
- PostgreSQL: `PostgreSQL 15.17 on x86_64-pc-linux-gnu, compiled by x86_64-pc-linux-gnu-gcc (GCC) 12.4.0, 64-bit`. ClickHouse: `26.2.1.641`.
- ClickHouse raw import: 2,315,652,132 rows; 135,946,797,737 reported storage bytes (126.61 GiB); `SharedMergeTree` with an empty sorting key. JSON event payloads remain strings. PostgreSQL uses the existing JSONB table and indexes. No data, schema, indexes, or sorting configuration were changed.
- Both database services are in AWS us-east-1; client execution was from this workstation. The queried ClickHouse cluster reports one shard and one replica. The serving node exposes a two-core CPU quota and 8 GiB cgroup memory limit; max_threads is 2. The Cloud management API’s configured total-memory bounds do not describe this observed node allocation. PostgreSQL instance hardware was not measured. Hardware is not controlled.

[Per-attempt timings and aggregate evidence](2026-09-10-cloud-results.json). Local execution and fixture scripts: `/tmp/analytics-cloud-comparison/run.py` and `check.py`; their source hashes are retained in the evidence.

## Original PostgreSQL baseline

The older 19-case raw suite also ran on September 10. These are server execution times from EXPLAIN ANALYZE, so they must not be divided by the client timings above to calculate speedups. The older SQL and portable SQL also differ in some workload details. Successful cases received up to three attempts, with no further repetition when the first took more than one second; no separate warmup.

| Original case | Server execution, ms (attempt order) |
| --- | --- |
| `time_range_1h` | 7,090.426 |
| `traffic_1h` | 41.673, 13.176, 16.480 |
| `traffic_1d` | >15,000 (timeout) |
| `user_1h` | 75.427, 74.459, 71.193 |
| `session_1h` | 78.062, 79.188, 78.214 |
| `tab_1d` | 388.206, 187.726, 170.656 |
| `post_paths_1h` | 394.835, 827.935, 48.821 |
| `feature_1d` | 11,321.872 |
| `ab_assignments_1d` | >15,000 (timeout) |
| `ua_bot_1d` | >15,000 (timeout) |
| `ssr_raw_1d` | 10.401, 0.117, 0.103 |
| `feature_funnel_1h` | 4.401, 4.778, 4.421 |
| `ab_assignments_1h` | 37.591, 40.383, 35.288 |
| `ua_bot_1h` | 73.222, 39.153, 142.251 |
| `feature_1h` | 1.786, 1.798, 1.925 |
| `tab_metadata_join_1h` | >15,000 (timeout) |
| `ab_outcome_1h` | 2,214.096 |
| `ssr_historical_join_1h` | 4,406.441 |
| `tab_metadata_materialized_1h` | >15,000 (timeout) |

Original redacted plans and aggregate results remain at `/tmp/analytics-postgres-2026-09-10.json`.

## Access setup

The import reported `Completed`. Direct database credentials ultimately provided SQL access. Earlier Cloud Query API setup failed; no query endpoint was created or modified.
