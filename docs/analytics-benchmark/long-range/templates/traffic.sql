SELECT date_trunc('hour',timestamp) AS bucket,event_type,count(*),count(DISTINCT event->>'clientId') clients
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type IN ('pageLoadFinished','navigate')
GROUP BY 1,2
