
-- Private bucket for user-uploaded source documents
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Storage RLS: users can only touch files under a folder matching their user id
create policy "Users can read own documents"
on storage.objects for select to authenticated
using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload own documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own documents"
on storage.objects for update to authenticated
using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own documents"
on storage.objects for delete to authenticated
using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- Metadata table for uploaded documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  status text not null default 'uploaded',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_documents_user_id on public.documents(user_id);

grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;

alter table public.documents enable row level security;

create policy "Users can view own documents"
on public.documents for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own documents"
on public.documents for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own documents"
on public.documents for update to authenticated
using (auth.uid() = user_id);

create policy "Users can delete own documents"
on public.documents for delete to authenticated
using (auth.uid() = user_id);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger update_documents_updated_at
before update on public.documents
for each row execute function public.update_updated_at_column();
