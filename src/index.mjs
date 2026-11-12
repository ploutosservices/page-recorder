// page-recorder: record what every kind of user sees and writes in a web application, and compare two versions.
export { record } from './record.mjs'
export { compare, writeHashes, HASHES, COMMIT, FULL } from './hashes.mjs'
export { mask, maskDurations } from './mask.mjs'
export { captureSql, installCapture, setLabel, rowsOf, shapeOf, insertedIds, columnValues } from './capture.mjs'
export { freshFromTemplate, templateComment } from './postgres.mjs'
export { answerText, pdfText, needPdftotext } from './answer.mjs'
export { nextActionIds, actionAnswer, postServerAction } from './next.mjs'
