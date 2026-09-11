# ClickHouse optimization pilot — final results

The bounded ClickHouse pilot demonstrates useful gains from time pruning, typed columns, compact historical metadata and fine-grained exact rollups. It does not establish full-retention or equal-cost superiority over PostgreSQL. **No additional PostgreSQL requests were made.**

## Protocol and correctness

All layouts use the same immutable 13,711,369-row ClickHouse cohort, covering August 31 00:00 UTC through September 8 00:05 UTC. Main windows are September 7 00:00–01:00 and the full September 7 UTC day. The extra coverage preserves seven-day metadata lookback and SSR follow-up. The raw copy is the reference; every candidate is derived from that copy. No source write, global-setting change or resize was performed.

Requests ran sequentially with a reused HTTPS connection, `max_threads=2`, UTC, exact distinct counting, `join_use_nulls=1`, and both result and condition caches disabled. Each original layout/case has at least two independently shuffled passes, each with one warmup and three measured repeats. Four new predicates also have one warmup and three measured repeats. These are warmed execution measurements, not controlled cold disk/cache tests. Shuffling occurs by layout/case block; within each block the four requests are consecutive.

| Stage | Timed/warmup requests | Exact raw matches | Saved PG matches / available | Query logs recovered |
|---|---:|---:|---:|---:|
| core | 960 | 960 | 672 / 672 | 960 |
| advanced_initial | 304 | 304 | 212 / 212 | 0 |
| advanced_repeat | 304 | 304 | 212 / 212 | 304 |
| fine_initial | 72 | 72 | 48 / 48 | 72 |
| fine_repeat | 72 | 72 | 48 / 48 | 72 |
| novel | 904 | 904 | 0 / 0 | 904 |

Raw references comprise 30 original cases and 60 new workload/window cases. Old PostgreSQL hashes are used only for the original windows where saved results exist; new windows are checked against fresh raw ClickHouse results. Hashes canonicalize an unordered multiset while retaining duplicates, exact numbers, timestamps and nulls.

Synthetic coverage includes all 15 canonical workloads against DuckDB and raw/typed ClickHouse, plus independent metadata/funnel/rollup fixtures. Four explicit edge assertions and 17 additional live comparisons verify anonymous-view eligibility, expansion ordering, seven-day and +5-second boundaries, exact ID tie ordering with a null-valued winner, empty windows, and daily distinct clients spanning hours. No candidate query correction was required.

## Same-pilot core controls

Client execute/fetch medians in milliseconds, six measured samples per cell (three in each pass). Typed combines physical sorting, monthly partitioning and extraction, so this experiment does not isolate those three effects. It stores only the benchmark dimensions, not the original full JSON payload; retaining that payload would add storage.

| Workload/window | Raw | Minmax | Time projection | Typed | Typed speedup vs raw |
|---|---:|---:|---:|---:|---:|
| event_counts/hour | 411.6 | 189.4 | 130.1 | 84.4 | 4.88× |
| traffic_day/day | 918.0 | 760.7 | 825.4 | 207.1 | 4.43× |
| feature_counts/day | 864.8 | 721.1 | 787.2 | 189.0 | 4.58× |
| feature_funnel/day | 1562.1 | 1171.4 | 1293.1 | 314.2 | 4.97× |
| ab_outcome/day | 1935.9 | 1586.9 | 1707.2 | 428.7 | 4.52× |
| metadata_join/day | 4657.3 | 4280.1 | 4359.3 | 1696.8 | 2.74× |
| user/day | 1232.8 | 972.5 | 1056.0 | 109.3 | 11.28× |

The original hour event-count plan selected 472/1,675 granules with minmax and 12/1,675 with typed ordering. The lightweight time projection was explicitly selected with 13 projection marks; its candidate projection rows are not base-table rows read. HTTP read counters and query-log selected marks are retained separately. Minmax benefits from the pilot’s existing timestamp locality; copying a bounded subset changes physical clustering and cannot predict its effectiveness on the full unsorted source.

## Independent advanced repeat

The following compares each candidate with the typed control measured in the same repeated pass. Client medians use three measured samples. Initial-pass results remain in the linked machine-readable evidence.

