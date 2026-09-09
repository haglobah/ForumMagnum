SELECT event_type,count(*) events,count(DISTINCT event->>'userId') users
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type IN ('ultraFeedItemViewed','ultraFeedItemExpanded')
GROUP BY event_type;
