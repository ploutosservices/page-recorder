// This package's own gate: no address in its source. The tests start servers and plant text on purpose and are
// excluded.
export default {
  addresses: {
    include: ['src', 'bin'],
    includeFiles: ['source-gates.config.mjs'],
  },
}