| Candidate/workload/window | Typed control ms | Candidate ms | Speedup | Candidate rows read |
|---|---:|---:|---:|---:|
| metadata/metadata_join/hour | 880.8 | 210.6 | 4.18× | 771,737 |
| metadata/metadata_join/day | 1636.9 | 611.3 | 2.68× | 4,130,253 |
| funnel/feature_funnel/day | 313.3 | 263.4 | 1.19× | 1,777,563 |
| user/user/day | 108.9 | 95.2 | 1.14× | 982,938 |
| event/feature_counts/day | 188.4 | 179.2 | 1.05× | 1,787,046 |
| rollup/traffic_day/hour | 84.4 | 153.9 | 0.55× | 9,245 |
| rollup_fine/traffic_day/hour | 84.4 | 73.6 | 1.15× | 128 |
| rollup_fine/traffic_day/day | 207.0 | 82.8 | 2.50× | 2,269 |
| rollup_fine/event_counts/day | 199.7 | 72.4 | 2.76× | 2,269 |

Compact metadata retains the full historical ranking/join rules; it is not a current/latest-metadata lookup. The single-pass funnel retains exposure eligibility and relative event times. Identity projections are selected but scattered offsets still read roughly 1.0–1.3 million base rows for the original day cases; selected projection rows alone overstate their benefit. Identity tests reuse one existing private selection per identity type, so they do not cover the distribution of user/session/tab selectivity; some new windows may have empty results. Event-first ordering is not selected for some selective feature/assignment predicates and offers small or absent gains overall.

The coarse exact-state rollup regressed for hourly traffic. Its default granule selected 9,245 state rows with expensive exact sets. The separate fine rollup uses `index_granularity=64`; the original hour reads 128 rows in 2/272 granules, and the original day reads 2,269 rows in 35/272 granules. This improves pruning while adding storage. Fine rollups merge `uniqExact` states across hours; they never sum hourly distinct counts.

## Previously unseen predicates

All 15 workloads were tested on raw, typed and event-projection layouts for each new September 7 UTC window: **10:00–11:00, 18:00–19:00, 04:00–09:00, and 13:17–15:43**. These are new actual timestamp predicates, not renamed original windows. Metadata, funnel, identity projections and raw time-index candidates were tested where applicable; coarse and fine rollups were tested on the three aligned windows. All three rollup workloads explicitly reject the partial-hour window, while canonical raw/typed queries and metadata/funnel rewrites pass it.

| New window | Typed event-count ms | Raw control ms | Typed read rows | Fine daily-traffic ms | Coarse daily-traffic ms |
|---|---:|---:|---:|---:|---:|
| new_10h | 80.5 | 407.1 | 73,728 | 71.5 | 230.4 |
| new_18h | 83.6 | 398.5 | 98,304 | 70.6 | 152.7 |
| new_04_to_09 | 91.9 | 473.2 | 327,680 | 72.6 | 155.4 |
| partial_13_17_to_15_43 | 88.8 | 442.1 | 212,992 | rejected | rejected |

Novel-window plans and per-request rows/bytes read are retained in `novel-results.json`; query logs add server elapsed, peak memory and selected parts/marks where present. This demonstrates pruning without condition-cache reuse on the bounded cohort.

## Saved PostgreSQL context

These are historical PostgreSQL client medians alongside new ClickHouse pilot client medians. PostgreSQL was not rerun, its hardware is unknown, and current ClickHouse reuses a connection unlike the original ClickHouse harness. Time, hardware, retention size and preprocessing differ. These are useful observations, not a controlled engine or equal-cost ranking.

| Workload/window | ClickHouse candidate | ClickHouse ms | Saved PostgreSQL ms |
|---|---|---:|---:|
| event_counts/hour | typed | 84.4 | 141.5 |
| traffic_day/day | fine static rollup | 82.8 | 353.4 |
| feature_funnel/day | single-pass typed | 263.4 | 7496.4 |
| ab_outcome/day | typed | 428.7 | 8486.7 |
| feature_counts/day | typed | 189.0 | 116.6 |

The ClickHouse cohort was copied once and all derived builds read that fixed cohort. This provides within-pilot data consistency. It is not a shared transactional snapshot with the earlier PostgreSQL run; saved aggregate equality establishes agreement for the 21 completed original workload/window outputs only, not full historical import completeness.

