import {readFileSync, writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const definitions = JSON.parse(readFileSync(`${directory}suite.json`, 'utf8'));
const suite = definitions.map(query => ({...query, sql: readFileSync(`${directory}${query.file}`, 'utf8')}));
const requested = process.argv.slice(2);
if (!requested.length) {
  console.log('Usage: node docs/analytics-benchmark/run.mjs CASE [CASE ...] | --all');
  console.log(suite.map(query => query.name).join('\n'));
  process.exit(0);
}
const selected = requested.includes('--all') ? suite : suite.filter(query => requested.includes(query.name));
if (!selected.length || (!requested.includes('--all') && selected.length !== new Set(requested).size)) {
  throw new Error('Unknown benchmark case; run without arguments to list cases.');
}
const settingsPath = process.env.ANALYTICS_ENV_FILE ?? fileURLToPath(new URL('../../.env.local', import.meta.url));
const settings = parseEnv(readFileSync(settingsPath, 'utf8'));
const connection = new URL(settings.private_analytics_connectionString);
const params = process.env.ANALYTICS_PARAMS_FILE
  ? JSON.parse(readFileSync(process.env.ANALYTICS_PARAMS_FILE, 'utf8')) : {};
for (const value of Object.values(params)) {
  if (typeof value !== 'string' || !value) throw new Error('Private parameters must be nonempty strings.');
}
const timeout = Number(process.env.ANALYTICS_TIMEOUT_MS ?? 5000);
if (!Number.isInteger(timeout) || timeout < 1 || timeout > 15000) throw new Error('Timeout must be between 1 and 15000 ms.');
for (const query of selected) {
  for (const match of query.sql.matchAll(/:'([a-z_]+)'/g)) {
    if (typeof params[match[1]] !== 'string' || !params[match[1]]) throw new Error(`Missing private parameter: ${match[1]}`);
  }
}
const environment = {
  ...process.env,
  PGHOST: connection.hostname,
  PGPORT: connection.port || '5432',
  PGUSER: decodeURIComponent(connection.username),
  PGPASSWORD: decodeURIComponent(connection.password),
  PGDATABASE: connection.pathname.slice(1),
  PGCONNECT_TIMEOUT: '10',
  PGSSLMODE: connection.searchParams.get('sslmode') ?? 'require',
  PGOPTIONS: `-c default_transaction_read_only=on -c statement_timeout=${timeout} -c application_name=analytics_workload_benchmark`,
};

function execute(sql) {
  const start = performance.now();
  const result = spawnSync(process.env.PSQL_BIN ?? 'psql', [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    ...Object.entries(params).flatMap(([key, value]) => ['-v', `${key}=${value}`]),
  ], {input: sql, env: environment, encoding: 'utf8', timeout: timeout + 15000, maxBuffer: 16 * 1024 * 1024});
  if (result.error) throw new Error(`Could not execute psql: ${result.error.code}`);
  return {status: result.status, client_elapsed_ms: performance.now() - start, output: result.stdout, error: result.stderr};
}

function redact(value) {
  let serialized = JSON.stringify(value);
  for (const [key, parameter] of Object.entries(params)) serialized = serialized.replaceAll(parameter, `[${key}]`);
  return JSON.parse(serialized);
}

const results = [];
for (const query of selected) {
  const result = {name: query.name, statement_timeout_ms: timeout, runs: []};
  const estimated = execute(`EXPLAIN (FORMAT JSON) ${query.sql}`);
  result.plan = estimated.status === 0 ? JSON.parse(estimated.output) : estimated.error;
  if (estimated.status === 0) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const measured = execute(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${query.sql}`);
      const plan = measured.status === 0 ? JSON.parse(measured.output) : undefined;
      result.runs.push({
        status: measured.status === 0 ? 'ok' : measured.error.includes('statement timeout') ? 'timeout' : 'error',
        client_elapsed_ms: measured.client_elapsed_ms,
        plan,
        error: measured.status === 0 ? undefined : measured.error,
      });
      if (!plan || plan[0]['Execution Time'] > 1000) break;
    }
    if (result.runs[0]?.status === 'ok') {
      const aggregate = execute(query.sql);
      result.aggregate_results = aggregate.output;
      result.aggregate_status = aggregate.status;
    }
  }
  results.push(redact(result));
  writeFileSync(process.env.ANALYTICS_RESULTS_FILE ?? '/tmp/analytics-benchmark-results.json', JSON.stringify(results, null, 2), {mode: 0o600});
  console.log(query.name, result.runs.map(run => run.status === 'ok' ? `${run.plan[0]['Execution Time']} ms` : run.status).join(', '));
}
