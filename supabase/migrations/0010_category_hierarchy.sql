-- ============================================================================
-- CoinPlata · 0010_category_hierarchy.sql
-- Иерархия категорий для income/expense: parent_id указывает на родителя.
--   parent_id = NULL → корневая категория
--   parent_id != NULL → подкатегория (подчиняется своей parent)
--
-- group_name оставляем как есть для back-compat.
-- ============================================================================

-- 1. Self-FK колонка
alter table public.categories
  add column if not exists parent_id uuid references public.categories(id) on delete restrict;

create index if not exists categories_parent_idx
  on public.categories(parent_id)
  where parent_id is not null;

-- 2. Защита от циклов — parent должен быть того же type.
--    (subcategory income не может подчиняться expense-категории)
create or replace function public.check_category_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_parent_type text;
begin
  if new.parent_id is null then
    return new;
  end if;
  -- не может подчиняться самой себе
  if new.parent_id = new.id then
    raise exception 'Category cannot be its own parent';
  end if;
  -- parent должен существовать и быть того же type
  select type into v_parent_type from public.categories where id = new.parent_id;
  if v_parent_type is null then
    raise exception 'Parent category % not found', new.parent_id;
  end if;
  if v_parent_type <> new.type then
    raise exception
      'Subcategory type (%) does not match parent type (%)',
      new.type, v_parent_type;
  end if;
  -- запрещаем 3-уровневое вложение (категория → под → под-под)
  -- parent должен быть root (parent_id=NULL)
  if exists (
    select 1 from public.categories
    where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'Only 2 levels supported: category → subcategory';
  end if;
  return new;
end;
$BODY$;

drop trigger if exists categories_parent_check on public.categories;
create trigger categories_parent_check
  before insert or update of parent_id, type on public.categories
  for each row execute procedure public.check_category_parent();
