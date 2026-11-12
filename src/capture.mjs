// THE ROW CAPTURE (Postgres): every write to every table of a schema, labelled with the step that made it.
//
// Installed on the run's own database only — never as a migration — after the project's migrations and setup, on
// every table the schema lists then, so a table the code forgot is caught too. Not caught: TRUNCATE, a sequence that
// moves without a row, DDL.
//
// The two tables are a public contract: a project's own queries may read rec_rows (to order a run's new rows after
// the template's, say).
//   rec_label (label)                         the one current label
//   rec_rows  (seq, label, tbl, op, old, new) one row per write, in order

const ident = s => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`not a plain SQL identifier: ${s}`)
  return s
}

/** The capture's SQL for one schema. The trigger function is SECURITY DEFINER: it writes as the capture's owner,
 *  whichever login made the write, so a second login the application uses is caught without a grant on rec_rows. */
export function captureSql(schema = 'public') {
  const s = ident(schema)
  return `
create table ${s}.rec_label (only_row boolean primary key default true check (only_row), label text not null);
insert into ${s}.rec_label (label) values ('setup');
create table ${s}.rec_rows (
  seq   bigserial primary key,
  label text not null,
  tbl   text not null,
  op    text not null,
  old   jsonb,
  new   jsonb
);
create function ${s}.rec_capture() returns trigger language plpgsql security definer set search_path = ${s} as $$
begin
  insert into rec_rows (label, tbl, op, old, new) values (
    (select label from rec_label), TG_TABLE_NAME, TG_OP,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) end);
  return null;
end $$;
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = '${s}' and tablename not in ('rec_rows', 'rec_label') order by tablename loop
    execute format('create trigger rec_capture after insert or update or delete on ${s}.%I for each row execute function ${s}.rec_capture()', t);
  end loop;
end $$;`
}

/** Install the capture on a connected client. */
export async function installCapture(db, schema = 'public') {
  await db.query(captureSql(schema))
}

/** Set the label every following write is captured under. */
export async function setLabel(db, label, schema = 'public') {
  await db.query(`update ${ident(schema)}.rec_label set label = $1`, [label])
}

const where = ignore => ignore ? ` and not (${ignore})` : ''

/** A label's rows, one JSON object per line in write order. `ignore` is an SQL condition on rec_rows to leave out. */
export async function rowsOf(db, label, ignore, schema = 'public') {
  const r = await db.query(`select tbl, op, old, new from ${ident(schema)}.rec_rows where label = $1${where(ignore)} order by seq`, [label])
  return r.rows.map(x => JSON.stringify(x)).join('\n')
}

/** A label's shape: the distinct tables and operations it wrote, sorted, no values. */
export async function shapeOf(db, label, ignore, schema = 'public') {
  const r = await db.query(`select distinct tbl, op from ${ident(schema)}.rec_rows where label = $1${where(ignore)} order by tbl, op`, [label])
  return r.rows.map(x => `${x.tbl} ${x.op}`).join('\n')
}

/** Every id a captured INSERT gave its row (`new.id`), for masking. */
export async function insertedIds(db, schema = 'public') {
  const r = await db.query(`select new->>'id' as id from ${ident(schema)}.rec_rows where op = 'INSERT' and new ? 'id'`)
  return new Set(r.rows.map(x => x.id).filter(Boolean))
}

/** Every value a column held during the run (captured) or holds at its end; the table is in the capture's schema. */
export async function columnValues(db, columns, schema = 'public') {
  const keys = new Set()
  const s = ident(schema)
  for (const { table, column } of columns) {
    const now = await db.query(`select distinct ${ident(column)} as k from ${s}.${ident(table)} where ${ident(column)} is not null and ${ident(column)}::text <> ''`)
    const written = await db.query(`select old->>$2 as a, new->>$2 as b from ${s}.rec_rows where tbl = $1`, [table, column])
    for (const x of now.rows) keys.add(String(x.k))
    for (const x of written.rows) for (const k of [x.a, x.b]) if (k) keys.add(k)
  }
  return keys
}
