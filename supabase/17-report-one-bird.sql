-- Saved in the Supabase SQL editor as "17 - Report: one bird". Read-only.
-- Why does one bird keep coming up? For every account that has met it: its learning state,
-- the last 50 answers (which of them were this bird, hinted or not, and how many cards apart),
-- mix-ups both ways, and any compare-pair test waiting. ONE json value (the editor shows the
-- last result only). No emails or names: person = first 8 characters of the account id.
-- Change the bird id on the next line (hackin1 = Half-collared Kingfisher; ids in public.bird_names).
with pick as (select 'hackin1'::text as id),
p as (
  select pr.user_id, pr.data->'learn' as l
  from public.progress pr, pick
  where pr.data->'learn'->'birds' ? pick.id
)
select jsonb_build_object(
  'bird', (select coalesce(n.name, pick.id) from pick left join public.bird_names n on n.id = pick.id),
  'people', (select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object(
      'person', left(p.user_id::text, 8),
      'cards_now', p.l->'n',
      'state', p.l->'birds'->pick.id,                 -- s points, right/wrong, rightRun, miss, due, m, medal, up, iv...
      'cards_until_due', (p.l->'birds'->pick.id->>'due')::int - (p.l->>'n')::int,
      'in_pool', p.l->'pool' ? pick.id,
      'last_50_answers', jsonb_build_object(
        'total', jsonb_array_length(coalesce(p.l->'history', '[]')),
        'this_bird', (select count(*) from jsonb_array_elements(coalesce(p.l->'history', '[]')) h where h->>'id' = pick.id),
        'this_bird_cards', (select coalesce(jsonb_agg(jsonb_build_object('n', h->'n', 'right', h->'correct', 'hinted', h->'hinted') order by (h->>'n')::int), '[]')
                            from jsonb_array_elements(coalesce(p.l->'history', '[]')) h where h->>'id' = pick.id),
        'most_shown', (select coalesce(jsonb_agg(jsonb_build_object('bird', coalesce(n.name, t.id), 'times', t.c) order by t.c desc), '[]')
                       from (select h->>'id' as id, count(*) as c from jsonb_array_elements(coalesce(p.l->'history', '[]')) h
                             group by h->>'id' order by count(*) desc limit 8) t left join public.bird_names n on n.id = t.id)),
      'heard_it_thought', p.l->'mix'->pick.id,         -- heard this bird, picked these
      'thought_it_was_it', (select coalesce(jsonb_object_agg(coalesce(n.name, m.key), m.value->pick.id), '{}')
                            from jsonb_each(coalesce(p.l->'mix', '{}')) m left join public.bird_names n on n.id = m.key
                            where m.value ? pick.id),
      'pair_test_waiting', p.l->'pairTest',
      'learning_now', (select count(*) from jsonb_each(p.l->'birds') b
                       where p.l->'pool' ? b.key and coalesce((b.value->>'m')::boolean, false) = false and coalesce((b.value->>'intro')::boolean, false))
    ) as x
    from p, pick
    order by (p.l->>'answered')::int desc nulls last) y)
) as one_bird;