Some ClickHouse candidates are faster than saved PostgreSQL timings; feature counts/day remains slower. Do not turn prior PostgreSQL timeouts into invented latency values or quantitative speedups. The cohort has **zero SSR rows**; real-data SSR timings are diagnostic only, even though populated synthetic SSR correctness passed.

## Build and storage cost

All costs below are one-time static pilot builds. Typed/candidate table copies make experiments independent; deploying every copy is not proposed. Sizes are compressed active-part bytes from the recorded build evidence.

| Object | Rows | Bytes | Build work |
|---|---:|---:|---|
| Raw cohort | 13,711,369 | 647,932,914 | 182.04s copy; scanned all 2,315,652,132 source rows / 75,993,340,118 bytes |
| Raw + timestamp minmax | 13,711,369 | 650,871,350 | 19.94s copy + 6.13s materialize |
| Raw + time projection | 13,711,369 | 694,635,275 | 19.51s copy + 10.16s materialize; projection itself 43,300,011 bytes |
| Typed sorted | 13,711,369 | 220,469,912 | 38.25s extraction/copy |
| Compact metadata | 575,129 | 17,068,594 | 2.15s populate |
| Coarse exact rollup | 17,437 | 20,323,164 | 2.18s populate |
| Fine exact rollup | 17,437 | 25,323,574 | 1.23s copy existing states |

Additional typed lightweight projection bytes/materialization seconds: event **63,562,101 / 19.18s**, user **46,012,970 / 12.15s**, session **71,879,514 / 14.14s**, tab **70,568,800 / 14.16s**. Their separate base copies took 6.58–8.56s each and have somewhat different part boundaries.

Total retained active-part footprint across all isolated pilot tables: **3,415,122,357 bytes**. See `final-verification.json` for every table; projections are included in table storage, so do not add them again to that total.

No live materialized view or continuous refresh was installed. Rollups and compact metadata are static backfills. Incremental ingestion overhead, updates/deletes, late events and maintaining historical correctness under refresh were not benchmarked. The full source remains untouched; full-retention builds and resource scaling remain unproven.

## Evidence limits and recommendation

Prefer the typed time-sorted layout as the broad candidate, compact metadata for this historical join, and fine exact rollups for stable, hour-aligned event/traffic summaries. Treat a lightweight time projection as a retrofit candidate; require full-retention selected-granule evidence before choosing it over a sorted table. Keep identity/event projections only when their specific workload justifies their measured storage and write cost. The modest funnel improvement merits keeping the simpler one-scan query if its semantics remain as tested.

All benchmark requests have complete client/HTTP measurements and result hashes. The initial advanced pass has an unresolved **0/304 server-query-log gap** despite earlier reconciliation attempts. Independent repeat logging is collected incrementally over the same connection; the last 19 novel logs appeared after the final collection and were recovered in a later metadata-only read. This does not retroactively invent missing initial server metrics. The JSON reports exact log coverage and per-pass distributions rather than silently substituting HTTP elapsed for query-log duration.

All ten local unit tests and Python compilation pass. The final verifier initially compared live tuples with saved JSON lists; its false mismatch is preserved in `final-verification-initial.json`, and a red/green regression test now compares canonical row hashes. Final checks are in `final-verification.json`: unchanged source DDL and source part totals, all 40 journaled build operations complete, completed pilot mutations and no active benchmark query. This is metadata plus an audit of our operations, not a full source-content checksum. No credentials or private identity selections are stored in published artifacts. The shared portable timestamp renderer expects UTC inputs and currently does not normalize non-UTC datetime offsets; all windows here explicitly use UTC, so this portability issue does not affect these results.

[Machine-readable consolidated summary](final-summary.json) · [Core per-query results](results.json) · [Advanced repeat](advanced-repeat-results.json) · [Fine-rollup repeat](rollup-fine-repeat-results.json) · [Novel windows and plans](novel-results.json) · [Incremental query logs](final-query-logs.json) · [Independent edge fixture](final-fixture.json) · [Build journal](build-journal.json) · [Original core handoff](HANDOFF.md) · [Original advanced handoff](ADVANCED_HANDOFF.md)
