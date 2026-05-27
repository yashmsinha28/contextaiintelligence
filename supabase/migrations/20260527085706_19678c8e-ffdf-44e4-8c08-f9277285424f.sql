
revoke execute on function public.match_document_chunks(vector, uuid, int) from authenticated, anon, public;
grant execute on function public.match_document_chunks(vector, uuid, int) to service_role;
