# ApnaDairy mobile app: API notes

For the team building the farmer app (now) and the customer app (later). The website and the app share one Supabase project, so the app uses the same tables, functions and rules. Everything below is enforced in the database; the app cannot skip a check.

## Connecting

- Supabase URL and the **publishable** key (`sb_publishable_…`), the same two values the website uses. Never put the secret / service_role key in the app.
- Use `supabase-js` (or the Flutter / Kotlin client). Call functions with `supabase.rpc('name', { p_arg: value })`.
- Errors come back as plain sentences (for example `answer the price offer waiting at your center first`). Show `error.message` to the user as it is.

## Accounts

Sign up with email and password and send the role in the user metadata:

```js
await supabase.auth.signUp({
  email, password,
  options: { data: { role: 'farmer', full_name: 'Rasheeda Bibi', phone: '03001234567' } },
})
```

- A farmer account starts as `pending`. A customer account (`role` left out) is `active` straight away.
- Read the account with `supabase.from('profiles').select('*').eq('id', user.id).single()`. `status` is `pending`, `active`, `rejected` or `suspended`.
- Google sign-in also works. A new Google account starts as a customer and becomes a pending farmer account when it sends farmer details (below), as long as it has no shop orders.

## Farmer app

### 1. Send details for approval

Upload the farmer's photo first, to the **private** bucket `farmer-photos`, inside a folder named with their user id:

```js
const path = `${user.id}/photo-${Date.now()}.jpg`
await supabase.storage.from('farmer-photos').upload(path, file, { upsert: true })
```

Then send the details (call again to fix them after a rejection):

```js
await supabase.rpc('submit_farmer_profile', {
  p_full_name, p_phone, p_city,                  // required
  p_village, p_address, p_farm_name,              // optional
  p_milk_type,                                    // 'cow' | 'buffalo' | 'mixed'
  p_cattle_count, p_daily_litres, p_notes,
  p_photo_path: path,                             // required before the admin can approve
  p_latitude, p_longitude,                        // optional, from GPS
})
```

The admin approves or rejects with a reason, and the farmer gets a notification and an email. A rejected farmer can fix the details and send them again with the same call. The reason is in `farmer_profiles.rejection_reason`.

To show the photo, make a signed URL: `supabase.storage.from('farmer-photos').createSignedUrl(path, 3600)`.

### 2. Home screen

`rpc('farmer_home')` returns everything the home screen needs in one call:

```json
{
  "status": "active",
  "profile": { "full_name": "...", "city": "...", "photo_path": "...", "rejection_reason": null, ... },
  "center":  { "id": "...", "center_name": "...", "city": "...", "address": "...", "since": "...", "farmer_row": "..." },
  "request": { "id": "...", "center_id": "...", "center_name": "...", "created_at": "..." }
}
```

`center` is set once a center has accepted the farmer, and `request` while a request is waiting. `farmer_row` is the farmer's id in the `farmers` table at that center, which the milk records use.

### 3. Choose a center

- `rpc('centers_for_farmer')` lists the approved milk centers in the farmer's **own city**, with rating, number of reviews, number of farmers, the center's buying rate per litre for each milk type (`buffalo_rate`, `cow_rate`, `mixed_rate`; the city's market rate when the center has not set its own) and `my_request` / `my_reason` (the farmer's last request to that center and the reason, if the center declined).
- `rpc('request_center', { p_center, p_note })` asks to sell to a center. Only one open request at a time.
- `rpc('cancel_center_request')` withdraws the waiting request.
- `rpc('my_farmer_requests')` is the center's list; the app does not need it.
- The center accepts or declines with a reason. The farmer gets a notification either way and, after a decline, can ask another center.
- `rpc('leave_center', { p_reason })` stops selling to the current center. Any price offer that is waiting must be answered first.
- `rpc('rate_center', { p_center, p_rating: 1-5, p_comment })` saves one review per center, which the farmer can change.

The admin never assigns farmers to centers.

### 4. Milk, offers and payments

The farmer can read their own rows (row level security does the filtering):

- `supabase.from('milk_collections').select('*').order('collected_at', { ascending: false })` shows each can, with its test result (`quality`, `freshness_score`, `ph`, `temperature_c`, `tds_ppm`, and `adulteration_score`: AI Model 2's chance of added water in %, 50 or more means water), price and `status` (`offered`, `accepted`, `rejected`, …).
- `rpc('decide_collection', { p_id, p_accept, p_reason })` answers a price offer. It returns `accepted`, `refused` or `expired`. An offer expires 2 hours after it is made.
- `supabase.from('farmer_payouts').select('*')` lists payments the center has sent.
- `rpc('farmer_answer_payout', { p_id, p_confirm, p_note })` confirms that money arrived, or disputes it with a note.

## Notifications (every app)

- `supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)` returns the user's own notifications only.
- Each one has `kind`, `title`, `body`, a `link` (a website path, which the app can map to its own screen), `created_at` and `read_at`.
- `rpc('mark_notifications_read', { p_ids: [id, …] })` marks some as read. Pass `null` to mark all.
- Important notifications are also emailed. Calling the `send-email` function with `{ kind: 'outbox' }` while signed in sends the waiting emails; the website does this whenever someone has it open, so the app may skip it.

Farmer kinds:

| Kind | When it is sent |
|---|---|
| `farmer_approved` / `farmer_rejected` | The admin decided on the farmer's details. |
| `center_accepted` / `center_declined` | The center answered the farmer's request. |
| `account` | The account was suspended or restored. |

## Customer app (later)

- `supabase.from('public_shops').select('*')` lists the shops: name, city, location, rating, photos.
- `supabase.from('public_listings').select('*')` lists the milk on sale, with `price_per_l` (after any discount), `quality`, `freshness_score`, `available_l`, `min_order_l`, `max_order_l` and `expires_at`.
  - Milk is sold for at most 2 days after collection.
  - Expired milk never appears in this list.
  - A discount shows up as `discount_pct`, and `price_per_l` is already the price after it.
  - `pricing_mode` is `manual` (the center sets the discount) or `dynamic` (the price drops by itself as the milk gets older).
  - For a dynamic listing, `price_stage` is `tested`, `good`, `standard`, `cooking` or `last_hours` (0, 10, 20, 30, 40% off), and `next_drop_at` is when the next drop comes (null in the last stage).
- `public_listings` also carries what AI Model 1 found in that milk: `model_quality` (Good, Acceptable, Poor), `spoilage_pct`, `model_shelf_left_h` and `tested_at`.
- The website's view-only marketplace reads two catalog views, which the app can use too:
  - `marketplace_milk`: milk listings with litres available, plus `listed_at`, `test_ph` and `test_temperature_c`.
    - `water_check` is `clear` (AI Model 2 found no added water in any batch on sale) or `suspected`.
  - `marketplace_products`: dairy products from product sellers.
- `rpc('place_shop_order', { p_items: [{ listing_id, quantity }], p_address, p_phone })` places an order from one shop and returns the order id. The website never calls this: its "Order" buttons point people to the app.
- The customer's orders are in `shop_orders`, with their items in `shop_order_items`.

## Rules the app should not try to enforce itself

The database already does these, and its error message says why:

- Expiry.
- Order limits.
- One open center request.
- Who may see which photo.
- Suspended accounts.

Keep the app's own checks for a quick hint only.
