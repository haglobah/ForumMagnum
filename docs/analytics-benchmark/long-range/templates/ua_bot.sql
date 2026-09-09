SELECT CASE WHEN NULLIF(event->>'userAgent','') IS NULL THEN 'unknown' WHEN event->>'userAgent' ~* 'bot|crawler|spider|slurp|headless' THEN 'bot_like' ELSE 'not_matched' END ua_class,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type='tabStarted'
GROUP BY 1
