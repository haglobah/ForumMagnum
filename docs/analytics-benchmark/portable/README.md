# Portable analytics performance suite

A repeatable benchmark of the workloads from the [original PostgreSQL investigation](../README.md) and [long-range investigation](../long-range/README.md), runnable against PostgreSQL, ClickHouse, DuckDB over Parquet (or a DuckDB table), and StarRocks.

This is an implementation and experiment protocol, **not a claim that any engine has won**. Synthetic queries have executed against all four engines, including DuckDB over Parquet. ClickHouse and StarRocks each matched DuckDB on all 15 workloads across all six time profiles; see the [live validation evidence](live-validation-results.json). Complete a small representative snapshot comparison before scaling up.

See [TUNING.md](TUNING.md) for the tuning sequence and how the previous observations motivate these workloads.

## Install and test

Use Python 3.11+ in an isolated environment:

```bash
cd docs/analytics-benchmark/portable
python -m venv /tmp/analytics-perf-venv
/tmp/analytics-perf-venv/bin/pip install -r requirements.txt
/tmp/analytics-perf-venv/bin/python test_suite.py
```

The test executes DuckDB table and Parquet versions, checks explicit expected answers, parses all four SQL dialects, and verifies timeout/correctness guards. To additionally execute all workloads on PostgreSQL, set `BENCH_TEST_POSTGRES_DSN` to a **disposable local database**. The test uses a temporary table and rolls back.

For a reusable smoke dataset (27 synthetic events, no real user data):

```bash
/tmp/analytics-perf-venv/bin/python test_suite.py --write-fixture /tmp/analytics-fixture
/tmp/analytics-perf-venv/bin/python runner.py run \
  --engine duckdb --parquet '/tmp/analytics-fixture/*.parquet' \
  --case traffic_day --case metadata_join --case coverage --profile hour \
  --params /tmp/analytics-fixture/params.json \
  --manifest /tmp/analytics-fixture/manifest.json \
  --timeout 10 --repeats 2 --resources 'synthetic smoke test' \
  --output /tmp/fixture-duckdb-results.json
```

Load that directory into another engine with `load_snapshot.py --engine ENGINE --snapshot /tmp/analytics-fixture`, run the same cases/profile/parameters/manifest, then compare the result files. This lets you test ClickHouse/StarRocks compatibility before any real-data export. Synthetic timings do not predict large-dataset performance.

Validation performed during implementation: all 15 workload cases produced identical exact result hashes on PostgreSQL 18.1 and DuckDB 1.5.5; DuckDB table/Parquet semantic fixtures passed; 24 empty monthly buckets were preserved by coverage; real PostgreSQL/DuckDB timeout cancellation passed. Standalone snapshot loading, timed runs and comparison were additionally exercised with the synthetic snapshot. The additional live run passed all 90 workload/profile combinations on ClickHouse 26.8.2.7 and StarRocks 4.1.4, using 675 synthetic events with all 24 first-of-month days populated. Exact full-row comparisons verified IDs above `2^53`, UTC microseconds, decimals, nulls, empty strings and numeric-looking variants. Real one-second server timeouts were followed by a healthy query and an active-query check.

Repeat the live validation with Docker available:

```bash
/tmp/analytics-perf-venv/bin/python live_validation.py --output /tmp/live-validation-results.json
```

[live_validation.py](live_validation.py) defaults to the exact official image digests recorded in the evidence. It pulls the images, runs one disposable server at a time with loopback-only random ports, a 12 GiB memory ceiling and four CPU cores, loads only synthetic data, checks all 90 cases against DuckDB, exercises the timed runner and server cancellation, and removes containers and their anonymous volumes in `finally`. Docker images remain cached. Allow sufficient disk for both images and memory for StarRocks. Use `--clickhouse-image` / `--starrocks-image` to validate a different release; each report records versions, image digests and suite source hashes. This script never uses your analytics database credentials.

Live execution found and fixed two issues that dialect parsing missed: ClickHouse needed explicit aliases on joined metadata CTE columns, and StarRocks timeout error 5024 needed explicit classification as a server timeout. MySQL transport errors 2006/2013 are classified separately and stop subsequent samples. The shared SQL change also passed the PostgreSQL semantic regression suite.

On Nix systems, binary DuckDB wheels may need the system GCC runtime directory in `LD_LIBRARY_PATH`. This is an environment requirement, not a database tuning change.

## Workloads and semantics

All timestamps are UTC, intervals are `[start,end)`, counts/distincts are exact, and `NULL` differs from the empty string. Every case returns aggregate rows; no raw user/session/tab identities are stored in benchmark outputs.

