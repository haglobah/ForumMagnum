# Advanced candidate handoff

Historical stage record. The completed experiment and final validation are in [FINAL_HANDOFF.md](FINAL_HANDOFF.md).

Objective remains: optimize ClickHouse without any further PostgreSQL activity. This stage used only the existing 13,711,369-row isolated cohort and read saved PostgreSQL hashes. Source table, global settings and service size are unchanged. No active process remains from this stage.

## Completed work

- `advanced.py`: four separate typed copies with lightweight event/user/session/tab projections; filtered compact metadata table; exact hourly count and nullable-client `uniqExact` states; canonical metadata query uses compact side while preserving ranking, seven-day lookback, inclusive +5-second page association, ties, nulls, joins and grouping. Single-pass funnel uses conditional nullable min/max and retains exposure eligibility, null handling and empty-window behavior.
- `advanced_fixture.py`: 15 live comparisons against local DuckDB, all passed. Fixtures cover canonical metadata ties and time boundaries, missing metadata, anonymous identities, no exposures, expansion before view, repeated views, zero/positive expansion and repeated client across hours. No additional fixture table writes. `advanced-fixture.json` stores only hashes/status/query IDs.
- Local red/green: initial missing-module failure recorded in tool transcript, then four advanced tests pass. They include rejection of unsupported rollup workloads and partial-hour boundaries. All eight local pilot tests pass. Rollups explicitly accept only increasing hour-aligned single windows. For multiple windows, callers must invoke one at a time; partial edges are deliberately rejected.
- `advanced-results.json`: 304/304 requests succeeded and matched raw references; all 212 observations with saved PG evidence match. Each candidate/case/profile has one warmup and three measured repeats. Shuffled order, query cache and condition cache disabled, max_threads=2. Event projection tested on all 15 workloads × both original windows; identity projections on their relevant workload; metadata, funnel and rollups on applicable workloads. Typed baseline independently remeasured for all 15 workloads.
- `rollup_fine.py`: a measured follow-up after the coarse exact-state rollup regressed on hourly traffic. The separate fine table uses index_granularity=64, copies the same aggregate states, and retains the original negative results.
- `rollup-fine-results.json`: 72/72 requests match raw; all 48 available PG observations match. Three layouts (typed baseline/coarse/fine), three workloads, two windows, warmup+3 repeats, shuffled.
- `advanced_evidence.py` collects footprint, mutations and redacted EXPLAIN indexes=1, projections=1 plans. `reconcile_advanced_logs.py` merges metadata-only query log reads over independent connections. `summarize_advanced.py` produces `advanced-summary.{json,md}` and `rollup-fine-summary.{json,md}`; JSON reports sample counts, client min/median/max, read rows and available server evidence.

## Findings to carry into final report

- Compact metadata: 575,129 rows / 17,068,594 bytes, populated in 2.15s. Median hour 209.6ms vs typed 947.7ms (4.52×); day 638.7ms vs typed 2002.6ms (3.14×). This includes the metadata scan and retains historical selection semantics; it does not substitute latest/current metadata.
- Single-pass funnel: hour 90.8ms vs 100.5ms (1.11×); day 275.1ms vs 312.4ms (1.14×). Day reads one 1,777,563-row pass rather than two. A modest result needing independent repeat.
- Coarse rollup: 17,437 state rows / 20,323,164 bytes, populated in 2.18s. Event counts/day ~71.7ms vs typed ~197.5ms. Traffic/hour regresses to ~151–154ms vs typed ~83–85ms because one selected default granule reads 9,245 state rows containing costly exact sets. Preserve this negative finding.
- Fine rollup: 25,323,574 bytes, copied from states in 1.23s. Hour reads 128 rows, 2/272 granules; day 2,269 rows, 35/272 granules. Daily traffic median 81.5ms vs same-control typed 211.8ms (2.60×); hourly traffic ~74ms vs typed ~83–84ms. Fine server medians: event counts 4ms/hour, 6ms/day; traffic 7ms/hour, 16–17ms/day. Client network/HTTP overhead limits small-query gains. This is an exact static backfill proof of concept, not an installed incremental view or measured ongoing ingestion cost.
- Lightweight identity projections ARE selected without query predicate changes. Plans show two projection marks / 16,384 candidate projection rows on day queries. Their scattered offsets still cause roughly 1.2M base rows to be read and client gains are only ~1.1×. Do not confuse projection candidate rows with base rows.
- Event-first projection is selected for the broad metadata-side scan but not the selective day feature-count/AB-assignment cases. Overall small or absent gains. Empty-SSR day regresses (~340ms vs typed ~179ms); the cohort has **no SSR rows**, so never present that as representative of populated SSR workloads. Synthetic SSR correctness exists from core stage.
- Projection materialization seconds: event 19.18, user 12.15, session 14.14, tab 14.16. Copy seconds: 8.56, 7.14, 7.03, 6.58 respectively. Projection bytes: event 63,562,101; user 46,012,970; session 71,879,514; tab 70,568,800. These are additional to typed base data; isolated table copies have somewhat different part boundaries, an additional comparison limitation.

