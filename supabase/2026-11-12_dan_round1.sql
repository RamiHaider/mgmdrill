-- Applied 12 Nov 2026 after Dan's first review (see NOTES.md).
update holes set archived = true where not archived and zone = 'PAD' and ddh_name is null;
with last as (
  select distinct on (hole_id) hole_id, rig_id from shift_entries where hole_id is not null
  order by hole_id, shift_date desc, (shift = 'night') desc, created_at desc)
update holes h set rig_id = l.rig_id from last l where l.hole_id = h.id and h.rig_id is null;
with d as (select hole_id, min(shift_date) a, max(shift_date) b from shift_entries where hole_id is not null group by hole_id)
update holes h set start_date = coalesce(h.start_date, d.a),
  end_date = case when h.status = 'Complete' then coalesce(h.end_date, d.b) else h.end_date end
from d where d.hole_id = h.id;
with m as (select hole_id, max(end_m) mx from shift_entries where hole_id is not null group by hole_id)
update holes h set final_depth = m.mx from m where m.hole_id = h.id and h.status = 'Complete' and h.final_depth is null;
create or replace function holes_fill_on_complete() returns trigger language plpgsql as $$
declare mx numeric; a date; b date;
begin
  if new.status = 'Complete' then
    select max(end_m), min(shift_date), max(shift_date) into mx, a, b from shift_entries where hole_id = new.id;
    if new.final_depth is null then new.final_depth := mx; end if;
    if new.end_date is null then new.end_date := b; end if;
    if new.start_date is null then new.start_date := a; end if;
  end if;
  return new;
end $$;
drop trigger if exists holes_fill_on_complete on holes;
create trigger holes_fill_on_complete before insert or update on holes for each row execute function holes_fill_on_complete();