| Case | Question and exact semantics |
|---|---|
| `traffic_hour`, `traffic_day` | Page loads/navigation by hour/day, event count and distinct clients per bucket/event type. Do not sum daily distincts to get period distincts. |
| `event_counts` | Count each event type in the range. |
| `user`, `session`, `tab` | Count event types matching one supplied identity. Sample identities separately; use identical parameters on every engine. |
| `post_paths` | Count navigation/page-load/timer events with normalized `/posts/` paths. |
| `feature_counts` | Counts and distinct users for UltraFeed viewed/expanded events. |
| `feature_funnel` | Earliest logged-in exposure per environment/tab/item in each window; any positive expansion at/after exposure within the same window. Repeated exposures/outcomes count once. Collapse events do not count. |
| `ab_assignments` | Raw metadata event counts and distinct clients by variant, using both `ssr` and `tabStarted`. These are not deduplicated assignment/person counts. |
| `ab_outcome` | Earliest metadata event per tab in each window, ties by smallest exact event ID; any subsequent navigation inside that window. Unknown variants remain unknown; end-of-window outcomes are censored. Descriptive, not a causal estimator. |
| `ua_bot` | Metadata events classified by case-insensitive ASCII substring `bot`, `crawler`, `spider`, `slurp`, or `headless`. Missing/empty UA is unknown. `not_matched` does not mean human. |
| `metadata_join` | Each page event gets latest same-environment/tab metadata from either source in `[page−7 days,page+5 seconds]`, ties by largest exact ID. Group by variant, metadata source, and UA class. Unmatched pages remain present; no fanout. |
| `ssr_association` | Raw SSR events with at least one same-environment/tab page load in `[SSR−5 seconds,SSR+5 minutes)`. Several loads still count as one associated SSR. Temporal association, not request correlation. |
| `coverage` | Per-window event count and number of event types, explicitly retaining all empty windows. Run this alongside analytical cases. |

These are a versioned **canonical typed** implementation of the same workload families, not byte-for-byte copies of previous PostgreSQL SQL. Both historical/current metadata sources are included deliberately. The original query artifacts remain unchanged. [queries.py](queries.py) is the semantic specification; generated SQL has engine-specific time arithmetic and literal bounds for each window. This avoids the planner problem from a generic range join. No lateral joins or correlated existence subqueries are required.

Fixed profiles, matching the investigation:

| Profile | UTC range |
|---|---|
| `hour` | September 7, 2026, 00:00–01:00 |
| `day` | September 7–8, 2026 |
| `week` | September 1–8, 2026 |
| `month` | August 8–September 8, 2026 |
| `six_months` | March 8–September 8, 2026 |
| `monthly24` | 24 separate first-of-month UTC days, October 2024–September 2026 |

`monthly24` uses 24 independent literal-bounded branches, not a continuous 24-month scan. Grouped analytical results omit groups with no observations; the companion `coverage` case always emits 24 rows. Result comparison refuses a performance ranking when any requested window has no observed cohort, including zero-count aggregate rows. An instrumentation transition therefore cannot masquerade as a fast complete historical query.

## Freeze one reproducible dataset

Prepare a private parameter file outside the repository:

```json
{
  "environment": "lesswrong.com",
  "experiment": "welcomeBoxABTest",
  "user_id": "REPLACE_WITH_SELECTED_USER",
  "session_id": "REPLACE_WITH_SELECTED_SESSION",
  "tab_id": "REPLACE_WITH_SELECTED_TAB"
}
```

Selection is outside the timed workload. Choose several realistic cohorts in separate parameter files if needed, including recent/historical identities and both common/rare cases. Parameters are SHA-256 fingerprinted in reports; SQL rendering prints supplied values, so keep rendered identity SQL private. Hashes are reproducibility fingerprints, not anonymization guarantees for low-entropy inputs.

The explicit export command reads `public.raw` through `BENCH_POSTGRES_DSN`, writes local Parquet, and does **not** run implicitly during a benchmark:

```bash
# Set BENCH_POSTGRES_DSN through your secret manager or environment.
/tmp/analytics-perf-venv/bin/python export_snapshot.py \
  --profile day \
  --dataset-id analytics-day-v1 \
  --output /tmp/analytics-day-v1
```

Repeat `--profile` for each range you need. A full long-range comparison requires `--profile week --profile month --profile six_months --profile monthly24`. Start small; that export can be very large. No export was run against the real analytics database while building this suite.

The exporter:

