# Frozen partial-sample comparison

Compared all four engines on **3,650,000 identical frozen rows**, exported between 2026-08-31 00:00:00.167000 and 2026-09-02 09:17:07.118000 UTC.

This is a partial export, not a complete source snapshot. Queries use September 1, 2026 (00:00–01:00 and the full UTC day), replacing the suite’s September 7 default. The full seven-day metadata lookback is unavailable. Identical sample answers do not establish complete historical answers or production performance.

One warmup and three measured repetitions per workload/window, concurrency one, seeded order 1729, 30-second query timeout. Times are client execution plus complete fetch; hashing and connection setup excluded, except ClickHouse HTTP setup is included. Caches are uncontrolled; no cold-cache claim.

Shared host: AMD Ryzen 9 7940HS, 16 logical CPUs, 60 GiB RAM, local NVMe; source export remained active. Each disposable server was limited to four CPU cores and 12 GiB memory. DuckDB used four threads and its default memory limit, so memory limits were not equal. PostgreSQL used the canonical heap with ANALYZE and no indexes; ClickHouse/StarRocks used the suite’s baseline DDL; DuckDB scanned the frozen exporter Parquet files directly. These are baseline layouts, not tuned engine configurations.

## Measured medians (milliseconds)

| Workload/window | DuckDB/Parquet | PostgreSQL | ClickHouse | StarRocks |
|---|---:|---:|---:|---:|
| ab_assignments/day | 27.2 | 134.7 | 24.8 | 30.1 |
| ab_assignments/hour | 10.6 | 91.1 | 8.3 | 14.1 |
| ab_outcome/day | 45.3 | 1082.1 | 57.2 | 49.4 |
| ab_outcome/hour | 12.4 | 119.8 | 14.8 | 32.0 |
| coverage/day | 40.6 | 628.7 | 43.1 | 95.4 |
| coverage/hour | 11.0 | 91.9 | 11.1 | 15.3 |
| event_counts/day | 26.0 | 140.8 | 24.9 | 15.2 |
| event_counts/hour | 9.6 | 93.8 | 8.5 | 10.8 |
| feature_counts/day | 23.1 | 112.3 | 20.6 | 16.0 |
| feature_counts/hour | 10.0 | 92.2 | 8.0 | 12.8 |
| feature_funnel/day | 50.9 | 1326.5 | 41.3 | 41.9 |
| feature_funnel/hour | 13.7 | 121.6 | 14.7 | 29.4 |
| metadata_join/day | 116.7 | 944.0 | 140.6 | 103.3 |
| metadata_join/hour | 49.9 | 228.7 | 43.7 | 43.5 |
| post_paths/day | 29.9 | 138.4 | 30.2 | 21.6 |
| post_paths/hour | 10.8 | 110.1 | 9.4 | 12.5 |
| session/day | 11.8 | 112.7 | 9.0 | 14.1 |
| session/hour | 9.8 | 102.3 | 7.3 | 11.3 |
| ssr_association/day | empty — excluded | empty — excluded | empty — excluded | empty — excluded |
| ssr_association/hour | empty — excluded | empty — excluded | empty — excluded | empty — excluded |
| tab/day | 9.7 | 118.3 | 7.0 | 12.7 |
| tab/hour | 12.0 | 108.2 | 6.4 | 10.3 |
| traffic_day/day | 26.9 | 129.9 | 23.0 | 20.3 |
| traffic_day/hour | 12.4 | 95.2 | 8.2 | 13.0 |
| traffic_hour/day | 27.5 | 135.1 | 23.5 | 24.5 |
| traffic_hour/hour | 12.9 | 92.5 | 8.0 | 15.1 |
| ua_bot/day | 28.3 | 159.4 | 21.7 | 27.0 |
| ua_bot/hour | 11.2 | 96.7 | 8.0 | 11.5 |
| user/day | 18.5 | 117.1 | 16.2 | 12.2 |
| user/hour | 12.1 | 93.3 | 7.5 | 9.8 |

All measured result hashes match across engines. Empty SSR-association cohorts are excluded from speed comparisons. No measured timeout or failure occurred.

## Versions and setup

| Engine | Version | Setup/load seconds |
|---|---|---:|
| duckdb | v1.5.5 | 0.0 |
| postgres | PostgreSQL 18.1 (Debian 18.1-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit | 13.0 |
| clickhouse | 26.8.2.7 | 57.2 |
| starrocks | 4.1.4-4a9848e | 732.4 |

Setup includes startup, readiness, import validation/loading and PostgreSQL ANALYZE; DuckDB directly attaches Parquet. These setup measurements are not equivalent ingestion benchmarks.

[Full aggregate results and individual attempts](frozen-sample-results.json). Private frozen files, parameters and execution harness are in `/tmp/analytics-sample-comparison/` on the benchmark host. Existing raw-PostgreSQL measurements use a different representation and timing boundary and are not included in these speed comparisons.
