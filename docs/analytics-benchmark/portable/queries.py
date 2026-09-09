"""Portable analytical workload. Every case returns exact aggregates, never identities."""
from datetime import datetime, timedelta, timezone
import re

ENGINES = ('postgres', 'duckdb', 'clickhouse', 'starrocks')
CASES = ('traffic_hour', 'traffic_day', 'event_counts', 'user', 'session', 'tab',
         'post_paths', 'feature_counts', 'feature_funnel', 'ab_assignments',
         'ab_outcome', 'ua_bot', 'metadata_join', 'ssr_association', 'coverage')
PROFILES = ('hour', 'day', 'week', 'month', 'six_months', 'monthly24')
COLUMNS = ('event_id', 'occurred_at', 'environment', 'event_type', 'user_id',
           'client_id', 'session_id', 'tab_id', 'path', 'feed_item_id',
           'expansion_level', 'user_agent', 'ab_variant')


def literal(value):
    if not isinstance(value, str) or '\x00' in value:
        raise ValueError('SQL values must be strings without NUL')
    # Backslashes have incompatible interpretation across engines. Disallow them
    # for this benchmark's identifiers/parameters instead of silently changing them.
    if '\\' in value:
        raise ValueError('Backslash is unsupported in SQL parameters')
    return "'" + value.replace("'", "''") + "'"


def table_name(value):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?', value):
        raise ValueError('table must be an unquoted identifier, optionally schema-qualified')
    return value


def timestamp(engine, value):
    text = value.strftime('%Y-%m-%d %H:%M:%S.%f')
    if engine == 'clickhouse':
        return f"toDateTime64({literal(text)}, 6, 'UTC')"
    if engine == 'starrocks':
        return f"CAST({literal(text)} AS DATETIME)"
    return f"TIMESTAMP {literal(text)}"


def shifted(engine, column, seconds):
    if engine == 'clickhouse':
        return f'addSeconds({column}, {seconds})'
    if engine == 'starrocks':
        return f'date_add({column}, INTERVAL {seconds} SECOND)'
    return f"({column} + INTERVAL '{seconds} seconds')"


