SELECT CASE WHEN NULLIF(event->>'userAgent','') IS NULL THEN 'unknown' WHEN event->>'userAgent' ~* 'bot|crawler|spider|slurp|headless' THEN 'bot_like' ELSE 'not_matched' END ua_class,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type='tabStarted'
GROUP BY 1;
