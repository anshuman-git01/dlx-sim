/* Node test harness.
 * 1. Assembles and runs every example with forwarding ON and OFF and
 *    verifies the expected results.
 * 2. Round-trips the checks through @expect comment directives
 *    (checksToDirectives -> parseExpects) to prove the generalized
 *    Tests-tab path gives identical results. */
'use strict';
const DLX = require('../dlx.js');
const EXAMPLES = require('../examples.js');

let pass = 0, fail = 0;

for (const ex of EXAMPLES) {
  // round-trip checks through the @expect directive syntax
  const directives = DLX.checksToDirectives(ex.checks).join('\n');
  const src = ex.code + '\n' + directives + '\n';
  const parsed = DLX.parseExpects(src);
  if (parsed.errors.length || parsed.checks.length !== ex.checks.length) {
    fail++;
    console.log(`✗ ${ex.id}: @expect round-trip failed`);
    for (const e of parsed.errors) console.log(`    line ${e.line}: ${e.msg}`);
    if (parsed.checks.length !== ex.checks.length)
      console.log(`    parsed ${parsed.checks.length} of ${ex.checks.length} checks`);
    continue;
  }

  const prog = DLX.assemble(src);
  if (!prog.ok) {
    fail++;
    console.log(`✗ ${ex.id}: ASSEMBLY ERRORS`);
    for (const e of prog.errors) console.log(`    line ${e.line}: ${e.msg}`);
    continue;
  }
  for (const fwd of [true, false]) {
    const sim = new DLX.Sim(prog, { forwarding: fwd });
    sim.run(2000000);
    const label = `${ex.id} (fwd=${fwd ? 'on' : 'off'})`;
    if (!sim.halted || sim.runtimeError) {
      fail++;
      console.log(`✗ ${label}: ${sim.runtimeError || 'did not halt (max cycles)'} — cycles=${sim.cycle}`);
      continue;
    }
    const results = DLX.evalChecks(sim, prog, parsed.checks);
    const bad = results.filter((r) => !r.pass);
    if (bad.length) {
      fail++;
      console.log(`✗ ${label}:`);
      for (const b of bad) console.log(`    ${b.desc}: expected ${JSON.stringify(b.expected)}, got ${JSON.stringify(b.actual)}`);
    } else {
      pass++;
      console.log(`✓ ${label}  cycles=${sim.cycle} instrs=${sim.stats.instrs} CPI=${(sim.cycle / sim.stats.instrs).toFixed(2)} stalls=${sim.stats.stalls} fwd=${sim.stats.forwards} flush=${sim.stats.flushes}`);
    }
  }
}

/* ---- assembler micro-tests (directive/label edge cases) ---- */
const MICRO = [];
MICRO.push({
  name: 'label on its own line + one .word per line',
  src: `
.data
arr:
.word 5
.word 7
.word 10

.text
LW R1,arr(R0)
TRAP 0
; @expect reg R1 = 5
; @expect word arr[1] = 7
; @expect word arr[2] = 10
`,
});
MICRO.push({
  name: 'label-only line binds AFTER .word alignment (odd address)',
  src: `
.data
s: .asciiz "AB"
v:
.word 77

.text
LW R1, v(R0)
TRAP 0
; @expect reg R1 = 77
; @expect word v = 77
`,
});
MICRO.push({
  name: '.word inside .text segment (default segment)',
  src: `
.text
main: LW R1, tdata(R0)
      LH R2, thalf(R0)
      TRAP 0
tdata: .word 42
thalf: .half -7
; @expect reg R1 = 42
; @expect reg R2 = -7
`,
});
MICRO.push({
  name: '.word with no .data/.text header at all',
  src: `
start: ADDI R3, R0, cell
       LW R1, 0(R3)
       TRAP 0
cell:  .word 1234
; @expect reg R1 = 1234
`,
});

for (const t of MICRO) {
  const parsed = DLX.parseExpects(t.src);
  const prog = DLX.assemble(t.src);
  let ok = prog.ok && !parsed.errors.length;
  let detail = prog.ok ? '' : prog.errors.map((e) => 'line ' + e.line + ': ' + e.msg).join('; ');
  if (ok) {
    const sim = new DLX.Sim(prog, { forwarding: true });
    sim.run(10000);
    if (!sim.halted || sim.runtimeError) { ok = false; detail = sim.runtimeError || 'did not halt'; }
    else {
      const bad = DLX.evalChecks(sim, prog, parsed.checks).filter((r) => !r.pass);
      if (bad.length) { ok = false; detail = bad.map((b) => b.desc + ': expected ' + JSON.stringify(b.expected) + ', got ' + JSON.stringify(b.actual)).join('; '); }
    }
  }
  if (ok) { pass++; console.log('✓ micro: ' + t.name); }
  else { fail++; console.log('✗ micro: ' + t.name + ' — ' + detail); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
