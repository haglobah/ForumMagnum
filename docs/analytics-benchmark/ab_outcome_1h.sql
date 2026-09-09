WITH assignments AS MATERIALIZED (SELECT DISTINCT ON(environment,event->>'tabId') environment,event->>'tabId' tab_id,event->'abTestGroups'->>'welcomeBoxABTest' variant,timestamp assigned_at
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp>=TIMESTAMP '2026-09-07'
  AND timestamp<TIMESTAMP '2026-09-07 01:00'
  AND event_type='tabStarted'
  AND event->>'tabId' IS NOT NULL
ORDER BY environment,event->>'tabId',timestamp,id),
actions AS MATERIALIZED (SELECT environment,event->>'tabId' tab_id,timestamp
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp>=TIMESTAMP '2026-09-07'
  AND timestamp<TIMESTAMP '2026-09-07 01:00'
  AND event_type='navigate')
SELECT variant,count(*) assigned_tabs,count(*) FILTER(WHERE EXISTS(SELECT 1
FROM actions a
WHERE a.environment=t.environment
  AND a.tab_id=t.tab_id
  AND a.timestamp>=t.assigned_at)) tabs_with_subsequent_navigation
FROM assignments t
GROUP BY 1;
