SELECT event_type,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type IN ('navigate','pageLoadFinished','timerEvent')
  AND regexp_replace((CASE event_type WHEN 'navigate' THEN event->>'to' WHEN 'pageLoadFinished' THEN event->>'url' ELSE event->>'path' END), '^https?://[^/]+', '') LIKE '/posts/%'
GROUP BY event_type
