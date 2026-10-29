-- Minimal emulation of the roles and the auth and storage schemas provided by Supabase, on an
-- embedded Postgres (PGlite) for the RLS tests.
--
-- IMPORTANT: Only Supabase's INFRASTRUCTURE is emulated here. The tables, triggers,
-- functions and policies under test are loaded from the real migration files.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase's broad default privileges for the public schema: every new table, sequence
-- and function created there is opened to these three roles automatically. The tests run against this WORST case; the
-- migrations must revoke these privileges themselves.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth -----------------------------------------------------------------------
create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- In real Supabase it is read from the JWT; in tests from a per-transaction setting.
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- The full access token (e.g. "aal": two-factor authentication level). In real Supabase it is read from the
-- request.jwt.claims setting PostgREST sets; in tests from a per-transaction setting.
create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- storage --------------------------------------------------------------------
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select case
    when array_length(parts, 1) > 1 then parts[1:array_length(parts, 1) - 1]
    else '{}'::text[]
  end
  from (select string_to_array(name, '/') as parts) s
$$;

grant usage on schema storage to anon, authenticated, service_role;
-- Supabase also grants broad table privileges on this table; RLS policies do the restricting.
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