## Evidence limitations and next owner

- Main advanced pass has complete HTTP/client observations and hashes, but the current query-log collection contains **0/304** main advanced IDs. All **72/72** fine-control IDs are present. `clusterAllReplicas(default,system.query_log)` and 12 fresh local system.query_log connections did not recover the absent main IDs. Both available cluster names reported one member. Do not invent server timings or treat missing logs as failed queries. `query_log_samples` explicitly exposes this gap. The cause is unresolved; independent repeat can collect logs while its connection remains open or preserve each collection incrementally.
- No PostgreSQL query was made. No source write, source recopy, global-setting change, resize, or source schema change. Build journal entries all completed; no failed INSERT was retried. Private-selection leak scan of all pilot files passed.
- The original full source is ~2.32B rows; this pilot is a bounded eight-day subset. Results do not establish full-retention scaling or equal-cost hardware comparisons. Saved PostgreSQL hardware remains unknown. Derived tables have explicit preprocessing/storage costs and no ongoing refresh mechanism installed.
- Next stage: independent review, second shuffled core pass (`pilot.py benchmark --passes 2`), repeated advanced strongest/negative cases as useful, unseen September 7 windows against raw-only new hashes, then update the comparison report. Metadata requires seven-day preceding coverage; use September 7 windows unless explicitly checking coverage. Rollups require hourly aligned windows; test expected rejection for a nonaligned one. Do not rerun advanced build functions against existing tables.
- `candidate_sql` can take source/metadata/rollup overrides and `custom_windows`. For fine rollups use candidate `rollup` with `rollup='benchmark_20260910.hourly_rollup_fine'`. Saved PG hashes apply only to original windows. Do not run a second core pass from this completed stage.

## Exact repeat commands (new output; preserve original pass)

```sh
python docs/analytics-benchmark/clickhouse-pilot/advanced.py benchmark --output advanced-repeat-results.json --seed 94732
python docs/analytics-benchmark/clickhouse-pilot/rollup_fine.py benchmark --output rollup-fine-repeat-results.json --seed 12482
python docs/analytics-benchmark/clickhouse-pilot/summarize_advanced.py --input advanced-repeat-results.json --output advanced-repeat-summary
python docs/analytics-benchmark/clickhouse-pilot/summarize_advanced.py --input rollup-fine-repeat-results.json --output rollup-fine-repeat-summary
```

Each repeated runner skips only already-recorded slots in its specified output file; a distinct output produces a fresh warmup+3 pass. `advanced_evidence.py` overwrites `advanced-evidence.json`, so preserve/merge the existing file before collecting new evidence; update the log reconciliation runner input list if using repeat output names.

For an unseen UTC window, import `candidate_sql` from `advanced` and `sql_for` from `pilot`; call `sql_for('raw', case, 'hour', client.params, custom_windows=[('unseen_10h', datetime(2026,9,7,10,tzinfo=timezone.utc), datetime(2026,9,7,11,tzinfo=timezone.utc))])` for a fresh reference. Pass the same tuple to `candidate_sql('metadata', 'metadata_join', 'hour', client.params, custom_windows=...)` etc. For fine rollups pass `candidate_sql('rollup', case, 'hour', client.params, custom_windows=..., rollup=DB+'.hourly_rollup_fine')`. Compare raw/candidate result hashes; do not compare unseen-window hashes to saved PostgreSQL results. Multiple windows require separate calls for metadata/funnel/rollup; all are accepted by the core renderer.
