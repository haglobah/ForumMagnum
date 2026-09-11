# Advanced pilot results

One warmup and three measured repeats, shuffled case/layout order; query and condition caches disabled. Same 13,711,369-row cohort. Client times include network latency. No new PostgreSQL requests.

| Candidate / case / window | Client median ms | Typed baseline ms | Speedup | Read rows |
|---|---:|---:|---:|---:|
| event/ab_assignments/day | 195.8 | 209.5 | 1.07× | 1,787,046 |
| event/ab_assignments/hour | 90.5 | 85.8 | 0.95× | 106,496 |
| event/ab_outcome/day | 389.7 | 423.9 | 1.09× | 3,574,092 |
| event/ab_outcome/hour | 107.6 | 105.3 | 0.98× | 212,992 |
| event/coverage/day | 319.2 | 347.7 | 1.09× | 1,787,047 |
| event/coverage/hour | 89.1 | 89.5 | 1.01× | 106,497 |
| event/event_counts/day | 184.8 | 197.5 | 1.07× | 1,787,046 |
| event/event_counts/hour | 85.4 | 83.0 | 0.97× | 106,496 |
| event/feature_counts/day | 181.1 | 197.1 | 1.09× | 1,787,046 |
| event/feature_counts/hour | 85.9 | 82.0 | 0.95× | 106,496 |
| event/feature_funnel/day | 321.9 | 312.4 | 0.97× | 3,574,093 |
| event/feature_funnel/hour | 106.4 | 100.5 | 0.94× | 212,993 |
| event/metadata_join/day | 1738.1 | 2002.6 | 1.15× | 17,285,461 |
| event/metadata_join/hour | 930.9 | 947.7 | 1.02× | 12,243,811 |
| event/post_paths/day | 223.1 | 244.3 | 1.10× | 1,787,046 |
| event/post_paths/hour | 90.8 | 87.8 | 0.97× | 106,496 |
| event/session/day | 98.1 | 100.8 | 1.03× | 1,787,046 |
| event/session/hour | 78.1 | 77.8 | 1.00× | 106,496 |
| event/ssr_association/day | 340.4 | 178.9 | 0.53× | 5,361,139 |
| event/ssr_association/hour | 94.1 | 89.6 | 0.95× | 212,993 |
| event/tab/day | 98.6 | 101.2 | 1.03× | 1,787,046 |
| event/tab/hour | 77.2 | 74.6 | 0.97× | 106,496 |
| event/traffic_day/day | 193.5 | 207.6 | 1.07× | 1,787,046 |
| event/traffic_day/hour | 86.2 | 84.6 | 0.98× | 106,496 |
| event/traffic_hour/day | 195.3 | 224.1 | 1.15× | 1,787,046 |
| event/traffic_hour/hour | 86.3 | 82.8 | 0.96× | 106,496 |
| event/ua_bot/day | 185.5 | 213.4 | 1.15× | 1,787,046 |
| event/ua_bot/hour | 86.0 | 84.3 | 0.98× | 106,496 |
| event/user/day | 107.3 | 107.9 | 1.01× | 1,787,046 |
| event/user/hour | 78.0 | 76.4 | 0.98× | 106,496 |
| funnel/feature_funnel/day | 275.1 | 312.4 | 1.14× | 1,777,563 |
| funnel/feature_funnel/hour | 90.8 | 100.5 | 1.11× | 98,305 |
| metadata/metadata_join/day | 638.7 | 2002.6 | 3.14× | 4,130,253 |
| metadata/metadata_join/hour | 209.6 | 947.7 | 4.52× | 771,737 |
| rollup/event_counts/day | 71.7 | 197.5 | 2.76× | 9,245 |
| rollup/event_counts/hour | 72.5 | 83.0 | 1.14× | 9,245 |
| rollup/traffic_day/day | 153.6 | 207.6 | 1.35× | 9,245 |
| rollup/traffic_day/hour | 150.9 | 84.6 | 0.56× | 9,245 |
| rollup/traffic_hour/day | 151.1 | 224.1 | 1.48× | 9,245 |
| rollup/traffic_hour/hour | 152.8 | 82.8 | 0.54× | 9,245 |
| session/session/day | 91.9 | 100.8 | 1.10× | 1,236,890 |
| session/session/hour | 77.8 | 77.8 | 1.00× | 106,496 |
| tab/tab/day | 91.2 | 101.2 | 1.11× | 1,261,466 |
| tab/tab/hour | 76.7 | 74.6 | 0.97× | 106,496 |
| user/user/day | 93.4 | 107.9 | 1.16× | 982,938 |
| user/user/hour | 76.3 | 76.4 | 1.00× | 106,496 |
