-- Local E2E bootstrap: roles + auth/storage schema stubs that Supabase
-- provides as platform infrastructure. Everything the app's own schema
-- needs (carousel.*) lives in schema.sql, which replicates production
-- via live catalog introspection — this file only recreates the
-- platform-owned pieces those objects reference.

-- Supabase's standard role trio. authenticator is the login role the
-- shim's pool connects as; per request it switches to anon/authenticated
-- exactly like PostgREST does.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'postgres' noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- auth schema stub: just enough for FKs (auth.users) and RLS policies
-- (auth.uid()/auth.role(), same claim-reading definitions Supabase uses).
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  -- plaintext in the local harness; only ever holds throwaway test creds
  encrypted_password text not null,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'anon')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- storage schema stub: the shim serves files from disk, but production
-- migrations define policies on storage.objects, so the tables must exist.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default uuid_generate_v4(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

insert into storage.buckets (id, name, public)
values ('carousel-assets', 'carousel-assets', true)
on conflict (id) do nothing;
