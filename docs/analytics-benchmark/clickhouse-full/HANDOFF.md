# Loader stage handoff — COMPLETE initial chunks; bulk remains

The newer [LOADER_REPORT.md](LOADER_REPORT.md) is the operative continuation report. `loader.py`, `test_loader.py`, and `fixture_recovery.py` implement/test the resumable loader and recoverable assembly/publication. **17 tests pass.** Chunk indices55 and0 are COMPLETE:10,692,581 typed rows total, all13-column multiset fingerprints match raw transforms. The241-chunk plan and snapshot/DDL/projection hashes are frozen in `loader-state.json`. Two retained stages and a successfully reconciled42-part fixture assembly exist. No bulk process, active loader query, or publication is running.

Next owner: independently review loader, then `python3 docs/analytics-benchmark/clickhouse-full/loader.py load --max-chunks 241` (requires authorized network escalation). It skips completed chunks. All dates/envs, fixed snapshot, tested13columns, current compute; no PostgreSQL. Expect several hours (~5–8 initial estimate including all-column verification, revise from ongoing timings); ~49GB typed compressed estimate. Read the report's explicit failures, recovery rules, and constraints before running. Original snapshot-stage evidence below remains valid; its statement "no typed backfill started" is historical and superseded.

---

# Full-history typed ClickHouse build — snapshot stage

User authorized: all dates/environments, fixed snapshot, 13 tested columns, current compute. Never query PostgreSQL. No source data, ingestion, global configuration or service sizing changes. Parent owns continuation. No typed backfill has started.

## Established snapshot

`benchmark_full_20260910.raw_snapshot` was cloned at **2026-09-10 23:14:47 UTC**. Query ID `full-build-0f08e944-3e33-4605-a1e8-5dda33538289`; 353 ms client latency. Contains **2,315,652,132 rows**, **17 active parts**, **135,946,797,737 referenced bytes**. Referenced bytes are logical part storage and are NOT evidence that clone consumed another 136 GB physically.

All eight original raw columns remain, including PeerDB version/deletion fields. No filtering, deduplication, JSON conversion or event timestamp cutoff was applied. Source's before/after physical part inventory is identical. Multiset of `(partition_id, rows, bytes_on_disk, hash_of_all_files)` equals the clone's inventory exactly; clone renumbers part names. `snapshot-manifest.json` is the durable chunk identity inventory. This is much stronger snapshot evidence than count equality alone.

Successful SQL:

```sql
CREATE TABLE benchmark_full_20260910.raw_snapshot
CLONE AS default.public_raw
ENGINE=MergeTree ORDER BY tuple()
SETTINGS max_bytes_to_merge_at_max_space_in_pool=1,
         max_bytes_to_merge_at_min_space_in_pool=1,
         min_age_to_force_merge_seconds=0;
```

Only the isolated clone has merge size ceilings of one byte; every existing part is >31 MB, so automatic merges cannot combine its existing parts. Force-age merging is off. No TTL exists. These table settings persist across restarts and apply to the shared table, unlike a node-local SYSTEM STOP MERGES. No external process is configured to write to the dedicated table. **Do not OPTIMIZE, mutate, insert into, or change snapshot settings during the build.** Compare exact current snapshot inventory with manifest before every chunk and on completion; abort visibly if any identity changes. We did not create role-level immutable grants; immutability is by isolated ownership plus checked inventory, not a claim of database-enforced WORM.

## Efficient bounded source reads proven

Predicate `_part='all_0_0_4' AND _part_offset>=1000000 AND _part_offset<1100000` returned precisely100,000 rows while reading106,496 rows, in215ms server time. It did NOT scan the503M-row part or the2.32B-row table. Evidence: `chunk-pruning-read.json`. EXPLAIN emitted only high-level plan, so execution read counters provide the pruning evidence.

`chunk-plan.json` contains241 contiguous, nonoverlapping chunks capped at10M rows each covering every row in the17 snapshot parts. This is a provisional throughput-oriented chunk size. Start with a small part (692,581 rows) or smaller offset chunk for conversion/insert assessment; regenerate an immutable plan if changing chunk size BEFORE starting its journal. Time values inside a100K-row physical chunk span2019–2025, so chunks can produce many monthly partitions. Check/adjust per-query `max_partitions_per_insert_block` to actual historical range if needed; never silently drop old rows.

## Next implementation and execution

