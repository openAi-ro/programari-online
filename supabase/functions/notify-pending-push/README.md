# notify-pending-push

Trimite push Expo către owner-ul business-ului când se creează o programare `pending`.

## Database Webhook (Supabase Dashboard)

1. **Database → Webhooks → Create a new hook**
2. **Name:** `appointment-insert-push`
3. **Table:** `public.appointments`
4. **Events:** `INSERT`
5. **Type:** Supabase Edge Functions → `notify-pending-push`  
   sau HTTP URL:  
   `https://<PROJECT_REF>.supabase.co/functions/v1/notify-pending-push`
6. **HTTP Headers (recomandat):**
   - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
   - `x-webhook-secret: <WEBHOOK_SECRET>` (dacă setat ca secret pe function)

## Secrets

```bash
supabase secrets set WEBHOOK_SECRET=your-random-secret
# SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY sunt injectate automat pe hosted
```

## Deploy

```bash
supabase functions deploy notify-pending-push
```

## Test manual

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/notify-pending-push" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"record\":{\"id\":\"...\",\"business_id\":\"...\",\"status\":\"pending\",\"client_email\":\"a@b.com\"}}"
```