def windows(profile):
    end = datetime(2026, 9, 8, tzinfo=timezone.utc)
    if profile == 'monthly24':
        result = []
        for offset in range(24):
            month_index = 2024 * 12 + 9 + offset
            start = datetime(month_index // 12, month_index % 12 + 1, 1, tzinfo=timezone.utc)
            result.append((start.strftime('%Y-%m-%d'), start, start + timedelta(days=1)))
        return result
    starts = {'hour': end - timedelta(days=1), 'day': end - timedelta(days=1),
              'week': datetime(2026, 9, 1, tzinfo=timezone.utc),
              'month': datetime(2026, 8, 8, tzinfo=timezone.utc),
              'six_months': datetime(2026, 3, 8, tzinfo=timezone.utc)}
    start = starts[profile]
    return [(profile, start, start + timedelta(hours=1) if profile == 'hour' else end)]


def ua_class(column):
    # Deliberately use ASCII substring matching rather than different regex engines.
    matches = ' OR '.join(f"LOWER({column}) LIKE '%{word}%'" for word in ('bot', 'crawler', 'spider', 'slurp', 'headless'))
    return f"CASE WHEN {column} IS NULL OR {column}='' THEN 'unknown' WHEN {matches} THEN 'bot_like' ELSE 'not_matched' END"


def render_one(engine, case, profile, params, table='events', custom_windows=None):
    if engine not in ENGINES or case not in CASES or profile not in PROFILES:
        raise ValueError('Unknown engine, case, or profile')
    table = table_name(table)
    ranges = custom_windows if custom_windows is not None else windows(profile)
    wsql = ' UNION ALL '.join(f'SELECT {literal(label)} AS window_id, {timestamp(engine, start)} AS starts_at, {timestamp(engine, end)} AS ends_at' for label, start, end in ranges)
    label, start, end = ranges[0]
    prefix = f"WITH windows AS ({wsql}), base AS (SELECT {literal(label)} AS window_id,e.* FROM {table} e WHERE e.occurred_at>={timestamp(engine,start)} AND e.occurred_at<{timestamp(engine,end)} AND e.environment={literal(params.get('environment', 'lesswrong.com'))})"
    if case in ('event_counts', 'user', 'session', 'tab', 'post_paths', 'feature_counts'):
        condition = '1=1'
        extra = ''
        if case in ('user', 'session', 'tab'):
            key = case + '_id'
            condition = f'{key}={literal(params[key])}'
        if case == 'post_paths':
            condition = "event_type IN ('navigate','pageLoadFinished','timerEvent') AND path LIKE '/posts/%'"
        if case == 'feature_counts':
            condition = "event_type IN ('ultraFeedItemViewed','ultraFeedItemExpanded')"
            extra = ',count(DISTINCT user_id) AS users'
        return prefix + f' SELECT window_id,event_type,count(*) AS events{extra} FROM base WHERE {condition} GROUP BY window_id,event_type'
    if case in ('traffic_hour', 'traffic_day'):
        unit = 'hour' if case == 'traffic_hour' else 'day'
        bucket = f"date_trunc('{unit}',occurred_at)"
        return prefix + f" SELECT window_id,{bucket} AS bucket,event_type,count(*) AS events,count(DISTINCT client_id) AS clients FROM base WHERE event_type IN ('navigate','pageLoadFinished') GROUP BY window_id,{bucket},event_type"
    if case == 'coverage':
        # Explicit windows preserve dates with zero observed events.
        return prefix + ' SELECT w.window_id,count(b.event_id) AS events,count(DISTINCT b.event_type) AS event_types FROM windows w LEFT JOIN base b ON b.window_id=w.window_id GROUP BY w.window_id'
    if case == 'feature_funnel':
        return prefix + ", exposures AS (SELECT window_id,environment,tab_id,feed_item_id,min(occurred_at) AS first_view FROM base WHERE event_type='ultraFeedItemViewed' AND user_id IS NOT NULL AND tab_id IS NOT NULL AND feed_item_id IS NOT NULL GROUP BY window_id,environment,tab_id,feed_item_id), expansions AS (SELECT window_id,environment,tab_id,feed_item_id,max(occurred_at) AS last_expansion FROM base WHERE event_type='ultraFeedItemExpanded' AND expansion_level>0 GROUP BY window_id,environment,tab_id,feed_item_id), outcomes AS (SELECT v.window_id,v.tab_id,CASE WHEN a.last_expansion>=v.first_view THEN 1 ELSE 0 END AS expanded FROM exposures v LEFT JOIN expansions a ON a.window_id=v.window_id AND a.environment=v.environment AND a.tab_id=v.tab_id AND a.feed_item_id=v.feed_item_id) SELECT w.window_id,count(o.tab_id) AS exposed_items,coalesce(sum(o.expanded),0) AS expanded_items FROM windows w LEFT JOIN outcomes o ON o.window_id=w.window_id GROUP BY w.window_id"
    if case == 'ab_assignments':
        return prefix + " SELECT window_id,ab_variant,count(*) AS assignments,count(DISTINCT client_id) AS clients FROM base WHERE event_type IN ('tabStarted','ssr') GROUP BY window_id,ab_variant"
    if case == 'ab_outcome':
        return prefix + ", ranked AS (SELECT window_id,event_id,environment,tab_id,ab_variant,occurred_at,row_number() OVER (PARTITION BY window_id,environment,tab_id ORDER BY occurred_at,event_id) AS rn FROM base WHERE event_type IN ('tabStarted','ssr') AND tab_id IS NOT NULL), actions AS (SELECT window_id,environment,tab_id,max(occurred_at) AS last_navigation FROM base WHERE event_type='navigate' GROUP BY window_id,environment,tab_id), outcomes AS (SELECT r.window_id,r.event_id,r.ab_variant,CASE WHEN a.last_navigation>=r.occurred_at THEN 1 ELSE 0 END AS navigated FROM ranked r LEFT JOIN actions a ON a.window_id=r.window_id AND a.environment=r.environment AND a.tab_id=r.tab_id WHERE r.rn=1) SELECT window_id,ab_variant,count(*) AS assigned_tabs,sum(navigated) AS tabs_with_subsequent_navigation FROM outcomes GROUP BY window_id,ab_variant"
    if case == 'ua_bot':
        return prefix + f" SELECT window_id,{ua_class('user_agent')} AS ua_class,count(*) AS events FROM base WHERE event_type IN ('tabStarted','ssr') GROUP BY window_id,{ua_class('user_agent')}"
    if case == 'metadata_join':
        return prefix + f", pages AS (SELECT * FROM base WHERE event_type IN ('pageLoadFinished','navigate')), ranked AS (SELECT p.window_id AS window_id,p.event_id AS event_id,m.ab_variant AS ab_variant,m.user_agent AS user_agent,m.event_type AS metadata_source,row_number() OVER (PARTITION BY p.window_id,p.event_id ORDER BY m.occurred_at DESC,m.event_id DESC) AS rn FROM pages p JOIN {table} m ON m.environment=p.environment AND m.tab_id=p.tab_id WHERE m.event_type IN ('tabStarted','ssr') AND m.occurred_at>={timestamp(engine,start-timedelta(days=7))} AND m.occurred_at<{timestamp(engine,end+timedelta(seconds=5))} AND m.occurred_at>={shifted(engine,'p.occurred_at',-604800)} AND m.occurred_at<={shifted(engine,'p.occurred_at',5)}), enriched AS (SELECT p.window_id AS window_id,p.tab_id AS tab_id,m.ab_variant AS ab_variant,m.user_agent AS user_agent,m.metadata_source AS metadata_source FROM pages p LEFT JOIN ranked m ON m.window_id=p.window_id AND m.event_id=p.event_id AND m.rn=1) SELECT window_id,ab_variant,metadata_source,{ua_class('user_agent')} AS ua_class,count(*) AS page_events,count(DISTINCT tab_id) AS tabs FROM enriched GROUP BY window_id,ab_variant,metadata_source,{ua_class('user_agent')}"
    if case == 'ssr_association':
        return prefix + f", associated AS (SELECT DISTINCT s.window_id,s.event_id FROM base s JOIN {table} p ON p.environment=s.environment AND p.tab_id=s.tab_id WHERE s.event_type='ssr' AND p.event_type='pageLoadFinished' AND p.occurred_at>={timestamp(engine,start-timedelta(seconds=5))} AND p.occurred_at<{timestamp(engine,end+timedelta(minutes=5))} AND p.occurred_at>={shifted(engine,'s.occurred_at',-5)} AND p.occurred_at<{shifted(engine,'s.occurred_at',300)}), ssrs AS (SELECT s.window_id,s.event_id,a.event_id AS loaded_id FROM base s LEFT JOIN associated a ON a.window_id=s.window_id AND a.event_id=s.event_id WHERE s.event_type='ssr') SELECT w.window_id,count(s.event_id) AS ssr_rows,count(s.loaded_id) AS ssr_rows_with_page_load FROM windows w LEFT JOIN ssrs s ON s.window_id=w.window_id GROUP BY w.window_id"
    raise AssertionError(case)


def render(engine, case, profile, params, table='events', custom_windows=None):
    ranges = custom_windows if custom_windows is not None else windows(profile)
    branches = [render_one(engine, case, profile, params, table, [window]) for window in ranges]
    if len(branches) == 1:
        return branches[0]
    return ' UNION ALL '.join(f'SELECT * FROM ({branch}) AS window_{index}' for index, branch in enumerate(branches))


def ddl(engine, table='events'):
    table = table_name(table)
    fields = []
    for column in COLUMNS:
        if column == 'event_id':
            kind = 'Int64' if engine == 'clickhouse' else 'BIGINT NOT NULL'
        elif column == 'occurred_at':
            kind = "DateTime64(6, 'UTC')" if engine == 'clickhouse' else 'DATETIME NOT NULL' if engine == 'starrocks' else 'TIMESTAMP NOT NULL'
        elif column == 'expansion_level':
            kind = 'Nullable(Decimal(18,6))' if engine == 'clickhouse' else 'DECIMAL(18,6)'
        else:
            kind = 'Nullable(String)' if engine == 'clickhouse' else 'VARCHAR(65533)' if engine == 'starrocks' else 'TEXT'
        fields.append(f'{column} {kind}')
    suffix = ''
    if engine == 'clickhouse':
        suffix = ' ENGINE=MergeTree ORDER BY (occurred_at,event_id)'
    if engine == 'starrocks':
        suffix = ' DUPLICATE KEY(event_id,occurred_at) DISTRIBUTED BY HASH(event_id) BUCKETS 8 PROPERTIES ("replication_num"="1")'
    return f'CREATE TABLE {table} (' + ',\n'.join(fields) + ')' + suffix + ';'
