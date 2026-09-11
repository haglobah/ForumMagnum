# Full typed-table loader: initial validation

Completed 2026-09-10 UTC. No PostgreSQL calls, source writes, ingestion changes, global setting changes, or service resizing. Full bulk load has **not** started.

## Completed stages

The frozen 241-chunk plan covers all 2,315,652,132 snapshot rows. Two chunks are complete:

| Plan index | Table in benchmark_full_20260910 | Rows | Monthly parts after compaction | Referenced bytes |
|---|---|---:|---:|---:|
| 55 | chunk_0055_efbb888b5812 | 692,581 | 1 | 11,753,198 |
| 0 | chunk_0000_22ca444cbf14 | 10,000,000 | 41 | 209,953,984 |

`loader-state.json` durably checkpoints these as **complete**. Each passed exact row/null counts and order-independent 128-bit sum and XOR fingerprints for all 13 columns individually and for the complete row. Fingerprints give strong probabilistic multiset equality evidence, not a mathematical proof of equality. Neither raw JSON values nor selected private event values are in evidence; timestamp bounds, counts, and hashes are aggregate summaries.

Snapshot inventory was checked before and after both chunks and assembly. It matches `snapshot-manifest.json` exactly, including names and payload hashes.

## Measured cost and remaining estimate

| Operation | 692,581 rows | 10M rows |
|---|---:|---:|
| INSERT client time | 2.12 s | 32.30 s |
| INSERT server peak query memory | 396,511,962 bytes | 2,978,349,977 bytes |
| Raw transformation fingerprint client time | 2.03 s | 26.33 s |
| Typed fingerprint client time | 0.95 s | 11.42 s |
| Raw fingerprint peak query memory | 187,849,048 bytes | 78,800,621 bytes |
| Typed fingerprint peak query memory | 117,838,175 bytes | 187,089,957 bytes |

The 10M-row source INSERT and fingerprint each read 10,002,432 rows, showing bounded physical-offset pruning. The 10M stage spans 41 distinct months (2019-11 through 2025-11). The small stage occupies one month.

The 10M stage's first whole-table OPTIMIZE failed after scheduling some merges (see below). Six remaining partitions were compacted sequentially; each scheduling call took 71–85 ms, followed by approximately 0–1 seconds polling until one active part remained. This mixed recovery is **not** an unbiased full compaction timing. The next chunks should establish steady sequential-compaction overhead.

INSERT + both validations extrapolate to roughly **4.5 hours for all rows**, before compaction, metadata, assembly, and variation in historical payloads. A **5–8 hour working estimate** is reasonable for planning, but is not a bound or SLA; update it after additional chunks. About 2.305B rows remain. Do not drop verification to improve reported throughput.

Storage extrapolates to roughly **49 GB for typed data** from the 10M historical sample, versus the older pilot's37GB estimate. Retained stages and destination refer to the same attached part payloads during metadata assembly. Sum of their logical `bytes_on_disk` is not a measurement of distinct physical object storage or billing. Keep all verified stages until publication is fully verified.

The source stage previously observed the existing service at4cores/16GiB; this loader did not resize it. Queries retain max_threads2 and max_memory_usage4,000,000,000.

## Recovery and assembly exercised

`fixture_6a38d89d16aa` contains the two stages: **10,692,581 rows,42 active parts,221,707,182 referenced bytes**. ATTACH PARTITION ALL FROM is supported on this Cloud SharedMergeTree service. Full multisets of `(partition_id,rows,bytes_on_disk,hash_of_all_files)` match retained stages, including multiplicities.

`fixture_recovery.py` deliberately converted the successful first ATTACH response into an explicit simulated transport failure. The next process reconciled no active query plus QueryFinish across replicas and compared the complete destination inventory. It accepted the completed attachment without executing it again, then attached the second stage. **Two stages, exactly two ATTACH calls.** Evidence is `fixture-recovery.json` and operation journal. The fixture is not the published destination.

An actual expired keepalive interrupted the first read-only recovery attempt after a10-second wait; it is preserved in evidence. Recovery resumed using a new connection. No mutation replay occurred.

## Visible failures and corrections

1. First small-chunk INSERT was rejected before execution with code452, SETTING_CONSTRAINT_VIOLATION: the server prohibited changing max_partitions_per_insert_block. All-replica query logs confirm ExceptionBeforeStart and zero written rows. `chunk_0055_63f7aa1909ba` remains an abandoned empty stage; a fresh stage received the successful INSERT. We did not alter profiles/global settings. `system.settings` read-only flags were observed under a readonly query and alone must not be interpreted as proof that every setting is constrained. The actual mutation's452 establishes the prohibited partition-limit override.
2. The10M INSERT succeeded. A whole-table OPTIMIZE FINAL then failed with code388, CANNOT_ASSIGN_OPTIMIZE, because the background pool was full. This was a compaction failure, not an INSERT failure. The loader reconciled its terminal status, retained the successful INSERT, and compacted remaining months sequentially. Future stages use sequential partition compaction from the outset. As alter_sync may be0, the loader polls actual active part count rather than assuming a successful scheduling response means merge completion.
3. The fixture's successful ATTACH had an intentionally simulated lost response, described above.
4. A real read-only keepalive expired during the fixture wait. Evidence is retained; reconnecting and resuming succeeded.

The per-chunk timestamp preflight checks distinct months against the enforced default max_partitions_per_insert_block100. It refuses rather than skips or discards rows if a later chunk exceeds the limit. Should that arise, implement deterministic disjoint month subchunks within the unchanged parent part/offset interval and journal them before proceeding; do not casually regenerate an already frozen plan.

## Validation and next commands

`python3 -m unittest discover -s docs/analytics-benchmark/clickhouse-full -p 'test*.py'` passes **17 tests**. Initial red test run failed because loader.py did not exist, before implementation. Coverage includes uncertain INSERT outcome with actual orchestration and no repeated client call, terminal failed INSERT, abandonment waiting for terminal evidence, partial attachment refusal and assembly abandonment, payload multiplicity, publication UUID reconciliation, manifest drift, and filesystem lock contention.

Independent review is required by the parent stage before bulk execution. Then:

```bash
python3 docs/analytics-benchmark/clickhouse-full/loader.py load --max-chunks 241
```

This skips the two completed stages and loads remaining chunks serially. Any error stops visibly; resume with the same command after reconciliation. Never manually replay an INSERT. `load --chunk N` resumes a specific chunk. `abandon --chunk N` requires terminal evidence for outstanding failed/unknown operations, preserves its table as evidence, and causes a subsequent load to allocate a fresh table. A validation mismatch should be investigated, not blindly abandoned.

After every chunk is complete:

```bash
python3 docs/analytics-benchmark/clickhouse-full/loader.py assemble
python3 docs/analytics-benchmark/clickhouse-full/loader.py publish
```

Assembly retains all stages. An ambiguous partial ATTACH marks the assembly abandoned; the next assemble creates a fresh destination from verified stages, without rereading raw JSON. Publication uses a single RENAME and verifies table UUID, then restores ordinary destination merge settings. The destination is `benchmark_full_20260910.typed`. Publication helper has unit-level UUID recovery coverage; full production publication is not yet executed.

Run final full-retention benchmark validation after publication. Preserve the original raw snapshot and existing pilot. No cleanup or benchmark process is currently running.
