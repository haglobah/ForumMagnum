SELECT event->'abTestGroups'->>'welcomeBoxABTest' variant,count(*) tab_starts,count(DISTINCT event->>'clientId') clients
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-08'
  AND event_type='tabStarted'
GROUP BY 1;
