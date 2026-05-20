-- Auto-maintain updated_at on every UPDATE to the reservations table.
-- The column has a DEFAULT of now() which only fires on INSERT; without a
-- trigger the column would never change on subsequent updates.

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reservations_set_updated_at on reservations;

create trigger reservations_set_updated_at
  before update on reservations
  for each row execute function set_updated_at();
