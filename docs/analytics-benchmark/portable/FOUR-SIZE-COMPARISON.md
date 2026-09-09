# Four-size analytics benchmark comparison

Measured all 30 workload/window combinations on all four engines at **7,400,000 frozen rows**, using the same private parameters, SQL, engine versions, baseline DDL, one warmup and three measured repetitions. The tables below retain the earlier quarter (912,500), half (1,825,000) and full (3,650,000) measurements. All times are medians in milliseconds.

**Correctness:** all measured result hashes match across engines at every size; no measured query failures or timeouts. SSR association has no observed cohort in either window and is excluded from speed comparisons.

**The new point is a different scaling experiment.** The 7.4-million-row dataset extends through September 4, whereas the old full sample ended September 2. It contains every old row with identical canonical values. September 1 still has exactly 1,550,958 events in both the 3.65M and 7.4M tables. The quarter and half samples contain 387,740 and 775,479 September 1 events respectively. Thus 3.65M → 7.4M grows total table history while keeping the analytical window fixed; it must not be fitted as another point on the earlier event-thinning power-law curve. This new run measures filtering/pruning and larger-table effects.

All new full-result hashes also match the preceding 3.65M run: True.

## Current 7.4-million-row comparison

| Workload/window | DuckDB/Parquet | PostgreSQL | ClickHouse | StarRocks |
|---|---:|---:|---:|---:|
| ab_assignments/day | 36.3 | 219.5 | 23.0 | 24.5 |
| ab_assignments/hour | 19.8 | 173.0 | 8.4 | 12.5 |
| ab_outcome/day | 60.7 | 1221.2 | 58.0 | 50.3 |
| ab_outcome/hour | 22.9 | 199.0 | 16.3 | 26.0 |
| coverage/day | 50.5 | 738.2 | 42.4 | 103.2 |
| coverage/hour | 20.5 | 187.1 | 9.1 | 16.2 |
| event_counts/day | 35.9 | 210.4 | 23.5 | 20.1 |
| event_counts/hour | 22.8 | 180.3 | 8.2 | 11.7 |
| feature_counts/day | 34.3 | 199.5 | 19.1 | 15.0 |
| feature_counts/hour | 24.9 | 183.0 | 7.7 | 9.9 |
| feature_funnel/day | 67.0 | 1453.9 | 41.6 | 44.5 |
| feature_funnel/hour | 27.5 | 198.7 | 15.5 | 27.2 |
| metadata_join/day | 147.8 | 1039.2 | 127.9 | 103.3 |
| metadata_join/hour | 72.4 | 654.6 | 40.2 | 59.3 |
| post_paths/day | 39.9 | 235.4 | 29.0 | 25.1 |
| post_paths/hour | 19.6 | 217.8 | 9.3 | 12.4 |
| session/day | 22.4 | 205.5 | 8.4 | 14.9 |
| session/hour | 19.2 | 203.6 | 6.9 | 12.6 |
| ssr_association/day | empty — excluded | empty — excluded | empty — excluded | empty — excluded |
| ssr_association/hour | empty — excluded | empty — excluded | empty — excluded | empty — excluded |
| tab/day | 19.8 | 234.7 | 8.0 | 14.5 |
| tab/hour | 19.8 | 209.1 | 7.1 | 11.2 |
| traffic_day/day | 37.3 | 221.0 | 22.1 | 19.4 |
| traffic_day/hour | 18.8 | 164.2 | 7.7 | 11.5 |
| traffic_hour/day | 36.6 | 216.7 | 21.0 | 17.8 |
| traffic_hour/hour | 20.4 | 182.2 | 8.0 | 12.9 |
| ua_bot/day | 38.6 | 233.4 | 20.2 | 27.3 |
| ua_bot/hour | 23.5 | 180.5 | 7.5 | 12.7 |
| user/day | 31.1 | 195.3 | 14.9 | 13.0 |
| user/hour | 18.9 | 193.3 | 7.2 | 10.9 |

## All four sizes

### duckdb

