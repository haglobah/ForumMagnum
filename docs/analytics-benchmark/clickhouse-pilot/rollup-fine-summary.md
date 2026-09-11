# Advanced pilot results

One warmup and three measured repeats, shuffled case/layout order; query and condition caches disabled. Same 13,711,369-row cohort. Client times include network latency. No new PostgreSQL requests.

| Candidate / case / window | Client median ms | Typed baseline ms | Speedup | Read rows |
|---|---:|---:|---:|---:|
| rollup/event_counts/day | 71.2 | 195.9 | 2.75× | 9,245 |
| rollup/event_counts/hour | 70.6 | 84.0 | 1.19× | 9,245 |
| rollup/traffic_day/day | 153.3 | 211.8 | 1.38× | 9,245 |
| rollup/traffic_day/hour | 151.1 | 83.2 | 0.55× | 9,245 |
| rollup/traffic_hour/day | 157.7 | 206.3 | 1.31× | 9,245 |
| rollup/traffic_hour/hour | 151.9 | 84.0 | 0.55× | 9,245 |
| rollup_fine/event_counts/day | 72.8 | 195.9 | 2.69× | 2,269 |
| rollup_fine/event_counts/hour | 69.7 | 84.0 | 1.20× | 128 |
| rollup_fine/traffic_day/day | 81.5 | 211.8 | 2.60× | 2,269 |
| rollup_fine/traffic_day/hour | 74.8 | 83.2 | 1.11× | 128 |
| rollup_fine/traffic_hour/day | 81.0 | 206.3 | 2.55× | 2,269 |
| rollup_fine/traffic_hour/hour | 74.1 | 84.0 | 1.13× | 128 |
