import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeHashes, compare } from '../src/hashes.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'page-recorder.mjs')
let dir
const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text) }
before(() => { dir = mkdtempSync(join(tmpdir(), 'page-recorder-hashes-')) })
after(() => rmSync(dir, { recursive: true, force: true }))

test('hashes every file but itself, the commit, the full texts and the named extras, sorted by path', () => {
  for (const [f, t] of [['a/visits/x.txt', 'x'], ['a/visits/x.full.txt', 'full'], ['a/commit.txt', 'c'], ['a/note.txt', 'n'], ['a/header.yaml', 'h']]) put(f, t)
  writeHashes(join(dir, 'a'), ['note.txt'])
  const lines = readFileSync(join(dir, 'a/hashes.txt'), 'utf8').trim().split('\n')
  assert.deepEqual(lines.map(l => l.slice(66)), ['header.yaml', 'visits/x.txt'])
  assert.match(lines[0], /^[0-9a-f]{64} {2}header\.yaml$/)
})

test('compare names each differing file and how; the command exits 1 on a difference, 0 on none', () => {
  for (const [f, t] of [['b/visits/x.txt', 'x'], ['b/header.yaml', 'H'], ['b/acts/y.txt', 'y']]) put(f, t)
  writeHashes(join(dir, 'b'))
  assert.deepEqual(compare(join(dir, 'a'), join(dir, 'b')), [
    { file: 'acts/y.txt', how: 'only in b' },
    { file: 'header.yaml', how: 'differs' },
  ])
  const code = args => { try { execFileSync('node', [BIN, ...args], { stdio: 'pipe' }); return 0 } catch (e) { return e.status } }
  assert.equal(code(['compare', join(dir, 'a'), join(dir, 'b')]), 1)
  assert.equal(code(['compare', join(dir, 'a'), join(dir, 'a')]), 0)
  assert.equal(code(['compare', join(dir, 'a')]), 2)
  assert.equal(code(['record']), 2)
})
