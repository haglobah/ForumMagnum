# Bulk build ownership — RUNNING

Owner: `/root/full_bulk`; parent `/root` handles user updates and final benchmarks.
Scope: all dates/environments, immutable fixed snapshot, tested13columns, current service size. Never query PostgreSQL, alter ingestion/source/global settings, resize, or drop retained evidence.

2026-09-10 23:30 UTC: independently reviewed loader.py, build.py, test_loader.py and stage reports;17 tests pass. Started `python3 docs/analytics-benchmark/clickhouse-full/loader.py load --max-chunks 241`, PTY session76858, output `bulk-run-1.log`. CLI holds loader.lock. Two prior complete chunks0,55 comprise10,692,581 rows; now loading chunk1. Do not launch a concurrent loader. Process status and durable loader-state.json are authoritative.

Full target2,315,652,132rows in241chunks. Read LOADER_REPORT.md for safety/recovery and source snapshot identity. Keep snapshot and all stages through parent validation. Next after complete load: review assembly stage inventories, `loader.py assemble`, `loader.py publish`; verify all chunks/fingerprints/count/UUID before publication. Report progress to parent about once a minute. No active goal was created; user did not explicitly request a goal.

This is an interim ownership note, not a completion report. Full operation continues.

## Bulk continuation adjustments

-19 tests now pass. New red/green tests cover skipping naturally completed monthly compactions while still waiting for real physical completion, and checking actual assembled payload multiset plus full plan row count immediately before rename.
-Compaction polling0.2sec; check monthly active partcount before scheduling FINAL so automatic merges that finished in the meantime need no redundant maintenance.
-First bulk run intentionally interrupted via SIGINT after chunk3 freeze completed, in read-only validation. Prior writes remain journaled and are never replayed. First log retains KeyboardInterrupt.
-Read-only thread calibration: local elapsed-value parsing TypeError fixed;2-thread chunk1 reference matched25.87sec.4-thread SQL override failed Code164 because readonly1 forbids modifying max_threads inside SQL. This is not evidence that4threads are prohibited via HTTP settings or by compute capacity. No further tuning; default transport remains2threads4GBcap.
-Resumed loader session66503, `bulk-run-2.log`, journal authoritative. At restart chunks0,1,2,55complete (30,692,581rows), chunk3 writes complete awaiting fingerprints. No insert was replayed.

## Final bounded thread calibration — supersedes earlier stop-tuning note

At parent's request, paused safely after chunk7 freeze to make one supported SELECT-only calibration using the existing transport's readonly=0 flag and explicit FORMAT JSON. Flag named `mutation=True` changes transport mode only; submitted SQL was a SELECT with request-local max_threads, never a SQL mutation.

`thread-calibration-readonly0.json`: raw10M-row fingerprint2threads25.49sec,4threads13.93sec; both match saved full13column reference exactly. New guarded full-loader read option permits thread override only on expected fingerprint SELECT shape.20tests pass (red/green transport/localsetting guard). Applied4threads only to source/typed fingerprints. INSERT remains2threads; unchanged4GB cap; no shared pilot transport edit or global/service change.

Current loader session65266, `bulk-run-3.log`, resumed from frozen chunk7 fingerprint phase. At resume verified70,692,581rows8/241. Earlier sessions ended intentionally with SIGINT, not new load failures. No further parameter tuning planned. `bulk_status.py` reports local journal progress without database calls.
