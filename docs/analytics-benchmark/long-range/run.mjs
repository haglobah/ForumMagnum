import {readFileSync, writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const directory = fileURLToPath(new URL('.', import.meta.url));
const profiles = {
  week: [{bucket: 'week', start: '2026-09-01', end: '2026-09-08'}],
  month: [{bucket: 'month', start: '2026-08-08', end: '2026-09-08'}],
  six_months: [{bucket: 'six_months', start: '2026-03-08', end: '2026-09-08'}],
  monthly_first_days: Array.from({length: 24}, monthlyWindow),
};
function monthlyWindow(_, index) {
  const date = new Date(Date.UTC(2024, 9 + index, 1));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(2);
  return {bucket: start, start, end: date.toISOString().slice(0, 10)};
}
function renderWindow(template, window) {
  const body = template.replaceAll('w.starts_at', `TIMESTAMP '${window.start}'`)
    .replaceAll('w.ends_at', `TIMESTAMP '${window.end}'`);
  return `(SELECT '${window.bucket}' AS bucket, to_jsonb(q) AS result
    FROM (VALUES (1)) anchor(n) LEFT JOIN LATERAL (\n${body}\n) q ON true)`;
}
function buildQuery(profile, windows, query) {
  const template = readFileSync(`${directory}${query.file}`, 'utf8');
  const blocks = [];
  for (const window of windows) blocks.push(renderWindow(template, window));
  const sql = blocks.join('\nUNION ALL\n') + '\nORDER BY bucket;\n';
  return {...query, diagnostic: query.diagnostic || (profile === 'monthly_first_days' && ['user', 'session', 'tab'].includes(query.name)),
    name: `${profile}/${query.name}`, profile, sql, sql_sha256: createHash('sha256').update(sql).digest('hex')};
}
const definitions = JSON.parse(readFileSync(`${directory}suite.json`, 'utf8'));
const requested = process.argv.slice(2);
const suite = [];
for (const [profile, windows] of Object.entries(profiles)) {
  for (const query of definitions) {
    if (!query.profiles || query.profiles.includes(profile)) suite.push(buildQuery(profile, windows, query));
  }
}
if (!requested.length) {
  console.log('Usage: node docs/analytics-benchmark/long-range/run.mjs CASE [CASE ...] | --all | --render');
  console.log(suite.map(query => query.name).join('\n'));
  process.exit(0);
}
if (requested.includes('--render')) {
  writeFileSync('/tmp/analytics-long-range-rendered.json', JSON.stringify(suite, null, 2));
  process.exit(0);
}
const selected = requested.includes('--all') ? suite : suite.filter(query => requested.includes(query.name));
if (!selected.length || (!requested.includes('--all') && selected.length !== new Set(requested).size)) throw new Error('Unknown case');
const settings = parseEnv(readFileSync(process.env.ANALYTICS_ENV_FILE ?? fileURLToPath(new URL('../../../.env.local', import.meta.url)), 'utf8'));
const connection = new URL(settings.private_analytics_connectionString);
const params = process.env.ANALYTICS_PARAMS_FILE
  ? JSON.parse(readFileSync(process.env.ANALYTICS_PARAMS_FILE, 'utf8')) : {};
for (const value of Object.values(params)) if (typeof value !== 'string' || !value) throw new Error('Invalid private parameter');
const timeout = Number(process.env.ANALYTICS_TIMEOUT_MS ?? 15000);
if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw new Error('Timeout must be between 1 and 60000 ms');
for (const query of selected) for (const match of query.sql.matchAll(/:'([a-z_]+)'/g)) {
  if (!params[match[1]]) throw new Error(`Missing parameter ${match[1]}`);
}
const environment = {...process.env,
  PGHOST: connection.hostname, PGPORT: connection.port || '5432',
  PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password),
  PGDATABASE: connection.pathname.slice(1), PGCONNECT_TIMEOUT: '10',
  PGSSLMODE: connection.searchParams.get('sslmode') ?? 'require',
  PGOPTIONS: `-c default_transaction_read_only=on -c statement_timeout=${timeout} -c application_name=analytics_long_range_benchmark -c timezone=UTC`,
};
function execute(sql) {
  const start = performance.now();
  const result = spawnSync(process.env.PSQL_BIN ?? 'psql', [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    ...Object.entries(params).flatMap(([key, value]) => ['-v', `${key}=${value}`]),
  ], {input: sql, env: environment, encoding: 'utf8', timeout: timeout + 15000, maxBuffer: 32 * 1024 * 1024});
  return {status: result.status === 0 ? 'ok' : result.stderr?.includes('statement timeout') ? 'timeout' : 'error',
    client_elapsed_ms: performance.now() - start, output: result.stdout,
    error: result.status === 0 ? undefined : result.error?.code ?? result.stderr};
}
function redact(value) {
  let serialized = JSON.stringify(value);
  for (const [key, parameter] of Object.entries(params)) serialized = serialized.replaceAll(parameter, `[${key}]`);
  return JSON.parse(serialized);
}
const resultPath = process.env.ANALYTICS_RESULTS_FILE ?? '/tmp/analytics-long-range-results.json';
const results = process.env.ANALYTICS_RESUME === '1' ? JSON.parse(readFileSync(resultPath, 'utf8')) : [];
for (const query of selected) {
  const previous = results.find(result => result.name === query.name);
  if (previous) {
    if (previous.sql_sha256 !== query.sql_sha256 || previous.statement_timeout_ms !== timeout) {
      throw new Error(`Cannot resume ${query.name}: SQL or timeout differs from recorded run`);
    }
    continue;
  }
  const result = {name: query.name, diagnostic: query.diagnostic, sql_sha256: query.sql_sha256, sql: query.sql,
    started_at: new Date().toISOString(), statement_timeout_ms: timeout};
  const estimate = execute(`EXPLAIN (FORMAT JSON) ${query.sql}`);
  result.estimate_status = estimate.status;
  result.estimated_plan = estimate.status === 'ok' ? JSON.parse(estimate.output) : estimate.error;
  if (estimate.status === 'ok') {
    const measured = execute(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${query.sql}`);
    result.status = measured.status;
    result.client_elapsed_ms = measured.client_elapsed_ms;
    result.plan = measured.status === 'ok' ? JSON.parse(measured.output) : undefined;
    result.error = measured.error;
    if (measured.status === 'ok') {
      const aggregate = execute(query.sql);
      result.aggregate_status = aggregate.status;
      result.aggregate_results = aggregate.status === 'ok' ? aggregate.output : undefined;
      result.aggregate_error = aggregate.error;
      result.aggregate_client_elapsed_ms = aggregate.client_elapsed_ms;
    }
  } else result.status = 'estimate_failed';
  results.push(redact(result));
  writeFileSync(resultPath, JSON.stringify(results, null, 2) + '\n', {mode: 0o600});
  console.log(result.name, result.status, result.plan?.[0]?.['Execution Time'] ?? '', 'ms');
}
