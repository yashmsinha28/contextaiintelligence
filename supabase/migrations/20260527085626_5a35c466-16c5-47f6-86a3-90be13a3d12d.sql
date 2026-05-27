
create extension if not exists vector;

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536) not null,
  token_estimate int,
  created_at timestamptz not null default now()
);

create index idx_document_chunks_document_id on public.document_chunks(document_id);
create index idx_document_chunks_user_id on public.document_chunks(user_id);
create index document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.document_chunks to authenticated;
grant all on public.document_chunks to service_role;

alter table public.document_chunks enable row level security;

create policy "Users can view own chunks"
on public.document_chunks for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own chunks"
on public.document_chunks for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own chunks"
on public.document_chunks for delete to authenticated
using (auth.uid() = user_id);

-- Per-user similarity search
create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.user_id = match_user_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_document_chunks(vector, uuid, int) to authenticated, service_role;
