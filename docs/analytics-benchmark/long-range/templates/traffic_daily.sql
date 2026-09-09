SELECT count(*) AS page_events,
  count(*) FILTER (WHERE event_type = 'pageLoadFinished') AS initial_loads,
  count(*) FILTER (WHERE event_type = 'navigate') AS navigations,
  count(DISTINCT event->>'clientId') AS distinct_clients
FROM raw
WHERE environment = 'lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type IN ('pageLoadFinished', 'navigate')
