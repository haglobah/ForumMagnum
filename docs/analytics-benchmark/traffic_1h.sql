SELECT date_trunc('hour',timestamp) AS bucket,event_type,count(*),count(DISTINCT event->>'clientId') clients
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type IN ('pageLoadFinished','navigate')
GROUP BY 1,2;
