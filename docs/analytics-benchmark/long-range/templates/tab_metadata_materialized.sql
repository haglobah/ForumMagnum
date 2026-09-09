WITH pages AS MATERIALIZED (
  SELECT id, environment, timestamp, event->>'tabId' AS tab_id
  FROM raw
  WHERE environment = 'lesswrong.com'
    AND timestamp >= w.starts_at
    AND timestamp < w.ends_at
    AND event_type IN ('pageLoadFinished', 'navigate')
), metadata AS MATERIALIZED (
  SELECT environment, timestamp, id, event->>'tabId' AS tab_id,
    event->'abTestGroups'->>'welcomeBoxABTest' AS variant,
    event->>'userAgent' AS ua
  FROM raw
  WHERE environment = 'lesswrong.com'
    AND event_type = 'tabStarted'
    AND timestamp >= (w.starts_at - interval '7 days')
    AND timestamp <= (w.ends_at + interval '5 seconds')
), enriched AS (
  SELECT DISTINCT ON (p.id) p.id, p.tab_id, m.variant, m.ua
  FROM pages p
  LEFT JOIN metadata m
    ON m.environment = p.environment
    AND m.tab_id = p.tab_id
    AND m.timestamp >= p.timestamp - interval '7 days'
    AND m.timestamp <= p.timestamp + interval '5 seconds'
  ORDER BY p.id, m.timestamp DESC NULLS LAST, m.id DESC
)
SELECT variant,
  CASE
    WHEN NULLIF(ua, '') IS NULL THEN 'unknown'
    WHEN ua ~* 'bot|crawler|spider|slurp|headless' THEN 'bot_like'
    ELSE 'not_matched'
  END AS ua_class,
  count(*) AS page_events,
  count(DISTINCT tab_id) AS tabs
FROM enriched
GROUP BY 1, 2
