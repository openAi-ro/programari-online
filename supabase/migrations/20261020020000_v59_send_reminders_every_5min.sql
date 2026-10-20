-- v59: send-reminders cron every 5 minutes instead of every 2.
--
-- Why: the job runs ~700 times/day (p50 1 s, up to 12 s) and adds background load
-- on the small instance. The reminder windows in send-reminders are wider than 5 min
-- (the "soon" window is start_at in now+25..35 min = 10 min wide; the 24h window
-- is now+23.5h..24.5h = 1 h wide), so every appointment still lands in at least
-- 2 runs. The reminder_sent / reminder_24h_sent flags prevent duplicates.
--
-- The job was created outside migrations (jobname 'send-reminders'). We only change
-- the schedule: URL and headers (including the secret) stay untouched.
-- Safe if the job is missing (alter_job is not called).

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'send-reminders';
  if v_jobid is not null then
    perform cron.alter_job(job_id := v_jobid, schedule := '*/5 * * * *');
  end if;
end;
$$;
