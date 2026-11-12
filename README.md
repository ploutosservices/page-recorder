# page-recorder

Record what every kind of user sees and writes in a web application, and compare two versions of the code.

On a fixed copy of your database, page-recorder opens every page and presses every action as each kind of user (an
**audience**: one role, signed in as one test user), and as nobody signed in. For each one it writes down what came
back and every database row it wrote. It masks what changes from run to run anyway (fresh ids, the clock, a vendor's
reference) and hashes each file. Record two versions of your code on the same copy and compare the hashes: every file
that differs is a change in what someone sees or writes, and nothing else is.

It is for the change that must not change behaviour — a refactor, a move behind an API, a framework upgrade — and for
proving that a permission change reaches exactly the users it should.

```sh
npm install --save-dev @ploutosservices/page-recorder pg playwright-core
npx playwright-core install firefox
npx page-recorder record --out runs/before          # on the old code (--out must be new or empty)
npx page-recorder record --out runs/after           # on the new code, same database copy
npx page-recorder compare runs/before runs/after     # exit 0: nothing differs; 1: the files that do
```

It needs Node 22.17 or later, Postgres (the row capture is Postgres triggers), and `pg` and `playwright-core`, which
are peer dependencies so their versions are yours (TypeScript users add `@types/pg`). A PDF answer is kept by its text
and needs `pdftotext` (poppler). The package's own CI runs the unit tests only; the end-to-end test runs where
`PAGE_RECORDER_TEST_DATABASE` names a Postgres database and Firefox is installed.

## One run