| Workload/window | 0.9125M rows | 1.825M rows | 3.65M rows | 7.4M rows |
|---|---:|---:|---:|---:|
| ab_assignments/day | 20.2 | 22.7 | 27.2 | 36.3 |
| ab_assignments/hour | 11.6 | 10.8 | 10.6 | 19.8 |
| ab_outcome/day | 28.6 | 31.6 | 45.3 | 60.7 |
| ab_outcome/hour | 11.7 | 12.8 | 12.4 | 22.9 |
| coverage/day | 21.2 | 28.2 | 40.6 | 50.5 |
| coverage/hour | 11.0 | 10.4 | 11.0 | 20.5 |
| event_counts/day | 16.6 | 21.6 | 26.0 | 35.9 |
| event_counts/hour | 10.1 | 10.1 | 9.6 | 22.8 |
| feature_counts/day | 16.4 | 20.3 | 23.1 | 34.3 |
| feature_counts/hour | 12.7 | 10.0 | 10.0 | 24.9 |
| feature_funnel/day | 37.3 | 41.8 | 50.9 | 67.0 |
| feature_funnel/hour | 14.8 | 13.2 | 13.7 | 27.5 |
| metadata_join/day | 62.1 | 79.2 | 116.7 | 147.8 |
| metadata_join/hour | 35.4 | 40.1 | 49.9 | 72.4 |
| post_paths/day | 19.9 | 24.0 | 29.9 | 39.9 |
| post_paths/hour | 11.8 | 10.6 | 10.8 | 19.6 |
| session/day | 13.6 | 11.0 | 11.8 | 22.4 |
| session/hour | 9.9 | 10.6 | 9.8 | 19.2 |
| ssr_association/day | empty | empty | empty | empty |
| ssr_association/hour | empty | empty | empty | empty |
| tab/day | 14.7 | 11.6 | 9.7 | 19.8 |
| tab/hour | 9.9 | 10.0 | 12.0 | 19.8 |
| traffic_day/day | 22.0 | 21.3 | 26.9 | 37.3 |
| traffic_day/hour | 10.6 | 10.5 | 12.4 | 18.8 |
| traffic_hour/day | 18.7 | 22.0 | 27.5 | 36.6 |
| traffic_hour/hour | 13.4 | 10.3 | 12.9 | 20.4 |
| ua_bot/day | 18.8 | 22.6 | 28.3 | 38.6 |
| ua_bot/hour | 9.6 | 10.0 | 11.2 | 23.5 |
| user/day | 14.5 | 16.6 | 18.5 | 31.1 |
| user/hour | 9.5 | 10.8 | 12.1 | 18.9 |

### postgres

| Workload/window | 0.9125M rows | 1.825M rows | 3.65M rows | 7.4M rows |
|---|---:|---:|---:|---:|
| ab_assignments/day | 38.5 | 68.6 | 134.7 | 219.5 |
| ab_assignments/hour | 27.7 | 48.9 | 91.1 | 173.0 |
| ab_outcome/day | 277.8 | 539.9 | 1082.1 | 1221.2 |
| ab_outcome/hour | 29.9 | 61.3 | 119.8 | 199.0 |
| coverage/day | 154.0 | 281.8 | 628.7 | 738.2 |
| coverage/hour | 26.6 | 47.9 | 91.9 | 187.1 |
| event_counts/day | 37.8 | 72.5 | 140.8 | 210.4 |
| event_counts/hour | 26.4 | 50.8 | 93.8 | 180.3 |
| feature_counts/day | 32.0 | 55.7 | 112.3 | 199.5 |
| feature_counts/hour | 27.1 | 49.3 | 92.2 | 183.0 |
| feature_funnel/day | 296.6 | 590.1 | 1326.5 | 1453.9 |
| feature_funnel/hour | 29.4 | 59.2 | 121.6 | 198.7 |
| metadata_join/day | 96.8 | 226.1 | 944.0 | 1039.2 |
| metadata_join/hour | 71.3 | 115.3 | 228.7 | 654.6 |
| post_paths/day | 37.7 | 68.8 | 138.4 | 235.4 |
| post_paths/hour | 31.2 | 60.3 | 110.1 | 217.8 |
| session/day | 31.4 | 58.6 | 112.7 | 205.5 |
| session/hour | 30.5 | 51.6 | 102.3 | 203.6 |
| ssr_association/day | empty | empty | empty | empty |
| ssr_association/hour | empty | empty | empty | empty |
| tab/day | 34.2 | 58.4 | 118.3 | 234.7 |
| tab/hour | 31.6 | 52.5 | 108.2 | 209.1 |
| traffic_day/day | 38.3 | 69.8 | 129.9 | 221.0 |
| traffic_day/hour | 27.0 | 53.4 | 95.2 | 164.2 |
| traffic_hour/day | 35.8 | 66.3 | 135.1 | 216.7 |
| traffic_hour/hour | 27.2 | 47.8 | 92.5 | 182.2 |
| ua_bot/day | 42.5 | 81.0 | 159.4 | 233.4 |
| ua_bot/hour | 26.1 | 50.2 | 96.7 | 180.5 |
| user/day | 30.3 | 54.0 | 117.1 | 195.3 |
| user/hour | 29.2 | 51.4 | 93.3 | 193.3 |

