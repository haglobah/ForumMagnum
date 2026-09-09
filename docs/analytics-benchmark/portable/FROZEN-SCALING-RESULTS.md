# Frozen-sample runtime scaling

Repeated the same 30 workload/window combinations on all four engines at **912,500 (quarter)** and **1,825,000 (half)** rows, compared with the preceding **3,650,000-row full sample**. One warmup and three measured repetitions per case and size, 30-second timeout, serial queries. All measured cross-engine hashes match at each size; no query failures or timeouts. Empty SSR-association cases are excluded.

## Reading the scaling numbers

`p = log(T(full) / T(quarter)) / log(4)` estimates the local exponent in `T(n) ∝ nᵖ`. It also equals the log/log least-squares slope for these three equally spaced log sizes. A purely linear runtime with no fixed overhead gives p=1 and 2× runtime on each doubling; quadratic gives p=2 and 4× on each doubling. p near zero over this range can indicate fixed overhead, pruning or caching; it does not establish O(1).

Both adjacent doubling ratios are shown because a single exponent can hide a bend or noisy measurement. These are empirical slopes over a fourfold range, not asymptotic Big-O proofs. `T(n)=a+bn` is itself O(n) but can produce p well below 1 while the fixed cost a dominates. Three sizes cannot reliably distinguish that model from other curves or predict memory/spill thresholds at larger scale.

## Representative day queries

| Engine | Query | Quarter ms | Half ms | Full ms | Half / quarter | Full / half | p |
|---|---|---:|---:|---:|---:|---:|---:|
| duckdb | traffic_day/day | 22.0 | 21.3 | 26.9 | 0.97× | 1.26× | 0.14 |
| duckdb | feature_funnel/day | 37.3 | 41.8 | 50.9 | 1.12× | 1.22× | 0.22 |
| duckdb | metadata_join/day | 62.1 | 79.2 | 116.7 | 1.28× | 1.47× | 0.45 |
| duckdb | coverage/day | 21.2 | 28.2 | 40.6 | 1.33× | 1.44× | 0.47 |
| postgres | traffic_day/day | 38.3 | 69.8 | 129.9 | 1.82× | 1.86× | 0.88 |
| postgres | feature_funnel/day | 296.6 | 590.1 | 1326.5 | 1.99× | 2.25× | 1.08 |
| postgres | metadata_join/day | 96.8 | 226.1 | 944.0 | 2.34× | 4.18× | 1.64 |
| postgres | coverage/day | 154.0 | 281.8 | 628.7 | 1.83× | 2.23× | 1.01 |
| clickhouse | traffic_day/day | 14.0 | 16.9 | 23.0 | 1.21× | 1.36× | 0.36 |
| clickhouse | feature_funnel/day | 28.3 | 30.0 | 41.3 | 1.06× | 1.38× | 0.27 |
| clickhouse | metadata_join/day | 52.4 | 78.9 | 140.6 | 1.51× | 1.78× | 0.71 |
| clickhouse | coverage/day | 19.0 | 26.3 | 43.1 | 1.38× | 1.64× | 0.59 |
| starrocks | traffic_day/day | 15.2 | 15.9 | 20.3 | 1.05× | 1.27× | 0.21 |
| starrocks | feature_funnel/day | 21.8 | 25.8 | 41.9 | 1.18× | 1.62× | 0.47 |
| starrocks | metadata_join/day | 73.7 | 60.2 | 103.3 | 0.82× | 1.71× | 0.24 |
| starrocks | coverage/day | 31.4 | 50.5 | 95.4 | 1.61× | 1.89× | 0.80 |

Some curves are non-monotonic: StarRocks metadata join is 73.7 ms at quarter size versus 60.2 ms at half size, and several very short queries fluctuate. Its p=0.24 is an endpoint summary, not a reliable scaling law. Plan choice, data shape, fixed costs and noise can all affect these local curves; no single cause was established for the StarRocks reversal.

## PostgreSQL join diagnostic

