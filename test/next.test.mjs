import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actionAnswer, nextActionIds } from '../src/next.mjs'
import { answerText } from '../src/answer.mjs'

let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'page-recorder-next-'))
  mkdirSync(join(dir, '.next/server'), { recursive: true })
  writeFileSync(join(dir, '.next/server/server-reference-manifest.json'), JSON.stringify({
    node: { '7f00aa': { filename: 'src/app/x/actions.ts', exportedName: 'save' }, '7f00bb': { filename: 'src/app/x/actions.ts', exportedName: 'drop' } },
  }))
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('the build\'s action ids by file#export', () => {
  assert.deepEqual([...nextActionIds(dir)], [['src/app/x/actions.ts#save', '7f00aa'], ['src/app/x/actions.ts#drop', '7f00bb']])
})

test('an action\'s answer follows its flight references; a page render says so', () => {
  const body = ['0:{"a":"$@1","f":"","b":"x"}', '1:{"ok":true,"items":["$@2"]}', '2:{"id":7}'].join('\n')
  assert.equal(actionAnswer(body), JSON.stringify({ ok: true, items: [{ id: 7 }] }, null, 1))
  assert.equal(actionAnswer('0:["$","html",null,{}]'), '(no action answer: the response is a page render)')
  assert.equal(actionAnswer('0:{"a":"$@9"}'), '(the answer refers to a row the response does not hold)')
})

test('an answer\'s text: text types as text, another file by its hash, an empty body said so', () => {
  assert.equal(answerText(Buffer.from('{"a":1}'), 'application/json'), '{"a":1}')
  assert.match(answerText(Buffer.from([1, 2, 3]), 'image/png'), /^\(a image\/png file, sha256 [0-9a-f]{64}\)$/)
  assert.equal(answerText(Buffer.alloc(0), 'application/octet-stream'), '(no body)')
})
