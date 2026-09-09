WITH pages AS MATERIALIZED (SELECT environment,timestamp,event->>'tabId' tab_id
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp>=w.starts_at
  AND timestamp<w.ends_at
  AND event_type IN('pageLoadFinished','navigate')),
enriched AS (SELECT p.*,m.event->'abTestGroups'->>'welcomeBoxABTest' variant,m.event->>'userAgent' ua
FROM pages p
LEFT JOIN LATERAL (SELECT event
FROM raw t
WHERE t.environment=p.environment
  AND t.event->>'tabId'=p.tab_id
  AND t.event_type='tabStarted'
  AND t.timestamp>=p.timestamp-interval '7 days'
  AND t.timestamp<=p.timestamp+interval '5 seconds'
ORDER BY t.timestamp DESC,t.id DESC
LIMIT 1)m ON true)
SELECT variant,CASE WHEN NULLIF(ua,'') IS NULL THEN 'unknown' WHEN ua ~* 'bot|crawler|spider|slurp|headless' THEN 'bot_like' ELSE 'not_matched' END ua_class,count(*) page_events,count(DISTINCT tab_id) tabs
FROM enriched
GROUP BY 1,2
