# Aplicare operatiuni Supabase: migrari v32-v36, deploy functii, verificare cron.
#
# Rulare din radacina repo (terminal unde esti logat cu Supabase CLI):
#   powershell -ExecutionPolicy Bypass -File ./scripts/supabase-apply.ps1
#
# Preconditii: `supabase login` + `supabase link --project-ref <REF>` deja facute.

$ErrorActionPreference = 'Stop'

Write-Host '== 0. Verificare CLI + link =='
supabase --version

Write-Host '== 1. Migrari v32-v36 (dry-run mai intai) =='
supabase db push --dry-run
supabase db push

Write-Host '== 2. Deploy functii (fix 30min + notify-moved) =='
supabase functions deploy send-reminders
supabase functions deploy notify-moved

Write-Host '== 3. Verificare cron (Dashboard SQL editor) =='
Write-Host 'Ruleaza interogarea de mai jos si confirma 2 randuri active:'
Write-Host "  select jobname, schedule, active from cron.job where jobname in ('send-reminders','expire-pending');"
Write-Host 'Asteptat: send-reminders la */2 * * * * si expire-pending la 0 * * * *.'
Write-Host 'Daca lipsesc, creeaza-le dupa exemplul pg_cron din supabase/README.md sectiunea Cron.'
Write-Host 'Alternativ: Dashboard -> Edge Functions -> Schedules.'
