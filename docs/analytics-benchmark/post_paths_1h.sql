SELECT event_type,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type IN ('navigate','pageLoadFinished','timerEvent')
  AND regexp_replace((CASE event_type WHEN 'navigate' THEN event->>'to' WHEN 'pageLoadFinished' THEN event->>'url' ELSE event->>'path' END), '^https?://[^/]+', '') LIKE '/posts/%'
GROUP BY event_type;
