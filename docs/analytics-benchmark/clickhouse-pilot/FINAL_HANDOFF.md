# Final ClickHouse pilot handoff

**Status: complete. No pending required benchmark work.** No PostgreSQL connection or request was made during optimization or repeated testing. Source data/schema and global settings were not modified. All writes were confined to the isolated `benchmark_20260910` database during earlier build stages; this final stage issued SELECT/metadata requests only.

Read [FINAL_REPORT.md](FINAL_REPORT.md), the prominent completed-pilot section in [the comparison](../2026-09-10-comparison.md), and [final-summary.json](final-summary.json). Earlier HANDOFF/ADVANCED_HANDOFF notes preserve historical findings, not outstanding instructions.

## Completed validation

- Core: two shuffled passes, **960/960** requests complete and matching raw; **672/672** available saved-PG comparisons match.
- Advanced: original plus independent repeat, **608/608** raw matches; **424/424** available PG matches.
- Fine/coarse controlled rollup: original plus repeat, **144/144** raw matches; **96/96** available PG matches.
- New predicates: **904/904** raw matches across four September 7 UTC windows: 10:00–11:00, 18:00–19:00, 04:00–09:00, 13:17–15:43. All 15 workloads tested on raw, typed and event-projection layouts, plus applicable targeted candidates. Each case has one warmup and three measured repeats. **60 fresh raw references** are separate from timed/control requests.
- Total: **2,616/2,616** successful benchmark requests; **1,192/1,192** available saved-PG matches. Three expected partial-hour rollup rejections are recorded separately and are not counted as successful database requests.
- All 1,760 independent repeated/new-window requests have server logs. Original core and fine logs also exist. The initial advanced **0/304 log gap remains unresolved and explicitly preserved**, with complete HTTP/client/hash evidence.
- Independent final edge fixture: four explicit DuckDB assertions and **17/17** live candidate comparisons passed, supplementing previous all-workload raw/typed and advanced fixtures. Covers anonymous-view eligibility, expansion ordering, exact metadata tie/null/time behavior, cross-hour exact distinct state merging, empty and partial windows.
- **10 local unit tests pass**, including red/green regression tests for final metadata comparison. All pilot Python files compile. Whitespace checks and private-value scans pass.

## Stable headline results

Core pooled client medians (six samples across two passes): hourly event counts **84.4ms typed vs 411.6ms raw**; daily funnel **314.2ms vs 1562.1ms**; daily AB outcome **428.7ms vs 1935.9ms**; daily feature counts **189.0ms vs 864.8ms**.

Independent advanced repeat: compact metadata/day **611.3ms**, **2.68×** same-pass typed; one-pass funnel/day **263.4ms**, **1.19×**; fine daily traffic **82.8ms**, **2.50×**. Coarse hourly traffic regresses (**153.9ms vs 84.4ms typed**), while fine granules yield **73.6ms**. Identity/event projections offer mostly modest or absent gains.

Novel 10:00–11:00 event counts: typed **80.5ms / 73,728 rows**, raw **407.1ms / 13,711,369 rows**, time projection **87.6ms / 172,032 rows**, minmax **258.6ms / 2,457,600 rows**. Query and condition caches disabled throughout.

The saved PG comparison is contextual, not controlled engine/cost ranking. Examples: old PG hourly counts **141.5ms**, daily funnel **7496.4ms**, daily AB outcome **8486.7ms**; old PG daily feature counts **116.6ms** remains faster than typed ClickHouse. Do not invent values for old PG timeouts.

## Final state and limitations

[final-verification.json](final-verification.json) confirms identical source DDL and part totals, all **40** journaled build operations complete, all pilot mutations done, and **no active benchmark query**. Total retained active-part storage is **3,415,122,357 bytes across 12 pilot tables**, including the 27-row typed fixture and projections. Full per-table footprint is included in the final summary. No cleanup or deployment is pending.

This is a fixed **13,711,369-row, eight-day-plus-five-minute** cohort copied once from a 2,315,652,132-row source. All subsequent candidates derive from that fixed copy. It is not a shared transactional snapshot with saved PostgreSQL; aggregate equality validates 21 completed original outputs, not whole-import completeness. Source verification is metadata plus audit of our operations, not a full content checksum.

Typed extraction, ordering and monthly partitions are combined. Typed storage excludes the full JSON payload. Copy/part boundaries differ among layouts, and minmax effectiveness depends on clustering. No full-retention scaling, equal-cost hardware, ingestion/update/delete/late-event handling, or live refresh was measured. Rollups/compact metadata are static backfills. The real cohort has zero SSR rows; positive synthetic SSR correctness exists, but real-data SSR timings are not representative. Identity tests reuse one private identity per type and do not sample their selectivity distribution.

## Preserved failures and follow-up notes

- The final metadata verifier initially compared live tuples with saved JSON lists and falsely flagged changes. [final-verification-initial.json](final-verification-initial.json) preserves that run. Serialized rows and hashes matched. A failing regression test reproduced the issue; canonical row hashing fixed it and the live metadata rerun passed. No candidate SQL or source change was needed.
- One new synthetic assertion initially expected one null-metadata group member; the fixture correctly grouped two tabs. Inspection of synthetic output corrected the expectation before live validation.
- The final summary gate caught 19 delayed novel logs after the runner's last eight-second wait. Summary publication stopped; dependent report generators also exited because no summary existed. A later metadata-only log read recovered all 19, and summary/report generation then succeeded. No workload was rerun or result substituted. Future runs may similarly need a delayed metadata collection before the summary gate passes.
- Out-of-scope portability issue: `portable/queries.py:timestamp` formats wall-clock fields as UTC without normalizing non-UTC datetime offsets. All benchmark dates explicitly use UTC, so results are unaffected. Use UTC inputs until that shared renderer is separately hardened.

## Files and reproducibility

Final stage adds `final_repeat.py` (incremental logging and new windows), `final_fixture.py`, `final_verify.py` and its regression test, `final_summary.py`, `write_final_report.py`, and `update_comparison.py`. It extends `results.json` with pass 1, writes distinct advanced/fine-repeat results, novel results/plans, final query logs/verification/fixture/summary/report, updates the core summary and comparison, and points old handoffs here. No unrelated working-tree changes were touched.

Runner imports exclude PostgreSQL drivers and connection code. Private selections remain only in `/tmp/analytics-benchmark/private-params.json`; never print or persist `Client.params` or credentials. Existing completed slots are skipped, so a fresh repeated benchmark requires a new output path. Do not rerun any build command against existing tables or redo the full-source copy. Final summary combines original evidence and incremental final logs, and refuses incomplete or mismatched stages.
