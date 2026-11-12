// AN ANSWER AS TEXT: what a response body becomes in a run's file.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** A PDF's text as a reader sees it (poppler's pdftotext -layout), never its bytes: a PDF library stamps its creation
 *  time into a compressed stream, so the bytes differ every run while the text does not. */
export function pdfText(buf) {
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: buf, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
}

/** Throws, naming the package to install, when pdftotext is not on the path. */
export function needPdftotext() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }) }
  catch { throw new Error('pdftotext is not on the path: install poppler (Debian and Ubuntu: poppler-utils)') }
}

/**
 * A response body as the run keeps it: a text type as UTF-8, a PDF by its text, any other file by its SHA-256, an
 * empty body said so. `onPdf` is called when a PDF is kept by its text (a change its text does not show is not seen).
 * @param {Buffer} buf
 * @param {string} type the content type
 * @param {{ onPdf?: () => void }} [opts]
 */
export function answerText(buf, type, { onPdf } = {}) {
  if (/json|text|xml|javascript/.test(type)) return buf.toString('utf8')
  if (/application\/pdf/.test(type)) { onPdf?.(); return pdfText(buf) }
  return buf.length ? `(a ${type} file, sha256 ${createHash('sha256').update(buf).digest('hex')})` : '(no body)'
}
