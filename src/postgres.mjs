// A FRESH DATABASE FROM A TEMPLATE (Postgres): the fixed copy every run starts from.

/**
 * Drop the instance if it exists and create it again from the template, owned by `owner`. `asAdmin(args)` runs a
 * Postgres client program (dropdb, createdb, psql) with an administrator's rights and returns its output.
 * @param {{ template: string, instance: string, owner: string, asAdmin: (args: string[]) => string }} o
 */
export function freshFromTemplate({ template, instance, owner, asAdmin }) {
  asAdmin(['dropdb', '--if-exists', instance])
  asAdmin(['createdb', '-O', owner, '-T', template, instance])
}

/** The template's comment (`COMMENT ON DATABASE`), for a run's header: where the copy came from. */
export function templateComment({ template, asAdmin }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(template)) throw new Error(`not a plain database name: ${template}`)
  return asAdmin(['psql', '-tAc', `select shobj_description(oid, 'pg_database') from pg_database where datname = '${template}'`]).trim()
}
