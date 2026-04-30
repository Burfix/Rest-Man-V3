-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Sea Castle Hotel Camps Bay — Guest Reviews Demo Data
--
-- 25 realistic reviews spanning 90 days.
-- Sources: Google, Booking.com, TripAdvisor, Airbnb, Manual
-- Mix: excellent location/views, friendly staff, cleanliness complaints,
--      aircon issue, check-in delay, maintenance, value, breakfast.
-- Provides enough volume for trends, risks, and sentiment analysis.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_site_id uuid := '00000000-0000-0000-0000-000000000010';
BEGIN

-- Only insert if site exists (safe re-run)
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = v_site_id) THEN
  RAISE NOTICE 'Sea Castle site not found — skipping seed';
  RETURN;
END IF;

INSERT INTO reviews (
  site_id, source, platform, reviewer_name, rating, rating_scale,
  review_text, review_date, sentiment, sentiment_label, sentiment_score,
  category_tags, urgency, review_status, tags, flagged
) VALUES

-- ── Excellent reviews ─────────────────────────────────────────────────────────

(v_site_id, 'google', 'google', 'Sarah M.', 4.8, 5,
 'Absolutely breathtaking! The sea views from our room were stunning. Staff were incredibly friendly and helpful throughout our stay. Would highly recommend Sea Castle to anyone visiting Camps Bay.',
 current_date - interval '3 days',
 'positive', 'positive', 0.92,
 '["sea_view","service","staff","location"]', 'low', 'new', '{}', false),

(v_site_id, 'booking_com', 'other', 'James T.', 9.2, 10,
 'Perfect location right on the beachfront. Beautiful rooms with stunning ocean views. The pool area is excellent. Breakfast was delicious and varied. Will definitely return.',
 current_date - interval '5 days',
 'positive', 'positive', 0.89,
 '["location","sea_view","pool","breakfast","value"]', 'low', 'new', '{}', false),

(v_site_id, 'tripadvisor', 'other', 'Amelia R.', 5, 5,
 'One of the most beautiful hotels I have ever stayed at. The views of the Atlantic Ocean are unmatched. Staff went above and beyond to make our anniversary special. Exceptional service.',
 current_date - interval '7 days',
 'positive', 'positive', 0.95,
 '["sea_view","service","staff","amenities"]', 'low', 'responded', '{}', false),

(v_site_id, 'google', 'google', 'Pieter van D.', 4.5, 5,
 'Great value for money considering the incredible location. Friendly and professional front desk team. Rooms are spacious and well-appointed. Parking was easy. Highly recommended.',
 current_date - interval '9 days',
 'positive', 'positive', 0.85,
 '["value","location","staff","parking"]', 'low', 'new', '{}', false),

(v_site_id, 'airbnb', 'other', 'Claire B.', 4.9, 5,
 'The most beautiful view I have ever woken up to. Spotlessly clean room, very helpful staff, and the location is absolutely prime Camps Bay. Breakfast exceeded expectations.',
 current_date - interval '11 days',
 'positive', 'positive', 0.94,
 '["sea_view","cleanliness","breakfast","staff","location"]', 'low', 'new', '{}', false),

(v_site_id, 'google', 'google', 'Thabo M.', 4.7, 5,
 'Stayed for a long weekend. The hotel has a wonderful atmosphere and the location can not be beaten. Staff were all professional and welcoming. The pool looked great. Would come back.',
 current_date - interval '15 days',
 'positive', 'positive', 0.88,
 '["location","staff","pool","sea_view"]', 'low', 'new', '{}', false),

(v_site_id, 'booking_com', 'other', 'Liesel K.', 8.8, 10,
 'Wonderful stay. Beautiful sea views, great location, very friendly staff. Breakfast had good variety and the coffee was excellent. Clean and comfortable rooms.',
 current_date - interval '18 days',
 'positive', 'positive', 0.86,
 '["sea_view","location","staff","breakfast","cleanliness"]', 'low', 'new', '{}', false),

(v_site_id, 'manual', 'other', 'David P.', 5, 5,
 'Exceptional hotel. Everything about the stay was perfect — from the stunning views to the attentive staff and the delicious food. Highly recommend Sea Castle for a luxury Cape Town escape.',
 current_date - interval '22 days',
 'positive', 'positive', 0.97,
 '["sea_view","staff","service","location","value"]', 'low', 'responded', '{}', false),

-- ── Mixed / neutral reviews ────────────────────────────────────────────────────

(v_site_id, 'google', 'google', 'Rachel F.', 3.5, 5,
 'Great location and views, but our check-in was quite slow — we waited about 40 minutes in the queue. Room was fine once we got in. The sea view made up for the delay somewhat.',
 current_date - interval '4 days',
 'neutral', 'mixed', 0.15,
 '["location","sea_view","check_in"]', 'medium', 'action_required', '{}', false),

(v_site_id, 'booking_com', 'other', 'Anke S.', 7.0, 10,
 'The location is superb and the view is truly special. However, the breakfast buffet was a bit limited compared to what the price suggests. Staff were helpful. Would return for the location.',
 current_date - interval '8 days',
 'neutral', 'mixed', 0.2,
 '["location","breakfast","staff","value"]', 'medium', 'new', '{}', false),

(v_site_id, 'tripadvisor', 'other', 'Mike N.', 3, 5,
 'Mixed experience. The hotel is in a brilliant location and the sea views are stunning. However, the room was a bit dated and the Wi-Fi was unreliable. Staff were friendly. Average overall.',
 current_date - interval '12 days',
 'neutral', 'mixed', 0.05,
 '["location","sea_view","amenities","value"]', 'medium', 'new', '{}', false),