Separate EXPLAIN ANALYZE runs help explain the steep metadata-join curve. With the default `work_mem=4MB`, quarter size used in-memory sorts and wrote no temporary blocks; half size used an external merge sort and wrote 2,051 temporary 8 KiB blocks (16.0 MiB); full size used multiple external merge sorts and wrote 6,292 temporary blocks (49.2 MiB). This is evidence of crossing memory/spill thresholds, not evidence that the query has an inherent n^1.64 complexity. Diagnostic plans were collected separately during StarRocks loading and their runtimes are excluded from timing medians. They can differ from the plans and cache states in the timed run.

## Sampling and controls

Starting from the immutable 365-file sample, order each file by exact event ID and retain even row numbers for half size and multiples of four for quarter size. Quarter is verified to be a subset of half; row counts and unique IDs are verified. No timestamps or data values are rewritten. September 1 day rows are 387,740, 775,479 and 1,550,958 respectively, so the populated day window also scales almost exactly by two.

The existing private user/session/tab parameters, experiment, hour/day windows and SQL are unchanged; normalized SQL hashes are asserted equal to the full-size run. Individual event thinning changes distinct cardinalities and join/funnel relationships. These measurements therefore describe this sampling path, not a controlled increase in rows with every other workload property fixed.

The exporter file layout remains **365 Parquet files at every size**, with 2,500, 5,000 and 10,000 rows per file. This holds file count constant but means compressed bytes and fixed per-file costs do not scale with row count. DuckDB uses four threads and its default memory limit. Disposable servers retain four CPU cores and a 12 GiB limit, the same engine versions and baseline DDL as the original run. PostgreSQL uses ANALYZE without indexes. Half and quarter datasets coexist in each server; their queries are interleaved in seeded random order (1729).

Actual compressed Parquet sizes are 24,102,974 bytes (quarter), 33,879,381 (half), and 46,298,566 (full): a fourfold increase in rows is only a 1.92-fold increase in Parquet bytes in this layout.

**Full-size timings are reused from the preceding run**, whereas half/quarter are interleaved in this run. Shared-host load and caches are uncontrolled, so the full-to-half ratio can include run-to-run drift. Timing is client execute plus complete fetch; result hashing is excluded. ClickHouse HTTP connection setup is included. Each median has only three measured repetitions; individual attempts and min/max ranges are retained in the JSON. Those ranges are descriptive, not confidence intervals.

The source remains an incomplete export with missing enrichment history, as explained in the [original sample report](FROZEN-SAMPLE-RESULTS.md). Matching hashes validate agreement on each frozen sample, not complete source analytics. Ratios compare runtimes within an engine across sizes; result hashes are compared across engines within a size, never across sizes.

## All populated workloads

### duckdb

