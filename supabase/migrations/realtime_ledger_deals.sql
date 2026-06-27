-- Сделки v2 живут в ledger.* → в realtime, чтобы кассирская лента обновлялась
-- вживую. Применено через apply_migration.
do $$
begin
  begin alter publication supabase_realtime add table ledger.transactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table ledger.journal_entries; exception when duplicate_object then null; end;
end $$;
