// ONE RUN: a fresh database, the row capture, the application started, every page visited as every audience, every
// act pressed as every audience, every page visited again, and the run written as one masked file per visit and act,
// a header, and hashes.txt.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { installCapture, setLabel, rowsOf, shapeOf, insertedIds, columnValues } from './capture.mjs'
import { mask, maskDurations } from './mask.mjs'
import { needPdftotext } from './answer.mjs'
import { writeHashes, COMMIT, FULL } from './hashes.mjs'

const fullName = name => name.replace(/\.txt$/, FULL)
const fileOf = address => address.replace(/[^a-zA-Z0-9]+/g, '_')
const unique = list => [...new Set(list)]

/** The run's facts an audience carries into the header: its own fields (no functions), and how its sign-ins went. */
const factsOf = (a, s) => ({
  ...Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v !== 'function')),
  signedIn: s.signedIn, ...(s.why ? { why: s.why } : {}),
})

/**
 * @param {{ config: import('../index').RecorderConfig, out: string }} o
 * @returns {Promise<{ files: number }>}
 */
export async function record({ config, out }) {
  const c = config
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`)
  for (const k of ['database', 'app', 'audiences', 'pages', 'header']) if (!c[k]) throw new Error(`the configuration has no ${k}`)
  // A shaped act's full text sits beside it as <name>.full.txt: a name not ending in .txt would be overwritten by it.
  // A .full.txt file is never hashed, and two acts of one name would overwrite each other.
  const names = new Set()
  for (const a of c.acts ?? []) {
    if (!/\.txt$/.test(a.name) || a.name.endsWith(FULL)) throw new Error(`act ${a.key}: its name ${a.name} must end in .txt, not ${FULL}`)
    if (names.has(a.name)) throw new Error(`two acts are named ${a.name}`)
    names.add(a.name)
  }
  if (c.pdf) needPdftotext()
  mkdirSync(out, { recursive: true })
  const { default: pg } = await import('pg')
  const { [c.browser?.engine ?? 'firefox']: engine } = await import('playwright-core')
  if (!engine) throw new Error(`playwright-core has no browser engine ${c.browser?.engine}`)

  const commit = await c.app.commit()
  const databaseUrl = await c.database.fresh()
  await c.database.prepare?.(databaseUrl)
  const db = new pg.Client({ connectionString: databaseUrl })
  await db.connect()
  const schema = c.capture?.schema ?? 'public'
  const label = l => setLabel(db, l, schema)
  const ignore = c.capture?.ignore
  const raw = new Map()
  const notes = { notExercised: [], borrowed: [], keptByText: [] }
  const note = {
    notExercised: s => notes.notExercised.push(s),
    borrowed: s => notes.borrowed.push(s),
    keptByText: s => notes.keptByText.push(s),
  }
  const shaped = new Set()
  const shape = (address, key) => !!c.shape?.(address, key)
  const headWord = c.visit?.headWord ?? 'page'
  const state = new Map(c.audiences.map(a => [a.name, { signedIn: false, why: undefined }]))
  let app = null, browser = null, since = null
  try {
    await c.database.setup?.(db)
    await installCapture(db, schema)
    since = new Date()
    app = await c.app.start({ databaseUrl, logBase: out.replace(/\/$/, '') })
    const { baseUrl } = app
    const host = new URL(baseUrl).host
    browser = await engine.launch()
    const newContext = (opts = {}) => browser.newContext({ ...(c.browser?.contextOptions ?? {}), ...opts })

    // Each audience signs in just before each of its passes; `none` is a fresh context with no session.
    const session = async (name, phase) => {
      if (name === 'none') return { context: await newContext(), audience: { name: 'none' } }
      const audience = c.audiences.find(a => a.name === name)
      if (!audience) throw new Error(`actOrder names ${name}, which is not an audience`)
      const st = state.get(name)
      await label(`sign-in ${phase} ${name}`)
      const got = await audience.signIn({ browser, newContext, baseUrl, db, label, phase })
      if (!got || typeof got === 'string') { st.why = got || 'the sign-in returned nothing'; return null }
      st.signedIn = true
      return { context: got, audience }
    }

    const visitPass = async phase => {
      for (const name of ['none', ...c.audiences.map(a => a.name)]) {
        const s = await session(name, phase)
        if (!s) continue
        const p = await s.context.newPage()
        for (const [i, page] of c.pages.entries()) {
          const file = `${phase}/${name}/${String(i).padStart(3, '0')}${fileOf(page.address)}.txt`
          const f = await page.fill({ audience: s.audience, db })
          if ('not' in f) { if (name === 'none' && phase === 'visits') note.notExercised(`${page.address}: ${f.not}`); continue }
          if (f.other && name !== 'none') note.borrowed(`${phase} ${page.address} as ${name}`)
          const l = `${phase} ${name} ${page.address}`
          await label(l)
          const started = Date.now()
          const res = await p.goto(baseUrl + f.path, { waitUntil: 'load', timeout: 120000 }).catch(e => e)
          // The application's own pages are read once the network is quiet; a sign-in page on another host may never
          // go quiet, so a visit that lands there is read at load.
          if (!(res instanceof Error) && new URL(p.url()).host === host) {
            await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
            const loading = c.visit?.loadingPattern ?? /Loading[ .…]/
            await p.waitForFunction(src => !new RegExp(src).test(document.body.innerText), loading.source, { timeout: 60000 }).catch(() => {})
            // A long table draws after the network is quiet: read when two reads a second apart are the same length.
            let last = -1
            for (let k = 0; k < 60; k++) {
              const n = await p.evaluate(() => document.body.innerText.length).catch(() => -2)
              if (n === last) break
              last = n
              await p.waitForTimeout(1000)
            }
          }
          console.error(`${name} ${i + 1}/${c.pages.length} ${page.address} ${Date.now() - started} ms`)
          const status = res instanceof Error ? `error ${res.message.split('\n')[0]}` : String(res?.status() ?? 'none')
          const landed = new URL(p.url())
          const text = res instanceof Error ? '' : await p.innerText('body').catch(() => '')
          const head = [`${headWord} ${page.address}`, `as ${name}`, `status ${status}`,
            `landed ${landed.host === host ? `${landed.pathname}${landed.search}` : `${landed.host}${landed.pathname} (its query is per request)`}`]
          const whole = [...head, '', '--- text', text.trim(), '', '--- rows', await rowsOf(db, l, ignore, schema), ''].join('\n')
          if (shape(page.address)) {
            shaped.add(page.address)
            raw.set(file, [...head, '', '--- shape', await shapeOf(db, l, ignore, schema), ''].join('\n'))
            raw.set(fullName(file), whole)
          } else raw.set(file, whole)
        }
        await p.close()
        await s.context.close()
      }
    }

    await visitPass('visits')
    for (const name of c.actOrder ?? ['none', ...c.audiences.map(a => a.name)]) {
      if (!c.acts?.length) break
      const s = await session(name, 'acts')
      if (!s) continue
      // An act opens its own label with begin(), once it knows it will act (after its own skip checks), so a skipped
      // act moves no label. The rows are read after the audience's last act: a write that lands just after an act
      // returns (a trailing promise, a second service) still falls under that act's label.
      const done = []
      for (const act of c.acts) {
        const l = `act ${name} ${act.key}`
        const r = await act.press({ context: s.context, baseUrl, audience: s.audience, db, label, begin: () => label(l), note })
        if (!r || r.not) continue
        done.push({ act, l, r })
      }
      for (const { act, l, r } of done) {
        const file = `acts/${name}/${act.name}`
        const whole = [...r.head, '', '--- answer', maskDurations(String(r.answer ?? '').trim()), '', '--- rows', await rowsOf(db, l, ignore, schema), ''].join('\n')
        if (shape(act.address, act.key)) {
          shaped.add(act.address)
          raw.set(file, [...r.head, '', '--- shape', await shapeOf(db, l, ignore, schema), ''].join('\n'))
          raw.set(fullName(file), whole)
        } else raw.set(file, whole)
      }
      await s.context.close()
    }
    await visitPass('after')
  } finally {
    await browser?.close().catch(() => {})
    await app?.stop?.()
    await c.teardown?.()
  }

  const inserted = await insertedIds(db, schema)
  const minted = c.mask?.minted?.length ? await columnValues(db, c.mask.minted, schema) : new Set()
  const strings = (await c.mask?.strings?.()) ?? []
  await db.end()
  const masking = { since, strings, minted, inserted, text: c.mask?.text ?? [], zones: c.clock?.zones, locale: c.clock?.locale }
  for (const [name, text] of raw) {
    mkdirSync(dirname(join(out, name)), { recursive: true })
    writeFileSync(join(out, name), mask(text, masking))
  }
  const run = {
    audiences: c.audiences.map(a => factsOf(a, state.get(a.name))),
    notExercised: unique(notes.notExercised),
    borrowed: unique(notes.borrowed),
    keptByText: unique(notes.keptByText),
    shaped: [...shaped].sort(),
    stamp: await c.database.stamp?.(),
    commit,
  }
  writeFileSync(join(out, 'header.yaml'), await c.header(run))
  writeFileSync(join(out, COMMIT), `${commit}\n`)
  const extra = (await c.extraFiles?.(run)) ?? {}
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(out, name), text)
  writeHashes(out, Object.keys(extra))
  console.log(`recorded ${raw.size} files into ${out}`)
  return { files: raw.size }
}
