# Google Play: Data safety notes

Working notes for the Data safety form in Play Console. Nothing here has been submitted.
Update this file whenever the app starts collecting or storing something new.

## Changes from the R2 media migration (2026-10-27)

| Data type (Play category) | Collected | Shared | Purpose | Optional | Where it is stored |
|---|---|---|---|---|---|
| Photos (Photos and videos) | Yes | No | App functionality: profile photo, business logo, cover and gallery, staff photos, chat photos | Yes | Cloudflare R2 (EU hint), served by the app's media Worker |
| Videos (Photos and videos) | Yes | No | App functionality: business promo video (max 90 s), chat videos (max 30 s) | Yes | Cloudflare R2 |
| Other in-app messages (Messages) | Yes (already declared for text chat) | No | App functionality: chat between client and business, now with photo and video attachments | Yes | Supabase (text) + Cloudflare R2 (attachments) |

Answers that stay the same:

- Data is encrypted in transit: Yes (HTTPS to Supabase and to the Worker).
- Users can request deletion: Yes (same process as for the account).
- Cloudflare and Supabase act as service providers (processors), which Play does not count as "sharing".

What to mention in the privacy policy:

- Chat photos and videos are private: only the client and the business in that conversation can open them, through links that expire after 1 hour.
- Chat attachments are deleted automatically 90 days after upload.
- Public presentation media (logo, cover, gallery, staff photos, promo video, profile photo) is visible to anyone who opens the business page.
- The chat uses the camera (photo or video) and the system photo picker. Recording happens in the system camera app; the app itself does not record audio.