| Workload/window | Quarter ms | Half ms | Full ms | Half / quarter | Full / half | p |
|---|---:|---:|---:|---:|---:|---:|
| ab_assignments/day | 20.2 | 22.7 | 27.2 | 1.12× | 1.20× | 0.21 |
| ab_assignments/hour | 11.6 | 10.8 | 10.6 | 0.93× | 0.98× | -0.06 |
| ab_outcome/day | 28.6 | 31.6 | 45.3 | 1.11× | 1.43× | 0.33 |
| ab_outcome/hour | 11.7 | 12.8 | 12.4 | 1.09× | 0.97× | 0.04 |
| coverage/day | 21.2 | 28.2 | 40.6 | 1.33× | 1.44× | 0.47 |
| coverage/hour | 11.0 | 10.4 | 11.0 | 0.94× | 1.06× | -0.01 |
| event_counts/day | 16.6 | 21.6 | 26.0 | 1.30× | 1.20× | 0.32 |
| event_counts/hour | 10.1 | 10.1 | 9.6 | 1.00× | 0.95× | -0.04 |
| feature_counts/day | 16.4 | 20.3 | 23.1 | 1.24× | 1.14× | 0.25 |
| feature_counts/hour | 12.7 | 10.0 | 10.0 | 0.79× | 1.00× | -0.17 |
| feature_funnel/day | 37.3 | 41.8 | 50.9 | 1.12× | 1.22× | 0.22 |
| feature_funnel/hour | 14.8 | 13.2 | 13.7 | 0.89× | 1.04× | -0.06 |
| metadata_join/day | 62.1 | 79.2 | 116.7 | 1.28× | 1.47× | 0.45 |
| metadata_join/hour | 35.4 | 40.1 | 49.9 | 1.14× | 1.24× | 0.25 |
| post_paths/day | 19.9 | 24.0 | 29.9 | 1.21× | 1.25× | 0.29 |
| post_paths/hour | 11.8 | 10.6 | 10.8 | 0.90× | 1.02× | -0.06 |
| session/day | 13.6 | 11.0 | 11.8 | 0.80× | 1.08× | -0.10 |
| session/hour | 9.9 | 10.6 | 9.8 | 1.07× | 0.93× | -0.00 |
| ssr_association/day | excluded: empty | — | — | — | — | — |
| ssr_association/hour | excluded: empty | — | — | — | — | — |
| tab/day | 14.7 | 11.6 | 9.7 | 0.79× | 0.83× | -0.30 |
| tab/hour | 9.9 | 10.0 | 12.0 | 1.01× | 1.20× | 0.14 |
| traffic_day/day | 22.0 | 21.3 | 26.9 | 0.97× | 1.26× | 0.14 |
| traffic_day/hour | 10.6 | 10.5 | 12.4 | 0.99× | 1.18× | 0.11 |
| traffic_hour/day | 18.7 | 22.0 | 27.5 | 1.17× | 1.25× | 0.28 |
| traffic_hour/hour | 13.4 | 10.3 | 12.9 | 0.77× | 1.25× | -0.03 |
| ua_bot/day | 18.8 | 22.6 | 28.3 | 1.20× | 1.25× | 0.29 |
| ua_bot/hour | 9.6 | 10.0 | 11.2 | 1.05× | 1.12× | 0.11 |
| user/day | 14.5 | 16.6 | 18.5 | 1.14× | 1.12× | 0.18 |
| user/hour | 9.5 | 10.8 | 12.1 | 1.14× | 1.12× | 0.18 |

### postgres

| Workload/window | Quarter ms | Half ms | Full ms | Half / quarter | Full / half | p |
|---|---:|---:|---:|---:|---:|---:|
| ab_assignments/day | 38.5 | 68.6 | 134.7 | 1.78× | 1.96× | 0.90 |
| ab_assignments/hour | 27.7 | 48.9 | 91.1 | 1.77× | 1.86× | 0.86 |
| ab_outcome/day | 277.8 | 539.9 | 1082.1 | 1.94× | 2.00× | 0.98 |
| ab_outcome/hour | 29.9 | 61.3 | 119.8 | 2.05× | 1.95× | 1.00 |
| coverage/day | 154.0 | 281.8 | 628.7 | 1.83× | 2.23× | 1.01 |
| coverage/hour | 26.6 | 47.9 | 91.9 | 1.80× | 1.92× | 0.89 |
| event_counts/day | 37.8 | 72.5 | 140.8 | 1.92× | 1.94× | 0.95 |
| event_counts/hour | 26.4 | 50.8 | 93.8 | 1.92× | 1.85× | 0.91 |
| feature_counts/day | 32.0 | 55.7 | 112.3 | 1.74× | 2.02× | 0.91 |
| feature_counts/hour | 27.1 | 49.3 | 92.2 | 1.82× | 1.87× | 0.88 |
| feature_funnel/day | 296.6 | 590.1 | 1326.5 | 1.99× | 2.25× | 1.08 |
| feature_funnel/hour | 29.4 | 59.2 | 121.6 | 2.02× | 2.05× | 1.03 |
| metadata_join/day | 96.8 | 226.1 | 944.0 | 2.34× | 4.18× | 1.64 |
| metadata_join/hour | 71.3 | 115.3 | 228.7 | 1.62× | 1.98× | 0.84 |
| post_paths/day | 37.7 | 68.8 | 138.4 | 1.82× | 2.01× | 0.94 |
| post_paths/hour | 31.2 | 60.3 | 110.1 | 1.93× | 1.83× | 0.91 |
| session/day | 31.4 | 58.6 | 112.7 | 1.87× | 1.92× | 0.92 |
| session/hour | 30.5 | 51.6 | 102.3 | 1.69× | 1.98× | 0.87 |
| ssr_association/day | excluded: empty | — | — | — | — | — |
| ssr_association/hour | excluded: empty | — | — | — | — | — |
| tab/day | 34.2 | 58.4 | 118.3 | 1.71× | 2.02× | 0.89 |
| tab/hour | 31.6 | 52.5 | 108.2 | 1.66× | 2.06× | 0.89 |
| traffic_day/day | 38.3 | 69.8 | 129.9 | 1.82× | 1.86× | 0.88 |
| traffic_day/hour | 27.0 | 53.4 | 95.2 | 1.98× | 1.78× | 0.91 |
| traffic_hour/day | 35.8 | 66.3 | 135.1 | 1.85× | 2.04× | 0.96 |
| traffic_hour/hour | 27.2 | 47.8 | 92.5 | 1.76× | 1.93× | 0.88 |
| ua_bot/day | 42.5 | 81.0 | 159.4 | 1.90× | 1.97× | 0.95 |
| ua_bot/hour | 26.1 | 50.2 | 96.7 | 1.92× | 1.93× | 0.94 |
| user/day | 30.3 | 54.0 | 117.1 | 1.78× | 2.17× | 0.98 |
| user/hour | 29.2 | 51.4 | 93.3 | 1.76× | 1.81× | 0.84 |