### clickhouse

| Workload/window | 0.9125M rows | 1.825M rows | 3.65M rows | 7.4M rows |
|---|---:|---:|---:|---:|
| ab_assignments/day | 13.8 | 17.6 | 24.8 | 23.0 |
| ab_assignments/hour | 6.0 | 7.6 | 8.3 | 8.4 |
| ab_outcome/day | 32.3 | 36.6 | 57.2 | 58.0 |
| ab_outcome/hour | 10.1 | 12.2 | 14.8 | 16.3 |
| coverage/day | 19.0 | 26.3 | 43.1 | 42.4 |
| coverage/hour | 6.9 | 7.9 | 11.1 | 9.1 |
| event_counts/day | 15.0 | 17.3 | 24.9 | 23.5 |
| event_counts/hour | 5.4 | 7.0 | 8.5 | 8.2 |
| feature_counts/day | 13.0 | 14.4 | 20.6 | 19.1 |
| feature_counts/hour | 6.0 | 6.7 | 8.0 | 7.7 |
| feature_funnel/day | 28.3 | 30.0 | 41.3 | 41.6 |
| feature_funnel/hour | 11.3 | 13.5 | 14.7 | 15.5 |
| metadata_join/day | 52.4 | 78.9 | 140.6 | 127.9 |
| metadata_join/hour | 26.1 | 30.2 | 43.7 | 40.2 |
| post_paths/day | 17.1 | 21.7 | 30.2 | 29.0 |
| post_paths/hour | 6.3 | 8.0 | 9.4 | 9.3 |
| session/day | 7.9 | 10.8 | 9.0 | 8.4 |
| session/hour | 5.6 | 6.8 | 7.3 | 6.9 |
| ssr_association/day | empty | empty | empty | empty |
| ssr_association/hour | empty | empty | empty | empty |
| tab/day | 5.5 | 6.5 | 7.0 | 8.0 |
| tab/hour | 5.9 | 6.4 | 6.4 | 7.1 |
| traffic_day/day | 14.0 | 16.9 | 23.0 | 22.1 |
| traffic_day/hour | 6.3 | 7.5 | 8.2 | 7.7 |
| traffic_hour/day | 14.3 | 15.8 | 23.5 | 21.0 |
| traffic_hour/hour | 6.4 | 7.0 | 8.0 | 8.0 |
| ua_bot/day | 14.5 | 15.6 | 21.7 | 20.2 |
| ua_bot/hour | 7.5 | 7.4 | 8.0 | 7.5 |
| user/day | 11.3 | 13.8 | 16.2 | 14.9 |
| user/hour | 6.2 | 7.4 | 7.5 | 7.2 |

### starrocks

