WITH views AS MATERIALIZED (SELECT environment,event->>'tabId' tab_id,event->>'feedItemId' item_id,min(timestamp) first_view
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type='ultraFeedItemViewed'
  AND event->>'userId' IS NOT NULL
  AND event->>'feedItemId' IS NOT NULL
  AND event->>'tabId' IS NOT NULL
GROUP BY 1,2,3),
expansions AS MATERIALIZED (SELECT environment,event->>'tabId' tab_id,event->>'feedItemId' item_id,timestamp
FROM raw
WHERE environment='lesswrong.com'
  AND timestamp >= TIMESTAMP '2026-09-07'
  AND timestamp < TIMESTAMP '2026-09-07 01:00'
  AND event_type='ultraFeedItemExpanded'
  AND (event->>'expansionLevel')::numeric>0)
SELECT count(*) exposed_items,count(*) FILTER (WHERE EXISTS(SELECT 1
FROM expansions e
WHERE e.environment=v.environment
  AND e.tab_id=v.tab_id
  AND e.item_id=v.item_id
  AND e.timestamp>=v.first_view)) expanded_items
FROM views v;