### clickhouse

| Workload/window | Quarter ms | Half ms | Full ms | Half / quarter | Full / half | p |
|---|---:|---:|---:|---:|---:|---:|
| ab_assignments/day | 13.8 | 17.6 | 24.8 | 1.28× | 1.41× | 0.42 |
| ab_assignments/hour | 6.0 | 7.6 | 8.3 | 1.26× | 1.09× | 0.23 |
| ab_outcome/day | 32.3 | 36.6 | 57.2 | 1.13× | 1.56× | 0.41 |
| ab_outcome/hour | 10.1 | 12.2 | 14.8 | 1.20× | 1.22× | 0.28 |
| coverage/day | 19.0 | 26.3 | 43.1 | 1.38× | 1.64× | 0.59 |
| coverage/hour | 6.9 | 7.9 | 11.1 | 1.15× | 1.40× | 0.34 |
| event_counts/day | 15.0 | 17.3 | 24.9 | 1.15× | 1.44× | 0.36 |
| event_counts/hour | 5.4 | 7.0 | 8.5 | 1.28× | 1.22× | 0.32 |
| feature_counts/day | 13.0 | 14.4 | 20.6 | 1.11× | 1.43× | 0.33 |
| feature_counts/hour | 6.0 | 6.7 | 8.0 | 1.12× | 1.19× | 0.21 |
| feature_funnel/day | 28.3 | 30.0 | 41.3 | 1.06× | 1.38× | 0.27 |
| feature_funnel/hour | 11.3 | 13.5 | 14.7 | 1.20× | 1.08× | 0.19 |
| metadata_join/day | 52.4 | 78.9 | 140.6 | 1.51× | 1.78× | 0.71 |
| metadata_join/hour | 26.1 | 30.2 | 43.7 | 1.15× | 1.45× | 0.37 |
| post_paths/day | 17.1 | 21.7 | 30.2 | 1.27× | 1.39× | 0.41 |
| post_paths/hour | 6.3 | 8.0 | 9.4 | 1.27× | 1.18× | 0.29 |
| session/day | 7.9 | 10.8 | 9.0 | 1.37× | 0.83× | 0.09 |
| session/hour | 5.6 | 6.8 | 7.3 | 1.21× | 1.08× | 0.19 |
| ssr_association/day | excluded: empty | — | — | — | — | — |
| ssr_association/hour | excluded: empty | — | — | — | — | — |
| tab/day | 5.5 | 6.5 | 7.0 | 1.18× | 1.07× | 0.17 |
| tab/hour | 5.9 | 6.4 | 6.4 | 1.08× | 1.01× | 0.06 |
| traffic_day/day | 14.0 | 16.9 | 23.0 | 1.21× | 1.36× | 0.36 |
| traffic_day/hour | 6.3 | 7.5 | 8.2 | 1.19× | 1.10× | 0.19 |
| traffic_hour/day | 14.3 | 15.8 | 23.5 | 1.10× | 1.49× | 0.36 |
| traffic_hour/hour | 6.4 | 7.0 | 8.0 | 1.10× | 1.14× | 0.16 |
| ua_bot/day | 14.5 | 15.6 | 21.7 | 1.07× | 1.40× | 0.29 |
| ua_bot/hour | 7.5 | 7.4 | 8.0 | 0.98× | 1.08× | 0.05 |
| user/day | 11.3 | 13.8 | 16.2 | 1.22× | 1.17× | 0.26 |
| user/hour | 6.2 | 7.4 | 7.5 | 1.18× | 1.02× | 0.13 |

