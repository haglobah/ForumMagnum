SELECT event_type,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event->>'userId' = :'user_id'
GROUP BY event_type
