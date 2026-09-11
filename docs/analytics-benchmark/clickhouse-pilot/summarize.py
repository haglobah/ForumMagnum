"""Render aggregate timings without publishing private selection parameters."""
import json
from pathlib import Path
from statistics import median
from pilot import HERE


def summaries(report):
    output = {}
    for key, attempts in report['cases'].items():
        complete = [a for a in attempts if a['status']=='complete' and not a['warmup']]
        if not complete: continue
        output[key] = dict(client_ms=median(a['elapsed_ms'] for a in complete),
                           server_ms=median(float(a['statistics']['elapsed'])*1000 for a in complete),
                           rows_read=median(a['statistics']['rows_read'] for a in complete),
                           bytes_read=median(a['statistics']['bytes_read'] for a in complete),
                           repeats=len(complete))
    return output


def main():
    report = json.loads((HERE/'results.json').read_text())
    summary = summaries(report)
    cases = sorted(set('/'.join(key.split('/')[1:]) for key in summary))
    lines = ['# Core ClickHouse pilot measurements', '',
             'Median execute/fetch milliseconds; one warmup per pass excluded. Each cell includes all completed measured repeats from both passes. See JSON for exact hashes, errors and server time. PostgreSQL was not queried.', '',
             '| Case | Raw | Minmax | Time projection | Typed sorted |',
             '|---|---:|---:|---:|---:|']
    for case in cases:
        values = [summary.get(layout+'/'+case) for layout in ('raw','minmax','projection','typed')]
        lines.append('| '+case+' | '+' | '.join(f"{value['client_ms']:.1f}" if value else 'unavailable' for value in values)+' |')
    lines += ['', 'The cohort and its part/merge ordering differ from the full source. These figures measure the eight-day pilot, not billion-row performance. Typed sorting, partitioning and JSON extraction are combined. Empty SSR windows are diagnostic only.', '']
    (HERE/'summary.md').write_text('\n'.join(lines))
    (HERE/'summary.json').write_text(json.dumps(summary, indent=2))

if __name__ == '__main__': main()