- Holds one repeatable-read, read-only PostgreSQL transaction for a consistent snapshot, using a bounded server cursor. A long export holds an MVCC snapshot and consumes source I/O; schedule and monitor it explicitly.
- Exports the union of selected windows plus a conservative seven-day lookback and five-minute follow-up. These halos are necessary for metadata/SSR joins and must travel with the dataset.
- Preserves exact signed BIGINT IDs (including values above `2^53`), UTC microseconds, nullable strings, exact `DECIMAL(18,6)` expansion levels, and the selected experiment's variant.
- Normalizes paths exactly once: `to` for navigation, `url` for page loads, `path` otherwise, removing a leading HTTP(S) origin. This matches the prior query transformation; it is not general URL canonicalization.
- Rejects malformed/nonrepresentable values instead of silently rounding or conflating nulls. Export failure leaves a partial directory **without a completed manifest**; choose a new directory for retry.
- Produces `manifest.json` with snapshot identifier/time, coverage intervals, row counts per date/environment/event type, exact min/max source IDs, and SHA-256 checksums of every Parquet file.

An ID high-water mark is **not a commit-order checkpoint**. This snapshot is not an incremental CDC implementation. Keep the completed dataset immutable. The manifest travels unchanged to every engine, even when physical storage is reorganized.

Parquet files from this cursor exporter are an interchange layout (default 10,000 rows/file), not an optimized analytical layout. For tuned Parquet, compact into larger files, sort by tested keys, and partition by date when useful. Preserve all columns, row multiplicity, nulls, microseconds, and manifest identity; validate the rewritten dataset against the original before timing. Record the layout in `--layout` and `--resources`.

## Load or attach the same snapshot

[load_snapshot.py](load_snapshot.py) first verifies file checksums, total rows, unique IDs, and daily counts. It then creates a **new table** and imports the snapshot. Existing table names cause an error; it never silently appends or replaces data. PostgreSQL import is transactional. DuckDB/ClickHouse/StarRocks may retain a partial newly-created table on failure; explicitly inspect/drop that experiment table before retrying. Use setup credentials for loading and SELECT-only credentials for timed runs.

Connection configuration (credentials never go into result files):

| Engine | Environment variables |
|---|---|
| PostgreSQL | `BENCH_POSTGRES_DSN` |
| ClickHouse HTTP | `BENCH_CLICKHOUSE_URL`, optional `BENCH_CLICKHOUSE_DATABASE`, `BENCH_CLICKHOUSE_USER`, `BENCH_CLICKHOUSE_PASSWORD` |
| StarRocks MySQL | `BENCH_STARROCKS_HOST`, `BENCH_STARROCKS_DATABASE`, `BENCH_STARROCKS_USER`, optional `BENCH_STARROCKS_PORT` (9030), `BENCH_STARROCKS_PASSWORD`, `BENCH_STARROCKS_SSL_CA` |
| DuckDB | `--database` for a file, or `--parquet` for a local file/glob |

```bash
/tmp/analytics-perf-venv/bin/python load_snapshot.py --engine postgres --snapshot /tmp/analytics-day-v1
/tmp/analytics-perf-venv/bin/python load_snapshot.py --engine clickhouse --snapshot /tmp/analytics-day-v1
/tmp/analytics-perf-venv/bin/python load_snapshot.py --engine starrocks --snapshot /tmp/analytics-day-v1
/tmp/analytics-perf-venv/bin/python load_snapshot.py --engine duckdb --snapshot /tmp/analytics-day-v1 --database /tmp/analytics.duckdb
```

DuckDB can also query the snapshot directly with `--parquet '/tmp/analytics-day-v1/*.parquet'`; loading a DuckDB table is optional. The bootstrap loader favors correctness and explicitness over ingestion throughput. For billion-row loads, use each engine's bulk Parquet ingestion and perform the same validation. Setup/load time is not query time, but record it separately as part of the operating-cost comparison.

Inspect initial DDL without executing it:

```bash
/tmp/analytics-perf-venv/bin/python runner.py ddl --engine clickhouse
/tmp/analytics-perf-venv/bin/python runner.py ddl --engine starrocks
```

Initial layouts: PostgreSQL/DuckDB heap/native table; ClickHouse MergeTree ordered by `(occurred_at,event_id)`; StarRocks duplicate-key table distributed by event ID, eight buckets, replication one for a local experiment. **These are baseline layouts, not tuned or production recommendations.** Apply/test indexes, ordering, distribution, partitioning, statistics and compaction separately; retain the canonical logical data. StarRocks requires **3.3.5+ for DATETIME microseconds**, and a current release supporting the session settings/SQL used here. The live-tested versions are ClickHouse 26.8.2.7 and StarRocks 4.1.4; earlier releases have not been live-validated.

