# ai-agent — nucleul unic de agent

Un singur nucleu pentru toate canalele (aplicație, WhatsApp). Primește un mesaj și întoarce **fapte structurate, entități și instrumente propuse**. Nu scrie texte finale pentru utilizator și nu execută nicio acțiune.

Logica pură e în [_shared/aiCore.ts](../_shared/aiCore.ts). Teste: din `apps/mobile`, `npx tsx ../../supabase/functions/_shared/aiCore.test.ts`.

## Cerere

`POST /functions/v1/ai-agent`

```json
{ "public_code": "ABC123", "message": "Cât costă tunsul?", "channel": "app" }
```

- `business_id` sau `public_code` — firma.
- `message` — textul clientului (max 2000 caractere).
- `channel` — `app` (implicit), `whatsapp` sau `internal`.

## Răspuns

```json
{
  "ok": true,
  "business_id": "…",
  "intent": "service_price",
  "confidence": 1,
  "source": "rules",
  "entities": { "serviceName": "Tuns", "dateHint": null },
  "facts": { "service": { "name": "Tuns", "priceRon": 50, "durationMinutes": 30 } },
  "proposedTools": [{ "tool": "get_free_slots", "risk": "read", "requiresConfirmation": false, "args": {}, "missing": ["date"] }],
  "handoff": false
}
```

Cifrele din `facts` vin numai din baza de date. Instrumentele cu `risk: "write"` au mereu `requiresConfirmation: true` — canalul cere confirmarea omului, apoi execută prin RPC-urile existente.

## Autorizare

- `app`: cheia publică (anon) sau JWT de utilizator. Faptele sunt date publice ale firmei.
- `whatsapp` / `internal`: numai cheia de serviciu.

## Secrete opționale (clasificator LLM)

Fără ele, nucleul merge doar pe reguli deterministe.

```bash
supabase secrets set AI_API_KEY=...        # cheia furnizorului compatibil OpenAI
supabase secrets set AI_MODEL=...          # modelul ales
supabase secrets set AI_API_BASE_URL=...   # implicit https://api.openai.com/v1 (ex. Groq, OpenRouter)
```

Modelul e consultat doar când regulile sunt nesigure. Poate alege doar o intenție și servicii reale; prețurile și duratele nu vin niciodată de la model.

## Bază de date

Migrația `20261020010000_v58_ai_agent_core.sql`:

- `business_ai_settings` (privat): `agent_enabled` (implicit **false**), `custom_faq` (max 4000 caractere), `updated_at`. Proprietarul firmei își citește/creează/modifică rândul; anon nu vede nimic; service_role are acces complet. Fără rând = agent oprit. Nimic AI nu stă în `business_profiles`, care e public.
- `ai_agent_log`: doar intenție/încredere/instrumente, fără corpul mesajelor; proprietarul își citește rândurile.
- `ai_agent_rate` + `ai_agent_check_rate(...)` (SECURITY DEFINER, doar service_role): contoare pe ferestre fixe.

## Limite

Verificate înainte de nucleu, deci înainte de orice apel LLM:

- per apelant (utilizator autentificat, altfel hash SHA-256 al IP-ului; WhatsApp poate trimite `caller_key`): **20/minut** și **200/zi**;
- per firmă: **1000/zi** (zile UTC).

Peste limită: HTTP 429 `{ ok: false, error: "rate_limited", scope, retry_after_s, message }` cu mesaj în română. Dacă verificarea limitelor eșuează, nucleul merge doar pe reguli (fără LLM).

Agent oprit sau fără setări: HTTP 403 `agent_disabled`.

## Deploy

```bash
supabase db push
supabase functions deploy ai-agent
```
