// Two runs of a tiny application on the same database copy must hash the same. Runs only when
// PAGE_RECORDER_TEST_DATABASE names a Postgres database this test may empty and fill, and a Firefox for
// playwright-core is installed; otherwise it is skipped and says why.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from '../src/record.mjs'
import { compare } from '../src/hashes.mjs'

const URL_ = process.env.PAGE_RECORDER_TEST_DATABASE
let skip = URL_ ? false : 'PAGE_RECORDER_TEST_DATABASE is not set'
let pg, firefox
if (!skip) {
  try { pg = (await import('pg')).default; ({ firefox } = await import('playwright-core')) } catch (e) { skip = `a peer dependency is missing: ${e.message}` }
}
if (!skip && !existsSync(firefox.executablePath())) skip = 'no Firefox for playwright-core (npx playwright-core install firefox)'

/** The fixed copy: two rows, made the same way before every run. */
async function fresh() {
  const db = new pg.Client({ connectionString: URL_ })
  await db.connect()
  await db.query(`drop table if exists rec_rows, rec_label, things cascade; drop function if exists rec_capture() cascade;
    create table things (id uuid primary key default gen_random_uuid(), name text not null, made timestamptz not null default now());
    insert into things (id, name, made) values ('00000000-0000-4000-8000-000000000001', 'first', '2020-01-01Z'),
      ('00000000-0000-4000-8000-000000000002', 'second', '2020-01-02Z');`)
  await db.end()
  return URL_
}

/** The application: a list, a detail page, an add action for members only, and a clock on every page. */
async function start({ databaseUrl }) {
  const db = new pg.Client({ connectionString: databaseUrl })
  await db.connect()
  const server = createServer(async (req, res) => {
    const member = /(^|; )who=member/.test(req.headers.cookie ?? '')
    const html = body => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><body>${body}<p>Rendered ${new Date().toISOString()}</p></body></html>`) }
    if (req.url === '/sign-in') { res.writeHead(302, { 'set-cookie': 'who=member; Path=/', location: '/things' }); return res.end() }
    if (req.url === '/things') {
      const r = await db.query('select id, name from things order by made, id')
      return html(`<h1>Things</h1>${r.rows.map(t => `<p>${t.name} ${t.id}</p>`).join('')}${member ? '<p>member</p>' : ''}`)
    }
    const m = req.url.match(/^\/things\/([0-9a-f-]{36})$/)
    if (m) { const r = await db.query('select name from things where id = $1', [m[1]]); return html(r.rows[0] ? `<h1>${r.rows[0].name}</h1>` : 'none') }
    if (req.url === '/add' && req.method === 'POST') {
      if (!member) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"members only"}') }
      const r = await db.query(`insert into things (name) values ('added') returning id`)
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: r.rows[0].id, took: '12 ms' }))
    }
    res.writeHead(404); res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, stop: async () => { server.close(); await db.end() } }
}

const config = {
  database: { fresh },
  app: { start, commit: () => 'test' },
  audiences: [{
    name: 'member',
    signIn: async ({ newContext, baseUrl }) => { const c = await newContext(); const p = await c.newPage(); await p.goto(`${baseUrl}/sign-in`); await p.close(); return c },
  }],
  pages: [
    { address: '/things', fill: async () => ({ path: '/things' }) },
    { address: '/things/{id}', fill: async ({ db }) => ({ path: `/things/${(await db.query('select id from things order by id limit 1')).rows[0].id}` }) },
  ],
  acts: [{
    name: 'add.txt', key: 'add', address: '/add',
    press: async ({ context, baseUrl, audience, begin }) => {
      await begin()
      const r = await context.request.post(`${baseUrl}/add`, { failOnStatusCode: false })
      return { head: [`act add`, `as ${audience.name}`, `status ${r.status()}`], answer: await r.text() }
    },
  }],
  header: run => `audiences:\n${run.audiences.map(a => `  ${a.name}: ${a.signedIn}`).join('\n')}\n`,
}

test('two runs of one application on one copy hash the same; the act is refused for none and writes for a member', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'page-recorder-e2e-'))
  try {
    await record({ config, out: join(dir, 'a') })
    await record({ config, out: join(dir, 'b') })
    assert.deepEqual(compare(join(dir, 'a'), join(dir, 'b')), [])
    const none = readFileSync(join(dir, 'a/acts/none/add.txt'), 'utf8')
    assert.match(none, /status 403/)
    const member = readFileSync(join(dir, 'a/acts/member/add.txt'), 'utf8')
    assert.match(member, /"id":"<new-1>","took":"<duration>"/)
    assert.match(member, /"tbl":"things","op":"INSERT"/)
    assert.match(readFileSync(join(dir, 'a/after/member/000_things.txt'), 'utf8'), /added <new-1>/)
    assert.match(readFileSync(join(dir, 'a/visits/none/000_things.txt'), 'utf8'), /Rendered <now>/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