(v_site_id, 'manual', 'other', 'Zanele D.', 3.5, 5,
 'Nice property and good views but the noise from the street was quite loud at night which affected our sleep. Breakfast was good. Staff friendly. Location is top class.',
 current_date - interval '20 days',
 'neutral', 'mixed', 0.1,
 '["noise","location","breakfast","staff","sea_view"]', 'medium', 'new', '{}', false),

-- ── Negative reviews — cleanliness ────────────────────────────────────────────

(v_site_id, 'booking_com', 'other', 'Hannah C.', 5.0, 10,
 'The room was not clean when we arrived. There were stains on the bathroom tiles and the towels looked used. The view was beautiful but we were uncomfortable the whole stay. Very disappointed.',
 current_date - interval '2 days',
 'negative', 'negative', -0.78,
 '["cleanliness","service"]', 'high', 'action_required', '{}', true),

(v_site_id, 'google', 'google', 'Mark J.', 2, 5,
 'Dirty room. Found mould in the bathroom ceiling. When we reported it to reception they moved us but the new room also had issues with the smell. For the price this is unacceptable.',
 current_date - interval '6 days',
 'negative', 'negative', -0.88,
 '["cleanliness","maintenance","service"]', 'critical', 'action_required', '{}', true),

(v_site_id, 'tripadvisor', 'other', 'Sandra W.', 2, 5,
 'I was shocked by the state of the room. Clearly not properly cleaned between guests. Hair in the shower, dirty coffee cups, stained bedding. Staff were apologetic but it should not happen.',
 current_date - interval '14 days',
 'negative', 'negative', -0.82,
 '["cleanliness","service"]', 'high', 'action_required', '{}', true),

-- ── Negative reviews — maintenance ───────────────────────────────────────────

(v_site_id, 'booking_com', 'other', 'Carlos M.', 4.0, 10,
 'Room was fine but the air conditioning was not working properly. Reported to front desk on day 1 but nothing was done for 3 days. Camps Bay in summer without aircon is very uncomfortable.',
 current_date - interval '1 day',
 'negative', 'negative', -0.65,
 '["maintenance","amenities","service","check_in"]', 'high', 'action_required', '{}', true),

(v_site_id, 'google', 'google', 'Yolanda B.', 2.5, 5,
 'The toilet in our bathroom was leaking the whole stay. Maintenance came to look at it but never fixed it. We had to call 3 times. For a hotel at this price point that is simply not acceptable.',
 current_date - interval '10 days',
 'negative', 'negative', -0.75,
 '["maintenance","service"]', 'high', 'action_required', '{}', true),

(v_site_id, 'airbnb', 'other', 'Peter L.', 3.0, 5,
 'Beautiful hotel but our shower was only producing cold water the entire second day. Maintenance said they would fix it but it was still cold the next morning. Location saves the rating.',
 current_date - interval '25 days',
 'negative', 'mixed', -0.45,
 '["maintenance","location","sea_view"]', 'medium', 'reviewed', '{}', false),

-- ── Negative reviews — staff / service ───────────────────────────────────────

(v_site_id, 'tripadvisor', 'other', 'Fatima A.', 1.5, 5,
 'The receptionist at check-in was incredibly rude and unhelpful. We had booked a sea view room and were given an interior room without explanation. When we queried it she was dismissive and unfriendly. Spoilt the whole trip.',
 current_date - interval '3 days',
 'negative', 'negative', -0.91,
 '["staff","service","check_in"]', 'critical', 'action_required', '{}', true),

(v_site_id, 'booking_com', 'other', 'Tom K.', 6.0, 10,
 'The hotel itself is lovely and the location is hard to beat. However I found the front desk staff to be quite indifferent — not particularly welcoming or helpful when we had questions.',
 current_date - interval '30 days',
 'negative', 'mixed', -0.35,
 '["staff","service","location","sea_view"]', 'medium', 'reviewed', '{}', false),

-- ── Check-in / value complaints ───────────────────────────────────────────────

(v_site_id, 'google', 'google', 'Linda P.', 3, 5,
 'Check-in process was disorganised and slow. Waited over an hour. The room was good once we got there and the views are spectacular. Would return but hope the check-in improves.',
 current_date - interval '16 days',
 'negative', 'mixed', -0.3,
 '["check_in","location","sea_view"]', 'medium', 'new', '{}', false),

(v_site_id, 'manual', 'other', 'Brenda O.', 2, 5,
 'Very overpriced for what you get. The room is small, no minibar stocked, and the breakfast is extra. For the nightly rate I expected much more. Nice view but that is all.',
 current_date - interval '35 days',
 'negative', 'negative', -0.7,
 '["value","breakfast","amenities"]', 'high', 'new', '{}', true),

-- ── Recent critical one ────────────────────────────────────────────────────────

(v_site_id, 'google', 'google', 'Anonymous', 1, 5,
 'Worst hotel experience in years. Dirty room, rude staff, aircon not working. Reported to management and got no response. Do not waste your money here. We demanded a refund.',
 current_date - interval '1 day',
 'negative', 'negative', -0.97,
 '["cleanliness","staff","maintenance","service","value"]', 'critical', 'action_required', '{}', true),

-- ── Older positive (for trend data) ───────────────────────────────────────────

(v_site_id, 'tripadvisor', 'other', 'John R.', 4.5, 5,
 'Sea Castle is one of the best hotels on the Cape. Incredible location, stunning pool, excellent staff. Breakfast is a highlight. The sea view rooms are worth the premium.',
 current_date - interval '60 days',
 'positive', 'positive', 0.9,
 '["sea_view","pool","staff","breakfast","location"]', 'low', 'responded', '{}', false)

ON CONFLICT DO NOTHING;

END $$;
