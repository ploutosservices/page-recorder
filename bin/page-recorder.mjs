#!/usr/bin/env node
// page-recorder record --out <empty dir> [--config <file>] [-- <args for the configuration>]
// page-recorder compare <run a> <run b>
// Exit 0: recorded, or no file differs. 1: some files differ. 2: it cannot run.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { record } from '../src/record.mjs'
import { compare } from '../src/hashes.mjs'

const USAGE = 'usage: page-recorder record --out <empty dir> [--config <file>] [-- <args>] | page-recorder compare <run a> <run b>'

async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'compare') {
    if (rest.length !== 2) { console.error(USAGE); return 2 }
    const differ = compare(resolve(rest[0]), resolve(rest[1]))
    for (const d of differ) console.log(`${d.how}  ${d.file}`)
    return differ.length ? 1 : 0
  }
  if (command !== 'record') { console.error(USAGE); return 2 }
  const dash = rest.indexOf('--')
  const own = dash < 0 ? rest : rest.slice(0, dash)
  const args = dash < 0 ? [] : rest.slice(dash + 1)
  let out = null, file = 'page-recorder.config.mjs'
  for (let i = 0; i < own.length; i++) {
    if (own[i] === '--out' && own[i + 1]) out = own[++i]
    else if (own[i] === '--config' && own[i + 1]) file = own[++i]
    else { console.error(`unknown or incomplete argument: ${own[i]}\n${USAGE}`); return 2 }
  }
  if (!out) { console.error(USAGE); return 2 }
  const path = resolve(file)
  if (!existsSync(path)) { console.error(`no configuration at ${path}`); return 2 }
  const mod = await import(pathToFileURL(path).href)
  const config = typeof mod.default === 'function' ? await mod.default(args) : mod.default
  await record({ config, out: resolve(out) })
  return 0
}

main(process.argv.slice(2)).then(code => process.exit(code), e => {
  console.error(`page-recorder: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
})
