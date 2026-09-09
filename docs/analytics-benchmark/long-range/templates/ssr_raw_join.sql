SELECT count(*) AS ssr_rows,
  count(*) FILTER (WHERE s.event->>'tabId' IS NOT NULL) AS linkable_ssr_rows,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1
    FROM raw r
    WHERE r.environment = s.environment
      AND r.event_type = 'pageLoadFinished'
      AND r.event->>'tabId' = s.event->>'tabId'
      AND r.timestamp >= s.timestamp - interval '5 seconds'
      AND r.timestamp < s.timestamp + interval '5 minutes'
  )) AS ssr_rows_with_page_load
FROM raw s
WHERE s.environment = 'lesswrong.com'
  AND s.event_type = 'ssr'
  AND s.timestamp >= w.starts_at
  AND s.timestamp < w.ends_at