1. **Database.** `database.fresh()` makes a new database from your fixed copy and returns its connection string
   (`freshFromTemplate` does it for Postgres: drop, then `createdb -T`). `prepare` runs your migrations; `setup`
   runs before the capture, so what it writes (test users' email addresses, grants) is in no file.
2. **Row capture.** One trigger per table writes every insert, update and delete into `rec_rows (seq, label, tbl, op,
   old, new)`, under the label of the step that made it (`rec_label`). These two tables are a public contract: your
   own queries may read them. Not caught: TRUNCATE, a sequence that moves without a row, DDL.
3. **Start.** `app.start` starts your built application on that database and returns its address. Write your
   servers' logs beside the run (`<logBase>.<name>.log`), never inside it: every file inside is hashed.
4. **Visits.** Every audience — and `none`, a browser with no session — opens every page, signing in just before its
   pass. Writes made while signing in fall under a `sign-in …` label and appear in no file. A page is read once the
   network is quiet, any "Loading" text has gone, and its text stops growing.
5. **Acts.** Every action is pressed as every audience, least reach first if you order them so: as the users it is
   not meant for, it records the refusal; as the one it is meant for, what it does.
6. **Visits again**, into `after/`, so each page shows what the acts wrote.
7. **Files.** One file per visit and per act: a head (address, audience, status, where it landed), the text or
   answer, and the rows written under its label. A page that shows a third party's live data can be compared by its
   **shape** alone — the tables and operations it wrote — with its full text kept beside it, unhashed.
8. **Masking, then hashes.** `hashes.txt` holds a SHA-256 per file; `compare` reads two of them.

## Configuration

`page-recorder.config.mjs` exports the configuration, or a function of the arguments after `--` returning it. If your
hooks are TypeScript, call `record` from your own entry under your own loader (`tsx`, say): Node's type stripping does
not resolve imports written without an extension.

An example for a Next.js application. Every name, port and variable in it is a placeholder for your own:

```js
import { freshFromTemplate } from '@ploutosservices/page-recorder'
import { execFileSync, spawn } from 'node:child_process'

const asAdmin = args => execFileSync('sudo', ['-n', '-u', 'postgres', ...args]).toString()   // however you reach a Postgres administrator
const TREE = process.env.TREE                       // the built version under test
const urlOf = db => { const u = new URL(process.env.DATABASE_URL); u.pathname = `/${db}`; return u.toString() }

export default {
  database: {
    fresh: () => { freshFromTemplate({ template: 'app_tpl', instance: 'app_rec', owner: 'app', asAdmin }); return urlOf('app_rec') },
    prepare: url => execFileSync('npm', ['run', 'migrate'], { cwd: TREE, env: { ...process.env, DATABASE_URL: url } }),
  },
  app: {
    commit: () => execFileSync('git', ['-C', TREE, 'rev-parse', 'HEAD']).toString().trim(),
    start: async ({ databaseUrl }) => {
      const child = spawn('npx', ['next', 'start', '-p', '4100'], { cwd: TREE, env: { ...process.env, DATABASE_URL: databaseUrl } })
      await new Promise(r => setTimeout(r, 5000))     // better: wait for the server's ready line
      return { baseUrl: 'http://localhost:4100', stop: () => child.kill() }
    },
  },
  browser: { contextOptions: { locale: 'en-US', timezoneId: 'UTC' } },
  audiences: [
    { name: 'admin', signIn: async ({ newContext, baseUrl }) => { /* sign in, return the context */ } },
    { name: 'member', signIn: async ({ newContext, baseUrl }) => { /* … */ } },
  ],
  pages: [
    { address: '/projects', fill: async () => ({ path: '/projects' }) },
    { address: '/projects/{id}', fill: async ({ db }) => {
        const r = await db.query('select id from projects order by id limit 1')
        return r.rows[0] ? { path: `/projects/${r.rows[0].id}` } : { not: 'no project on the copy' }
      } },
  ],
  acts: [],
  header: run => `audiences:\n${run.audiences.map(a => `  ${a.name}: ${a.signedIn}`).join('\n')}\n`,
}
```

Keys:

Required: `database.fresh`, `app.start`, `app.commit`, `audiences`, `pages`, `header`.

- `database`: `fresh`, `prepare`, `setup(db)`, `stamp()` (names the copy, for the header).
- `capture`: `schema` (default `public`), `ignore` (an SQL condition on `rec_rows` that leaves a write out of every
  file, such as a session's last-seen stamp).
- `app`: `start({ databaseUrl, logBase })` → `{ baseUrl, stop }`, `commit()`.
- `teardown()`: runs last, whatever happened.
- `browser`: `engine` (default `firefox`), `contextOptions` for every context, `none`'s included. Fix the locale and
  time zone here: they change the page text, and `clock` must name the same ones.
- `audiences`: `{ name, signIn({ browser, newContext, baseUrl, db, label, phase }) }` → a signed-in context, or a
  string saying why not. Any other field is yours and reaches the header.
- `pages`: `{ address, fill({ audience, db }) }` → `{ path, other? }` (`other`: it borrowed another user's rows) or
  `{ not: reason }`. Choose rows by a query that answers the same on the same copy (lowest id, say).
- `acts`: `{ name, key, address, press(x) }`: `name` the file under `acts/<audience>/` (ending in `.txt`), `key` what `shape` and the
  notes call it, `address` where it is posted. `press({ context, baseUrl, audience, db, label, begin, note })` →
  `{ head, answer }` (all the head lines, and the answer as text) or `{ not: true }`. Call `begin()` once the act will
  act, after your own skip checks and before its first write: it opens the act's label. Its rows are read after the
  audience's last act, so a write that lands just after the act returns is still the act's, until the next act calls
  `begin()`. An act that never calls `begin()` writes under the previous act's label. Names are unique, end in `.txt`
  and never in `.full.txt`. `note.notExercised`, `note.borrowed` and
  `note.keptByText` feed the header.
- `actOrder`: the audiences' order for the acts (default `none`, then as listed).
- `shape(address, key)`: true for a page or act compared by its shape.
- `mask`: `strings()` → `[{ value, as }]` (replaced wherever found, without case), `minted` (`[{ table, column }]`:
  random keys; every value such a column held becomes `<minted>` where it stands as a whole token, not inside a longer
  run of letters, digits, `_` and `-`), `text` (`[pattern, replacement]` pairs, in order).
- `clock`: `zones` (default `['UTC']`: the zones your pages print dates and times in), `locale` (default `en-US`);
  the same as `browser.contextOptions`' time zone and locale.
- `visit`: `loadingPattern` (default `/Loading[ .…]/`), `headWord` (the first word of a visit's head, default
  `page`).
- `pdf`: true to check for `pdftotext` at the start.
- `header(run)` → the text of `header.yaml` (hashed); `extraFiles(run)` → `{ name: text }` written unhashed.

### Masking, in order

An act's answer is trimmed and its durations (`6.6s`, `250 ms`) become `<duration>`. Then every file: your
`mask.strings`; minted keys → `<minted>`; an id the run inserted (a UUID in a captured insert's `id`) → `<new-n>`,
numbered per file by first appearance; a timestamp from one minute before the run's start onward → `<now>`; your
`mask.text` rules; each date the run spanned, in each zone, as ISO and in the locale's long, medium, short and numeric
forms → `<today>`; `<today>` followed by a time → `<now>`; a time of day inside the run's window, unless it is one end
of a range or printed with its own date → `<now>`.

### What it cannot hold still for you

A page that reads the wall clock answers differently on another day. A weekly job that falls due between two runs, a
greeting by the hour, a "last refreshed" that triggers a live read of a third party: the package masks what it
recognises, and the rest is yours to hold still — fix the time a job last ran in `setup`, say, or compare that page
by its shape. When two runs differ where no code changed, look first for a read of the clock.

## Next.js helpers

- `nextActionIds(tree)`: `file#export` → this build's server action id, from `.next/server/server-reference-manifest.json`.
- `postServerAction({ tree, context, baseUrl, path, id, args })` posts an action as its page does, encoding the
  arguments with the build's own React, and returns `{ status, redirect, answer }` with the answer's flight rows
  decoded into JSON — or `{ error }`.
- `answerText(buffer, type, { onPdf })` keeps a route handler's answer: text types as text, a PDF by its text, another
  file by its hash, an empty body said so.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
