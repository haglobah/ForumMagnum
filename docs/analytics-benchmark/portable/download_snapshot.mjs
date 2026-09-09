#!/usr/bin/env node
// Local launcher: credentials stay in the export child's environment.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const python = process.env.BENCH_PYTHON ?? '/tmp/analytics-perf-venv/bin/python';
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');

function hasOption(argumentsList, name) {
  for (const argument of argumentsList) {
    if (argument === name || argument.startsWith(`${name}=`)) return true;
  }
  return false;
}

function gccRuntime() {
  if (!existsSync('/nix/store')) return undefined;
  for (const name of readdirSync('/nix/store')) {
    if (!/-gcc-[\d.]+-lib$/.test(name)) continue;
    const library = join('/nix/store', name, 'lib');
    if (existsSync(join(library, 'libstdc++.so.6'))) return library;
  }
  return undefined;
}

function main() {
  if (!existsSync(python)) {
    throw new Error(`Python environment missing: ${python}. Create it with python3 -m venv /tmp/analytics-perf-venv, then install ${directory}/requirements.txt; or set BENCH_PYTHON.`);
  }
  const environment = {...process.env};
  const runtime = gccRuntime();
  if (runtime) {
    environment.LD_LIBRARY_PATH = [environment.LD_LIBRARY_PATH, runtime].filter(Boolean).join(':');
  }
  if (!help) {
    // Scope private file permissions to this launcher and its child.
    process.umask(0o077);
    if (!environment.BENCH_POSTGRES_DSN) {
      const settings = parseEnv(readFileSync(process.env.ANALYTICS_ENV_FILE ?? join(root, '.env.local'), 'utf8'));
      if (!settings.private_analytics_connectionString) throw new Error('Missing private_analytics_connectionString in analytics settings');
      environment.BENCH_POSTGRES_DSN = settings.private_analytics_connectionString;
    }
    if (!hasOption(args, '--profile')) args.push('--profile', 'day');
    if (!hasOption(args, '--dataset-id')) args.push('--dataset-id', 'analytics-day-v1');
    if (!hasOption(args, '--output')) args.push('--output', '/tmp/analytics-day-v1');
    if (!hasOption(args, '--progress')) args.push('--progress');
    console.log('Exporting a read-only analytics snapshot, including the seven-day join lookback and five-minute follow-up.');
    console.log(hasOption(args, '--exact-count') ? 'Counting rows first for an exact progress total.' : 'Progress total and ETA use an approximate PostgreSQL row estimate (~).');
    console.log('ETA becomes available after the first saved batch. A completed manifest marks success.');
  }
  const result = spawnSync(python, [join(directory, 'export_snapshot.py'), ...args], {
    env: environment, stdio: 'inherit',
  });
  if (result.error) throw new Error(`Could not launch exporter: ${result.error.code}`);
  if (result.signal) console.error(`Exporter terminated by signal ${result.signal}.`);
  if (result.status !== 0 && !help) console.error('Export did not complete. Any partial output lacks a completed manifest; retry with a new --output directory.');
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
