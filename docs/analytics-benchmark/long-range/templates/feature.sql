SELECT event_type,count(*) events,count(DISTINCT event->>'userId') users
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= w.starts_at
  AND timestamp < w.ends_at
  AND event_type IN ('ultraFeedItemViewed','ultraFeedItemExpanded')
GROUP BY event_type
