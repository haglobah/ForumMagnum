# Core ClickHouse pilot measurements

Median execute/fetch milliseconds; one warmup per pass excluded. Each cell includes all completed measured repeats from both passes. See JSON for exact hashes, errors and server time. PostgreSQL was not queried.

| Case | Raw | Minmax | Time projection | Typed sorted |
|---|---:|---:|---:|---:|
| ab_assignments/day | 910.4 | 743.0 | 807.6 | 217.2 |
| ab_assignments/hour | 475.9 | 208.1 | 135.2 | 85.1 |
| ab_outcome/day | 1935.9 | 1586.9 | 1707.2 | 428.7 |
| ab_outcome/hour | 879.4 | 406.2 | 214.7 | 106.5 |
| coverage/day | 692.3 | 464.4 | 501.0 | 338.4 |
| coverage/hour | 443.9 | 189.9 | 104.6 | 88.7 |
| event_counts/day | 602.8 | 357.6 | 375.1 | 201.6 |
| event_counts/hour | 411.6 | 189.4 | 130.1 | 84.4 |
| feature_counts/day | 864.8 | 721.1 | 787.2 | 189.0 |
| feature_counts/hour | 441.0 | 205.3 | 133.1 | 81.2 |
| feature_funnel/day | 1562.1 | 1171.4 | 1293.1 | 314.2 |
| feature_funnel/hour | 916.1 | 445.2 | 196.4 | 105.5 |
| metadata_join/day | 4657.3 | 4280.1 | 4359.3 | 1696.8 |
| metadata_join/hour | 3467.7 | 3007.3 | 2832.3 | 905.7 |
| post_paths/day | 1108.2 | 911.3 | 971.1 | 240.9 |
| post_paths/hour | 492.6 | 235.1 | 134.5 | 87.3 |
| session/day | 1138.6 | 982.2 | 1019.1 | 100.8 |
| session/hour | 494.8 | 235.0 | 138.9 | 77.3 |
| ssr_association/day | 1637.6 | 1223.0 | 1349.3 | 181.1 |
| ssr_association/hour | 1026.7 | 439.1 | 203.4 | 90.1 |
| tab/day | 1143.4 | 999.8 | 1085.3 | 101.0 |
| tab/hour | 486.9 | 235.9 | 133.3 | 75.3 |
| traffic_day/day | 918.0 | 760.7 | 825.4 | 207.1 |
| traffic_day/hour | 445.7 | 207.4 | 136.3 | 83.1 |
| traffic_hour/day | 933.8 | 802.7 | 832.7 | 205.6 |
| traffic_hour/hour | 447.0 | 206.4 | 137.7 | 83.1 |
| ua_bot/day | 945.1 | 744.5 | 825.5 | 226.7 |
| ua_bot/hour | 452.7 | 206.4 | 139.4 | 85.8 |
| user/day | 1232.8 | 972.5 | 1056.0 | 109.3 |
| user/hour | 504.2 | 241.7 | 140.9 | 76.1 |

The cohort and its part/merge ordering differ from the full source. These figures measure the eight-day pilot, not billion-row performance. Typed sorting, partitioning and JSON extraction are combined. Empty SSR windows are diagnostic only.