`typed.sql` is the exact13-column pilot schema; `projection.sql` is the exact pilot extraction from the new snapshot. They retain strict Decimal conversion and historical null/path semantics. Source historical JSON can still fail conversion; show failures and investigate before changing semantics. Pilot client enforces max_threads2 and max_memory_usage4,000,000,000. Current service reports **4 cores/16GiB**, already larger than previous pilot report; no resizing was done. Keep query limits initially.

Recommended recovery design:

1. Each source chunk builds into a unique staging table using `typed_ddl(stage_name)` and `raw_projection(SNAPSHOT) + WHERE <part/offset bounds>`. Record SQL, query ID, expected rows BEFORE submitting. Validate count plus exact typed aggregate/fingerprint checks against source chunk. A failed/ambiguous INSERT is NEVER repeated into the same staging table. Reconcile system.processes/query_log and discard or isolate partial attempt before a new attempt table.
2. Retain successful staging chunk tables until publication. This checkpoints expensive raw JSON extraction. Source chunks are disjoint; row counts alone cannot validate malformed conversion.
3. Metadata-only assembly candidate: `ALTER TABLE typed_building ATTACH PARTITION ALL FROM chunk_table`, with identical schema/sort/partition keys. Destination automatic merges must be disabled during assembly (same1-byte ceilings/force-age0) so content part hashes remain stable for reconciliation. Before/after attach, compare MULTISETS of rows/bytes/hash_of_all_files, ignoring part names. A failed attach may have partially attached partitions: do not repeat blindly. Rebuild empty destination from retained stages, or identify/reconcile exact attached content. Validate actual SharedMergeTree attachment behavior on a small staging fixture before adopting this.
4. Alternative simpler recovery is a single `INSERT INTO typed_building SELECT ... FROM merge(...)` of verified staging tables; failed final assembly can be recreated from retained stages without rereading JSON. This has more read/write cost but avoids fragile partial attach bookkeeping.
5. After full count/checksums/semantics verified, enable normal merge settings on the typed destination, perform atomic rename to `typed`, and benchmark. Snapshot stays fixed. Only drop staging tables after destination validated and publication recorded. No existing pilot/raw table cleanup is authorized by this task's stage.

Need meaningful red/green tests for chunk execution/recovery, abort-on-manifest-drift, and exactly-once assembly before full INSERT. Existing5 tests cover mutation no-blind-retry and chunk coverage/tails/invalid size. Run `python3 -m unittest discover -s docs/analytics-benchmark/clickhouse-full -p 'test_build.py'` (passes).

## Failure evidence and harness limitations

Initial CLONE with ENGINE override but without explicit ORDER BY failed `Tables have different ordering`. Query `full-build-c4b1d100-7e7b-4f55-8a4d-8391165961c5` remains an error in journal. Read-only reconciliation proved no table, parts, or active query; corrected attempt used a distinct label. No source mutation occurred. Do not erase error to claim all operations passed.

Initial read inside sandbox failed DNS; escalated network execution succeeded. No credential output. A local snapshot verification first compared tuples to JSON lists and failed; corrected comparison passes. `reconcile_snapshot.py` is historical one-off code that deliberately queried an absent table and failed; do not rerun it as normal build workflow. `create_snapshot.py` is the successful one-off recovery (also not rerunnable). `build.py snapshot` should not be rerun now: journal prevents repeated DB/clone mutations. Read metadata/manifest functions are reusable. Client is imported from pilot and requires existing private params file even though this stage never uses private selection values; future cleanup can separate transport if desired. No PostgreSQL driver is imported.

`save` fsyncs file and parent directory. Journal presently assumes one orchestrator/process; add filesystem locking before multiple concurrent writers. No other full-build process was active at handoff (`active-queries.json`).

## Official sources consulted

- [CREATE TABLE CLONE AS](https://clickhouse.com/docs/reference/statements/create/table): clone copies schema/data via ATTACH PARTITION ALL; explicit engine override supported.
- [SharedMergeTree](https://clickhouse.com/docs/products/cloud/features/infrastructure/shared-merge-tree): Cloud rewrites MergeTree to SharedMergeTree; same-node/same-session reads see metadata; async metadata replication caveat.
- [MergeTree virtual columns](https://github.com/ClickHouse/ClickHouse/blob/master/docs/en/engines/table-engines/mergetree-family/mergetree.md): `_part` and `_part_offset` identify row positions inside a part.

Operational support for clone and virtual-column pruning was verified directly on the current26.2.1.641 Cloud service. Future source inserts do not affect this independently attached snapshot.