| Workload/window | 0.9125M rows | 1.825M rows | 3.65M rows | 7.4M rows |
|---|---:|---:|---:|---:|
| ab_assignments/day | 16.4 | 19.7 | 30.1 | 24.5 |
| ab_assignments/hour | 11.7 | 11.5 | 14.1 | 12.5 |
| ab_outcome/day | 28.0 | 34.2 | 49.4 | 50.3 |
| ab_outcome/hour | 20.4 | 21.6 | 32.0 | 26.0 |
| coverage/day | 31.4 | 50.5 | 95.4 | 103.2 |
| coverage/hour | 11.5 | 13.0 | 15.3 | 16.2 |
| event_counts/day | 10.1 | 11.5 | 15.2 | 20.1 |
| event_counts/hour | 9.3 | 10.1 | 10.8 | 11.7 |
| feature_counts/day | 12.6 | 14.0 | 16.0 | 15.0 |
| feature_counts/hour | 11.7 | 12.1 | 12.8 | 9.9 |
| feature_funnel/day | 21.8 | 25.8 | 41.9 | 44.5 |
| feature_funnel/hour | 20.0 | 19.0 | 29.4 | 27.2 |
| metadata_join/day | 73.7 | 60.2 | 103.3 | 103.3 |
| metadata_join/hour | 64.5 | 36.4 | 43.5 | 59.3 |
| post_paths/day | 12.1 | 12.6 | 21.6 | 25.1 |
| post_paths/hour | 10.5 | 11.5 | 12.5 | 12.4 |
| session/day | 10.0 | 12.6 | 14.1 | 14.9 |
| session/hour | 9.8 | 9.7 | 11.3 | 12.6 |
| ssr_association/day | empty | empty | empty | empty |
| ssr_association/hour | empty | empty | empty | empty |
| tab/day | 10.2 | 11.6 | 12.7 | 14.5 |
| tab/hour | 10.1 | 10.5 | 10.3 | 11.2 |
| traffic_day/day | 15.2 | 15.9 | 20.3 | 19.4 |
| traffic_day/hour | 11.5 | 11.9 | 13.0 | 11.5 |
| traffic_hour/day | 15.8 | 17.4 | 24.5 | 17.8 |
| traffic_hour/hour | 12.6 | 12.4 | 15.1 | 12.9 |
| ua_bot/day | 12.9 | 17.6 | 27.0 | 27.3 |
| ua_bot/hour | 10.4 | 11.7 | 11.5 | 12.7 |
| user/day | 10.8 | 10.3 | 12.2 | 13.0 |
| user/hour | 9.2 | 10.0 | 9.8 | 10.9 |

## Controls and differences

The first 74 completed 100,000-row files of the separate bitmap export were copied privately; checksums were stable before and after copying. The native files were rewritten into 740 files with 10,000 rows each to match the prior exporter layout. Exact full-row multiset equality, unique IDs and total counts were checked between the native and rewritten copies. All 3,650,000 old rows are present and none differ in any canonical column. The frozen copy remains an incomplete source export and lacks the full enrichment history.

The original query text is unchanged and its hash is asserted against the preceding full-size run. Both profiles query September 1: hour is 00:00–01:00 UTC and day is 00:00–24:00 UTC. The SQL preserves the preceding benchmark’s date substitutions. Private identity cohorts were not reselected.

Hardware and limits are unchanged: shared Ryzen 9 7940HS, local NVMe, 60 GiB host RAM; server containers limited to four CPU cores and 12 GiB; DuckDB four threads with default memory limit. PostgreSQL uses the canonical unindexed heap plus ANALYZE; ClickHouse and StarRocks keep their baseline ordering/distribution keys. Concurrency is one; seeded order 1729; timeout 30 seconds. Warmups are excluded. Caches and background host activity are uncontrolled, and earlier size measurements come from prior runs.

**StarRocks setup differs:** JSON Stream Load with 100,000 rows per transaction replaced the slow SQL batch loader. Canonical synthetic fixture rows matched exactly after loading (including precise numeric/timestamp/null handling), every load reported zero rejected rows, and real-query results matched the other engines. The logical table definition and query settings are unchanged, but the loading path/batch sizes can change physical segments and compaction. Therefore the StarRocks change from previous sizes is not attributable solely to row count. This is disclosed rather than treated as an equivalent ingest benchmark. [Official Stream Load reference](https://docs.starrocks.io/docs/sql-reference/sql-statements/loading_unloading/STREAM_LOAD/).

Timings include client execution and full result fetch, excluding result hashing. ClickHouse includes HTTP connection setup; SQL connection setup is excluded for other engines. Setup/load time is separate and not a comparable ingestion benchmark.

## Versions and current setup time

| Engine | Version | Setup/load seconds |
|---|---|---:|
| duckdb | v1.5.5 | 0.0 |
| postgres | PostgreSQL 18.1 (Debian 18.1-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit | 25.8 |
| clickhouse | 26.8.2.7 | 114.8 |
| starrocks | 4.1.4-4a9848e | 92.1 |

[Machine-readable table](four-size-comparison.tsv) · [All individual attempts](four-size-comparison-results.json) · [7.4M-only evidence](frozen-7400k-results.json) · [Earlier scaling interpretation](FROZEN-SCALING-RESULTS.md).

Private frozen copies and execution scripts remain in `/tmp/analytics-7400k-comparison/`. Disposable benchmark containers were removed; no source database writes were made.
