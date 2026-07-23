-- Leads captured from the onededuction.com lead-capture form.
-- RLS is enabled with zero policies for anon/authenticated roles, which
-- means both roles are denied by default. Only the service_role key
-- (used exclusively by the submit-lead Edge Function, never shipped to
-- the browser) can read or write this table.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  first_name        text not null check (char_length(first_name) between 1 and 100),
  last_name         text not null check (char_length(last_name) between 1 and 100),
  email             text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone             text not null check (char_length(phone) between 6 and 30),

  employment_type   text not null check (employment_type in ('payg', 'sole-trader', 'investor', 'multiple')),
  income_bracket    text not null check (income_bracket in ('under-40k', '40-80k', '80-150k', '150k-plus')),
  state             text not null,
  financial_year    text not null,

  consent_at        timestamptz not null default now(),
  source            text not null default 'website',

  -- Set to true once the lead has been handed to a matched agent.
  -- Lets you run a retention/deletion job against old, actioned leads.
  matched_at        timestamptz
);

alter table public.leads enable row level security;

comment on table public.leads is
  'Lead-capture submissions from the onededuction.com website. Contains personal information under the Privacy Act 1988 — access restricted to the service role only.';
