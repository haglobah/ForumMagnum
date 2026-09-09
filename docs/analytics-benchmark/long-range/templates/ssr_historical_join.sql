SELECT count(*) ssr_rows,count(*) FILTER(WHERE EXISTS(SELECT 1
FROM raw r
WHERE r.environment=s.environment
  AND r.event_type='pageLoadFinished'
  AND r.event->>'tabId'=s.tab_id
  AND r.timestamp>=s.timestamp-interval '5 seconds'
  AND r.timestamp<s.timestamp+interval '5 minutes')) ssr_rows_with_page_load
FROM ssrs_cleaned s
WHERE s.environment='lesswrong.com'
  AND s.timestamp>=w.starts_at
  AND s.timestamp<w.ends_at
