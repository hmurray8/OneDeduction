-- Replace the single employment_type choice with a multi-select of income
-- sources (salary, sole trader, rental property, shares, crypto, other),
-- since most leads have more than one this year.

alter table public.leads add column income_sources text[];

update public.leads
set income_sources = case employment_type
  when 'payg'        then array['payg']
  when 'sole-trader' then array['sole-trader']
  when 'investor'    then array['shares-investments']
  when 'multiple'    then array['payg', 'sole-trader']
  else array['other']
end
where income_sources is null;

alter table public.leads
  alter column income_sources set not null,
  add constraint income_sources_valid check (
    array_length(income_sources, 1) > 0
    and income_sources <@ array['payg', 'sole-trader', 'rental-property', 'shares-investments', 'crypto', 'other']::text[]
  );

alter table public.leads drop column employment_type;