## Run explicitly selected cases

```bash
/tmp/analytics-perf-venv/bin/python runner.py run \
  --engine postgres \
  --case traffic_day --case metadata_join --case coverage \
  --profile day \
  --params /tmp/analytics-params.json \
  --manifest /tmp/analytics-day-v1/manifest.json \
  --timeout 120 --warmups 1 --repeats 3 --seed 1729 \
  --cache-label uncontrolled \
  --layout pg-typed-event-time-index \
  --resources 'Describe CPU, RAM, storage, pool/concurrency and exact tuning' \
  --output /tmp/pg-day-results.json
```

Use the same arguments for `--engine clickhouse`, `--engine starrocks`, and `--engine duckdb --parquet '/tmp/analytics-day-v1/*.parquet'`, changing output/resources/layout. To inspect a query first, use `runner.py render --engine ... --case ... --profile ... --params ...`. Rendering performs no database work.

There is no implicit full matrix. Repeat `--case` and `--profile` to opt into additional work. The manifest must cover every requested window **and its enrichment halo**, with matching environment/experiment. Concurrency is intentionally one to establish an interpretable baseline. Use separate controlled experiments for multi-user throughput; this runner does not implement coordinated concurrency or cold-cache resets.

The runner never creates tables, indexes or exports. PostgreSQL sessions explicitly use read-only transactions. ClickHouse sends `readonly=1`; StarRocks should use a SELECT-only account because session settings are not a permission boundary. DuckDB files open read-only; Parquet uses a temporary in-memory view. Do not point a writable DuckDB filename at an active writer.

## Interpret and compare

```bash
/tmp/analytics-perf-venv/bin/python runner.py compare \
  --reference /tmp/pg-day-results.json \
  --output /tmp/duckdb-day-results.json
```

The comparison requires the same manifest fingerprint, parameter fingerprint and query-renderer source fingerprint. It compares exact unordered row-multiset hashes with type-aware normalization (including ClickHouse's string-encoded integers and UTC timestamps). Numeric-looking variants such as `"001"` remain strings. Duplicate output rows are preserved.

Each report includes engine version, resource/layout description, seed, cache label, timeout, query hashes, attempt outcomes, row counts, exact result hashes, and median **successful measured** times. Warmups are recorded and excluded from medians. A failed/timed-out repetition remains visible; comparison refuses ranking unless every measured repetition on both sides completed, matched, and observed every window. Empty cohorts are diagnostics, not benchmark victories. The manifest is an attestation about the loaded target, not automatic proof that someone did not subsequently change that target: keep targets immutable and validate imports.

Timing is client execution through complete result fetch, excluding result hashing. PostgreSQL/StarRocks/DuckDB reuse a connection, whose initial setup is excluded. **ClickHouse HTTP currently establishes a connection per query, so its wall time includes HTTP/TLS setup.** This overhead matters for millisecond queries and must not be labeled server time. Engine-native plans/profiles may be collected separately; this suite does not fabricate comparable server-time metrics.

PostgreSQL uses `statement_timeout`, DuckDB interrupts through a timer, StarRocks uses `query_timeout`, and ClickHouse uses `max_execution_time` with overflow set to throw. A timeout is a lower bound/censored result, not a completed runtime. Network timeouts are separate transport failures; the runner stops so an abandoned server query cannot overlap the next sample. Verify cancellation before resuming. ClickHouse requires a complete JSON response and rejects late errors/truncated output even when HTTP status is 200. ClickHouse result cache and StarRocks query cache are explicitly disabled; OS/storage/buffer caches remain uncontrolled unless you conduct a separate isolated experiment.

## What remains deliberately separate

- The old JSON PostgreSQL artifacts measure the existing representation. A tuned typed PostgreSQL table measures the same representation as the other engines. Keep those two tracks labeled; JSON extraction removal is itself a change worth measuring.
- Rollups and approximate sketches are different semantic/physical experiments. This suite defaults to raw typed facts and exact counts.
- Cold-cache tests, concurrent load, ingestion throughput/lag, native profiling, production index changes, and deployments require separate controlled runs. None occurs merely by invoking the suite.

Official references: [ClickHouse HTTP](https://clickhouse.com/docs/interfaces/http), [ClickHouse JOIN](https://clickhouse.com/docs/sql-reference/statements/select/join), [DuckDB Parquet](https://duckdb.org/docs/stable/data/parquet/overview), [StarRocks DATETIME](https://docs.starrocks.io/docs/sql-reference/data-types/date-types/DATETIME/), [StarRocks session settings](https://docs.starrocks.io/docs/sql-reference/System_variable/).
