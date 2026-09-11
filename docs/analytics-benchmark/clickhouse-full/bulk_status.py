"""Local progress summary; never contacts either database."""
import json
from datetime import datetime, timezone
from pathlib import Path

here = Path(__file__).resolve().parent
state = json.loads((here / 'loader-state.json').read_text())
complete = [(k, v[-1]) for k,v in state['chunks'].items() if v[-1]['status'] == 'complete']
rows = sum(a['expected_rows'] for _,a in complete)
recent = sorted(complete, key=lambda item:item[1]['completed_utc'])[-1:]
result = dict(utc=datetime.now(timezone.utc).isoformat(), chunks=len(complete), rows=rows,
              referenced_bytes=sum(p[3] for _,a in complete for p in a['parts']),
              remaining_rows=2315652132-rows,
              pending=[k for k,v in state['chunks'].items() if v[-1]['status']!='complete'],
              recent=[dict(index=k,total_seconds=round((datetime.fromisoformat(a['completed_utc'])-datetime.fromisoformat(a['create']['utc'])).total_seconds(),1),
                           insert_seconds=round(a['insert']['elapsed_ms']/1000,1),
                           parts=len(a['parts']),compaction_candidates=len(a.get('compaction_plan',[])),
                           already_finished=len(a.get('compaction_already_finished',[]))) for k,a in recent])
print(json.dumps(result))