### starrocks

| Workload/window | Quarter ms | Half ms | Full ms | Half / quarter | Full / half | p |
|---|---:|---:|---:|---:|---:|---:|
| ab_assignments/day | 16.4 | 19.7 | 30.1 | 1.20× | 1.52× | 0.44 |
| ab_assignments/hour | 11.7 | 11.5 | 14.1 | 0.98× | 1.23× | 0.13 |
| ab_outcome/day | 28.0 | 34.2 | 49.4 | 1.22× | 1.44× | 0.41 |
| ab_outcome/hour | 20.4 | 21.6 | 32.0 | 1.06× | 1.48× | 0.33 |
| coverage/day | 31.4 | 50.5 | 95.4 | 1.61× | 1.89× | 0.80 |
| coverage/hour | 11.5 | 13.0 | 15.3 | 1.13× | 1.18× | 0.21 |
| event_counts/day | 10.1 | 11.5 | 15.2 | 1.14× | 1.32× | 0.29 |
| event_counts/hour | 9.3 | 10.1 | 10.8 | 1.09× | 1.07× | 0.11 |
| feature_counts/day | 12.6 | 14.0 | 16.0 | 1.11× | 1.14× | 0.17 |
| feature_counts/hour | 11.7 | 12.1 | 12.8 | 1.03× | 1.06× | 0.06 |
| feature_funnel/day | 21.8 | 25.8 | 41.9 | 1.18× | 1.62× | 0.47 |
| feature_funnel/hour | 20.0 | 19.0 | 29.4 | 0.95× | 1.55× | 0.28 |
| metadata_join/day | 73.7 | 60.2 | 103.3 | 0.82× | 1.71× | 0.24 |
| metadata_join/hour | 64.5 | 36.4 | 43.5 | 0.56× | 1.20× | -0.28 |
| post_paths/day | 12.1 | 12.6 | 21.6 | 1.04× | 1.71× | 0.42 |
| post_paths/hour | 10.5 | 11.5 | 12.5 | 1.09× | 1.09× | 0.12 |
| session/day | 10.0 | 12.6 | 14.1 | 1.26× | 1.12× | 0.25 |
| session/hour | 9.8 | 9.7 | 11.3 | 0.99× | 1.16× | 0.10 |
| ssr_association/day | excluded: empty | — | — | — | — | — |
| ssr_association/hour | excluded: empty | — | — | — | — | — |
| tab/day | 10.2 | 11.6 | 12.7 | 1.14× | 1.10× | 0.16 |
| tab/hour | 10.1 | 10.5 | 10.3 | 1.04× | 0.98× | 0.01 |
| traffic_day/day | 15.2 | 15.9 | 20.3 | 1.05× | 1.27× | 0.21 |
| traffic_day/hour | 11.5 | 11.9 | 13.0 | 1.03× | 1.09× | 0.09 |
| traffic_hour/day | 15.8 | 17.4 | 24.5 | 1.10× | 1.41× | 0.32 |
| traffic_hour/hour | 12.6 | 12.4 | 15.1 | 0.98× | 1.22× | 0.13 |
| ua_bot/day | 12.9 | 17.6 | 27.0 | 1.36× | 1.53× | 0.53 |
| ua_bot/hour | 10.4 | 11.7 | 11.5 | 1.12× | 0.98× | 0.07 |
| user/day | 10.8 | 10.3 | 12.2 | 0.95× | 1.18× | 0.08 |
| user/hour | 9.2 | 10.0 | 9.8 | 1.09× | 0.98× | 0.04 |

[Full results, individual attempts and calculated exponents](frozen-scaling-results.json). Private samples and the execution/publishing scripts remain in `/tmp/analytics-scaling-comparison/` on the benchmark host. No source database writes were made; disposable benchmark containers were removed.
