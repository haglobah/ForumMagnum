SELECT event_type,count(*) events,count(DISTINCT event->>'userId') users
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-08'
  AND event_type IN ('ultraFeedItemViewed','ultraFeedItemExpanded')
GROUP BY event_type;
