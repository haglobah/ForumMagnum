SELECT kinds.event_type, sample.present IS TRUE AS event_present,
  sample.has_user_id, sample.has_session_id, sample.has_tab_id,
  sample.has_user_agent, sample.has_ab_groups, sample.has_feature_item
FROM (VALUES ('pageLoadFinished'), ('navigate'), ('timerEvent'), ('tabStarted'),
  ('ultraFeedItemViewed'), ('ultraFeedItemExpanded'), ('ssr')) kinds(event_type)
LEFT JOIN LATERAL (
  SELECT true AS present,
    event->>'userId' IS NOT NULL AS has_user_id,
    event->>'sessionId' IS NOT NULL AS has_session_id,
    event->>'tabId' IS NOT NULL AS has_tab_id,
    event->>'userAgent' IS NOT NULL AS has_user_agent,
    event->'abTestGroups' IS NOT NULL AS has_ab_groups,
    event->>'feedItemId' IS NOT NULL AS has_feature_item
  FROM raw
  WHERE environment = 'lesswrong.com' AND event_type = kinds.event_type
    AND timestamp >= w.starts_at AND timestamp < w.ends_at
  ORDER BY timestamp
  LIMIT 1
) sample ON true
