-- Saved in the Supabase SQL editor as "16 - Report: everything". Read-only.
-- One overview of everything the app collects, as ONE row with ONE json value (the SQL editor
-- only shows the last result, so it is all in one). No emails or names. Apart from the account
-- counts, only accounts that share (prefs.privacy.share). Bird names from public.bird_names
-- (snippet 4). Uses the shared-totals functions (snippets 9 and 15).
-- Includes medal checks (v2.0.3): how often mastered birds are missed at the next medal's level.
-- Tip: click the json cell and copy it, or paste it to Claude to read.
with
everyone as (select * from public.progress),
p as (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true'),
recs as (
  select p.user_id, r.key, r.value as v
  from p cross join lateral jsonb_each(case when jsonb_typeof(p.data->'recs') = 'object' then p.data->'recs' else '{}'::jsonb end) r
  where jsonb_typeof(r.value) = 'object'
),
birds as (
  select p.user_id, b.key as bird, b.value as v
  from p cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'birds') = 'object' then p.data->'learn'->'birds' else '{}'::jsonb end) b
  where jsonb_typeof(b.value) = 'object'
),
days as (
  select p.user_id, d.key::date as day, coalesce((d.value->>'a')::int, 0) as answers, coalesce((d.value->>'m')::int, 0) as mastered
  from p cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'days') = 'object' then p.data->'learn'->'days' else '{}'::jsonb end) d
  where d.key ~ '^\d{4}-\d{2}-\d{2}$'
),
scores as (select * from public.rec_scores()),
nm as (select id, name from public.bird_names)
select jsonb_build_object(
  'accounts', (select jsonb_build_object(
      'total', count(*),
      'sharing', count(*) filter (where data->'prefs'->'privacy'->>'share' = 'true'),
      'answered_privacy_v5', count(*) filter (where (data->'prefs'->'privacy'->>'v')::int >= 5), -- their flags and ratings count (v2.0.5)
      'privacy_versions', (select coalesce(jsonb_object_agg(v, c), '{}') from (select coalesce(data->'prefs'->'privacy'->>'v', 'none') as v, count(*) as c
                           from public.progress group by 1) pv),
      'updated_last_7_days', count(*) filter (where updated_at > now() - interval '7 days')) from everyone),

  'activity_per_week', (select coalesce(jsonb_agg(w order by w->>'week' desc), '[]') from (
      select jsonb_build_object('week', date_trunc('week', day)::date, 'active_people', count(distinct user_id),
                                'answers', sum(answers), 'mastered_by_week_end', max(mastered)) as w -- days.m = birds mastered so far that day
      from days where day > current_date - 63 group by date_trunc('week', day)) x),

  'progress_per_person', (select coalesce(jsonb_agg(x order by (x->>'answered')::int desc), '[]') from (
      select jsonb_build_object(
        'person', left(p.user_id::text, 8),
        'answered', coalesce((p.data->'learn'->>'answered')::int, 0),
        'in_play', jsonb_array_length(coalesce(p.data->'learn'->'pool', '[]')),
        'mastered', (select count(*) from birds b where b.user_id = p.user_id and (b.v->>'m')::boolean),
        'bronze', (select count(*) from birds b where b.user_id = p.user_id and b.v->>'medal' = '1'),
        'silver', (select count(*) from birds b where b.user_id = p.user_id and b.v->>'medal' = '2'),
        'gold', (select count(*) from birds b where b.user_id = p.user_id and b.v->>'medal' = '3'),
        'best_streak', p.data->'streak'->'best', 'streak_now', p.data->'streak'->'run',
        'other_recording_presses', (select sum(coalesce((b.v->>'oth')::int, 0)) from birds b where b.user_id = p.user_id),
        'skipped_new_birds_waiting', (select count(*) from birds b where b.user_id = p.user_id
                                      and (b.v->>'skipTo')::int > coalesce((p.data->'learn'->>'n')::int, 0)),
        'mix_ups_left', (select coalesce(sum(m2.value::int), 0) from jsonb_each(coalesce(p.data->'learn'->'mix', '{}')) m1
                         cross join lateral jsonb_each_text(m1.value) m2),
        'level', p.data->'prefs'->>'level', 'region', p.data->'prefs'->>'area', 'habitats', p.data->'prefs'->'habitats',
        'background', p.data->'prefs'->>'theme', 'green', p.data->'prefs'->>'accent',
        'auto_choices_off', p.data->'prefs'->>'autoChoices' = 'false', 'autoplay', p.data->'prefs'->'autoplay') as x
      from p) y),

  'sounds_ready_in_time', (select jsonb_build_object(
      'phone', jsonb_build_object('straight_away', sum(coalesce((v->>'mp')::int, 0)), 'waited', sum(coalesce((v->>'mw')::int, 0)),
               'percent_straight_away', round(100.0 * sum(coalesce((v->>'mp')::int, 0)) / nullif(sum(coalesce((v->>'mp')::int, 0) + coalesce((v->>'mw')::int, 0)), 0), 1),
               'avg_wait_s', round(sum(coalesce((v->>'mt')::numeric, 0)) / nullif(sum(coalesce((v->>'mw')::int, 0)), 0) / 1000, 1)),
      'computer', jsonb_build_object('straight_away', sum(coalesce((v->>'dp')::int, 0)), 'waited', sum(coalesce((v->>'dw')::int, 0)),
               'percent_straight_away', round(100.0 * sum(coalesce((v->>'dp')::int, 0)) / nullif(sum(coalesce((v->>'dp')::int, 0) + coalesce((v->>'dw')::int, 0)), 0), 1),
               'avg_wait_s', round(sum(coalesce((v->>'dt')::numeric, 0)) / nullif(sum(coalesce((v->>'dw')::int, 0)), 0) / 1000, 1))) from recs),

  'slowest_recordings', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('rec', rec, 'people_played', play_people, 'people_waited', wait_people, 'waits', waits, 'size_kb', size_kb) as x
      from scores where waits > 0 order by wait_people::numeric / greatest(play_people, 1) desc, waits desc limit 15) y),

  'listening', (select jsonb_build_object(
      'avg_seconds_all', round(sum(listen_secs)::numeric / nullif(sum(listens), 0), 1),
      'listens', sum(listens),
      'longest_avg', (select coalesce(jsonb_agg(x), '[]') from (
          select jsonb_build_object('rec', rec, 'listens', listens, 'avg_s', round(listen_secs::numeric / listens, 1)) as x
          from scores where listens > 0 order by listen_secs::numeric / listens desc limit 10) y)) from scores),

  'recordings_flagged_or_low_rated', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('rec', rec, 'flags', flags, 'raters', raters, 'avg_stars', avg_stars, 'people_played', play_people) as x
      from scores where flags > 0 or (raters > 0 and avg_stars <= 2) order by flags desc, avg_stars nulls last limit 15) y),

  -- Flags and ratings per person and per reason: accounts whose flags count (share, or privacy v5+).
  'flags_and_ratings_per_person', (select coalesce(jsonb_agg(x order by (x->>'flags')::int desc), '[]') from (
      select jsonb_build_object('person', left(f.user_id::text, 8),
               'shares', coalesce(f.data->'prefs'->'privacy'->>'share' = 'true', false),
               'flags', count(*) filter (where coalesce(r.value->>'flag', '') <> ''),
               'ratings', count(*) filter (where r.value->>'stars' ~ '^[1-5]$'),
               'flag_reasons', (select coalesce(jsonb_object_agg(k, c), '{}') from (
                   select r2.value->>'flag' as k, count(*) as c
                   from jsonb_each(case when jsonb_typeof(f.data->'recs') = 'object' then f.data->'recs' else '{}'::jsonb end) r2
                   where jsonb_typeof(r2.value) = 'object' and coalesce(r2.value->>'flag', '') <> '' group by 1) fr)) as x
      from public.progress f
      cross join lateral jsonb_each(case when jsonb_typeof(f.data->'recs') = 'object' then f.data->'recs' else '{}'::jsonb end) r
      where jsonb_typeof(r.value) = 'object'
        and (f.data->'prefs'->'privacy'->>'share' = 'true' or coalesce(f.data->'prefs'->'privacy'->>'v', '') ~ '^([5-9]|[1-9][0-9]+)$')
      group by f.user_id, f.data) y),

  'best_rated_recordings', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('rec', rec, 'raters', raters, 'avg_stars', avg_stars) as x
      from scores where raters > 0 and avg_stars >= 4 order by avg_stars desc, raters desc limit 10) y),

  'recordings_often_answered_wrong', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('rec', rec, 'right', right_answers, 'wrong', wrong_answers,
                                'percent_right', round(100.0 * right_answers / (right_answers + wrong_answers))) as x
      from scores where right_answers + wrong_answers >= 3 order by right_answers::numeric / (right_answers + wrong_answers), wrong_answers desc limit 15) y),

  'hardest_birds', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('bird', coalesce(n.name, b.bird), 'people', count(*),
               'right', sum(coalesce((b.v->>'right')::int, 0)), 'wrong', sum(coalesce((b.v->>'wrong')::int, 0)),
               'percent_right', round(100.0 * sum(coalesce((b.v->>'right')::int, 0)) / nullif(sum(coalesce((b.v->>'right')::int, 0) + coalesce((b.v->>'wrong')::int, 0)), 0)),
               'mastered_by', count(*) filter (where (b.v->>'m')::boolean),
               'avg_cards_to_master', round(avg((b.v->>'firstM')::numeric), 1)) as x
      from birds b left join nm n on n.id = b.bird
      group by coalesce(n.name, b.bird)
      having sum(coalesce((b.v->>'right')::int, 0) + coalesce((b.v->>'wrong')::int, 0)) >= 5
      order by sum(coalesce((b.v->>'wrong')::int, 0))::numeric / nullif(sum(coalesce((b.v->>'right')::int, 0) + coalesce((b.v->>'wrong')::int, 0)), 0) desc
      limit 15) y),

  -- Checks on mastered birds (answers at the next medal's level: birds.ur right / uw wrong).
  -- Bronze row = silver checks on bronze birds: if many are missed, bronze comes too easily.
  'medal_checks', (select coalesce(jsonb_agg(x order by x->>'medal_now'), '[]') from (
      select jsonb_build_object(
               'medal_now', case (b.v->>'medal')::int when 1 then 'bronze' when 2 then 'silver' else 'gold' end,
               'birds', count(*), 'birds_checked', count(*) filter (where coalesce((b.v->>'ur')::int, 0) + coalesce((b.v->>'uw')::int, 0) > 0),
               'right', sum(coalesce((b.v->>'ur')::int, 0)), 'wrong', sum(coalesce((b.v->>'uw')::int, 0)),
               'percent_wrong', round(100.0 * sum(coalesce((b.v->>'uw')::int, 0)) / nullif(sum(coalesce((b.v->>'ur')::int, 0) + coalesce((b.v->>'uw')::int, 0)), 0), 1),
               'avg_cards_to_master', round(avg((b.v->>'firstM')::numeric), 1)) as x
      from birds b
      where coalesce((b.v->>'m')::boolean, false) and b.v->>'medal' ~ '^[1-3]$'
      group by (b.v->>'medal')::int) y),

  'medal_checks_most_missed', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('bird', coalesce(n.name, b.bird), 'medal', b.v->'medal', 'right', b.v->'ur', 'wrong', b.v->'uw',
                                'cards_to_master', b.v->'firstM', 'person', left(b.user_id::text, 8)) as x
      from birds b left join nm n on n.id = b.bird
      where coalesce((b.v->>'uw')::int, 0) > 0
      order by (b.v->>'uw')::int desc, coalesce((b.v->>'ur')::int, 0) limit 15) y),

  'slowest_to_master', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('bird', coalesce(n.name, b.bird), 'points', b.v->'s', 'right', b.v->'right', 'wrong', b.v->'wrong', 'person', left(b.user_id::text, 8)) as x
      from birds b left join nm n on n.id = b.bird
      where not coalesce((b.v->>'m')::boolean, false) and coalesce((b.v->>'right')::int, 0) + coalesce((b.v->>'wrong')::int, 0) >= 8
      order by coalesce((b.v->>'right')::int, 0) + coalesce((b.v->>'wrong')::int, 0) desc limit 15) y),

  'mixed_up_pairs', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('a', coalesce(na.name, m.a), 'b', coalesce(nb.name, m.b), 'people', m.users, 'times', m.times) as x
      from public.mix_stats() m left join nm na on na.id = m.a left join nm nb on nb.id = m.b
      order by m.users desc, m.times desc limit 15) y)
) as everything;
