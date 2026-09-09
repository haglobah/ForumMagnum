SELECT event->'abTestGroups'->>'welcomeBoxABTest' variant,count(*) tab_starts,count(DISTINCT event->>'clientId') clients
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type='tabStarted'
GROUP BY 1
