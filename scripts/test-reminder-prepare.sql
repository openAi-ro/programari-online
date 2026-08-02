-- Pregătește o programare de TEST pentru reminder −30 min.
-- Rulează în Supabase Dashboard → SQL Editor.
--
-- Înainte: înlocuiește emailul dacă e nevoie, sau lasă ca să folosească
-- ultima programare approved a ta.

-- Opțiunea A: actualizează ULTIMA programare approved să înceapă peste ~30 min
UPDATE public.appointments a
SET
  start_at = now() + interval '30 minutes',
  end_at = now() + interval '30 minutes' + interval '60 minutes',
  status = 'approved',
  reminder_sent = false,
  decision_notified = true,
  updated_at = now()
WHERE a.id = (
  SELECT id FROM public.appointments
  WHERE status IN ('approved', 'pending')
  ORDER BY created_at DESC
  LIMIT 1
)
RETURNING id, start_at, end_at, status, reminder_sent, client_email, client_phone;

-- Verificare: ce e în fereastra 25–35 min acum?
SELECT
  id,
  status,
  reminder_sent,
  client_email,
  start_at,
  start_at - now() AS in_cate_minute
FROM public.appointments
WHERE status = 'approved'
  AND reminder_sent = false
  AND start_at BETWEEN now() + interval '25 minutes' AND now() + interval '35 minutes';
