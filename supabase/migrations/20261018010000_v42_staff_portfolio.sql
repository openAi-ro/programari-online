-- v42: galerie de lucrari (portofoliu) per specialist
-- Pozele se incarca in bucket-ul existent 'staff-photos' (v22).
alter table public.staff
  add column if not exists portfolio_urls text[] not null default '{}';
