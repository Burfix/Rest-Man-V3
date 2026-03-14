-- ============================================================
-- Ops Engine — Seed Data
-- Run after 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- Venue Settings
-- ============================================================
insert into venue_settings (
  venue_name,
  max_capacity,
  max_table_size,
  opening_hours_json,
  service_charge_threshold
) values (
  'Si Cantina Sociale',
  200,
  100,
  '{
    "sunday":    { "open": "08:30", "close": "21:30" },
    "monday":    { "open": "08:30", "close": "21:30" },
    "tuesday":   { "open": "08:30", "close": "21:30" },
    "wednesday": { "open": "08:30", "close": "21:30" },
    "thursday":  { "open": "08:30", "close": "21:30" },
    "friday":    { "open": "08:30", "close": "late"  },
    "saturday":  { "open": "08:30", "close": "late"  }
  }'::jsonb,
  8
)
on conflict do nothing;

-- ============================================================
-- Events: Quiz Night (every 2nd Friday from 2026-03-13)
-- Seeding 6 occurrences — recurring logic in app handles rest
-- ============================================================
insert into events (name, event_date, start_time, end_time, description, is_special_event, booking_enabled)
values
  ('Quiz Night', '2026-03-13', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true),
  ('Quiz Night', '2026-03-27', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true),
  ('Quiz Night', '2026-04-10', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true),
  ('Quiz Night', '2026-04-24', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true),
  ('Quiz Night', '2026-05-08', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true),
  ('Quiz Night', '2026-05-22', '19:00', '22:00', 'Test your knowledge at our weekly trivia night. Teams of up to 6.', false, true)
on conflict (name, event_date) do nothing;

-- ============================================================
-- Events: Salsa Night (alternate Fridays — not quiz night Fridays)
-- Starting 2026-03-20
-- ============================================================
insert into events (name, event_date, start_time, end_time, description, is_special_event, booking_enabled)
values
  ('Salsa Night', '2026-03-20', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true),
  ('Salsa Night', '2026-04-03', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true),
  ('Salsa Night', '2026-04-17', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true),
  ('Salsa Night', '2026-05-01', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true),
  ('Salsa Night', '2026-05-15', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true),
  ('Salsa Night', '2026-05-29', '20:00', '23:30', 'Live salsa music and dancing. All levels welcome.', false, true)
on conflict (name, event_date) do nothing;

-- ============================================================
-- Events: Sip & Paint (fixed dates)
-- ============================================================
insert into events (name, event_date, start_time, end_time, description, is_special_event, booking_enabled)
values
  ('Sip & Paint', '2026-03-21', '14:00', '17:00', 'Creative afternoon — wine, canvas & guided painting. R350 per person, includes materials.', false, true),
  ('Sip & Paint', '2026-03-28', '14:00', '17:00', 'Creative afternoon — wine, canvas & guided painting. R350 per person, includes materials.', false, true)
on conflict (name, event_date) do nothing;
