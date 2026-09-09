SELECT event_type,count(*)
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event->>'userId' = :'user_id'
GROUP BY event_type;
