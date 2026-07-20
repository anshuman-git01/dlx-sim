/* ============================================================
 * DLX-Sim — comprehensive test runner.
 *
 * Executes every test in spec.js against the REAL assembler and
 * pipeline simulator. Nothing here is hand-computed: cycle counts,
 * register/memory values, stall causes, forwards and flushes are
 * all captured live from the simulator and written into a full
 * Markdown report (REPORT.md) plus a compact console summary.
 *
 * Usage: node test/comprehensive/run.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const DLX = require('../../dlx.js');
const SPEC = require('./spec.js');

const PREFIX = {
  Assembler: 'ASM', Instruction: 'INS', Memory: 'MEM', Pipeline: 'PIPE',
  'Control Flow': 'CTRL', Algorithm: 'ALGO', Exception: 'EXC',
  Performance: 'PERF', Stress: 'STRESS',
};
const counters = {};
for (const t of SPEC) {
  const p = PREFIX[t.category] || 'GEN';
  counters[p] = (counters[p] || 0) + 1;
  t.id = p + '-' + String(counters[p]).padStart(2, '0');
}

function pipelineTable(sim) {
  const rows = sim.records.filter((r) => r.cells && r.cells.length);
  const maxCycle = sim.cycle;
  const nameW = Math.min(34, Math.max(10, ...rows.map((r) => r.asm.length)));
  let header = ' '.repeat(nameW + 2) + 'cycle: ' + Array.from({ length: maxCycle }, (_, i) => i + 1).join('  ');
  const lines = [header];
  for (const r of rows) {
    const at = {};
    for (const [c, s] of r.cells) at[c] = s;
    let line = (r.asm.length > nameW ? r.asm.slice(0, nameW - 1) + '…' : r.asm).padEnd(nameW) + '  ' + ' '.repeat(7);
    for (let c = 1; c <= maxCycle; c++) {
      const s = at[c] || '';
      line += (s ? s : '.').padEnd(s.length > 4 ? s.length + 2 : 5);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function stallExplanations(sim) {
  return sim.log.filter((l) => l.kind === 'stall').map((l) => 'cycle ' + l.c + ': ' + l.msg);
}
function forwardLog(sim) {
  return sim.log.filter((l) => l.kind === 'forward').map((l) => 'cycle ' + l.c + ': ' + l.msg);
}
function flushLog(sim) {
  return sim.log.filter((l) => l.kind === 'flush').map((l) => 'cycle ' + l.c + ': ' + l.msg);
}

function runOne(t) {
  const r = { id: t.id, category: t.category, name: t.name, purpose: t.purpose, notes: t.notes, code: t.code.trim(), ok: false };

  if (t.expectError) {
    const prog = DLX.assemble(t.code);
    if (t.expectError.phase === 'assemble') {
      r.expected = 'ERROR at assembly time matching ' + t.expectError.match;
      if (prog.ok) { r.actual = 'assembled successfully (no error)'; r.ok = false; }
      else {
        const msgs = prog.errors.map((e) => e.msg);
        r.actual = 'assembly errors: ' + msgs.join(' | ');
        r.ok = msgs.some((m) => t.expectError.match.test(m));
      }
      return r;
    }
    if (!prog.ok) { r.expected = 'runtime ERROR matching ' + t.expectError.match; r.actual = 'ASSEMBLY FAILED unexpectedly: ' + prog.errors.map((e) => e.msg).join(' | '); r.ok = false; return r; }
    const sim = new DLX.Sim(prog, { forwarding: true });
    const halted = sim.run(t.maxCycles || 200000);
    if (t.expectError.phase === 'nohalt') {
      r.expected = 'does NOT halt within ' + (t.maxCycles || 50000) + ' cycles (cycle governor catches it)';
      r.actual = halted ? 'halted at cycle ' + sim.cycle + (sim.runtimeError ? ' with error: ' + sim.runtimeError : '') : 'did not halt — governor engaged as expected';
      r.ok = halted === false;
      return r;
    }
    r.expected = 'runtime ERROR matching ' + t.expectError.match;
    r.actual = sim.runtimeError ? sim.runtimeError : (halted ? 'halted normally with NO error' : 'did not halt within cycle cap');
    r.ok = !!(sim.runtimeError && t.expectError.match.test(sim.runtimeError));
    r.cycles = sim.cycle;
    return r;
  }

  const parsed = DLX.parseExpects(t.code);
  if (parsed.errors.length) { r.actual = '@expect PARSE ERROR (spec bug): ' + parsed.errors.map((e) => e.msg).join(' | '); return r; }

  const runConfig = (fwd) => {
    const prog = DLX.assemble(t.code);
    if (!prog.ok) return { assembleFail: prog.errors.map((e) => e.msg).join(' | ') };
    const sim = new DLX.Sim(prog, { forwarding: fwd });
    const halted = sim.run(t.maxCycles || 200000);
    return { prog, sim, halted };
  };

  const fwdModes = t.forwarding === 'both' ? [true, false] : [t.forwarding !== false];
  const runs = fwdModes.map(runConfig);

  if (runs[0].assembleFail) { r.actual = 'ASSEMBLY FAILED: ' + runs[0].assembleFail; return r; }
  for (const run of runs) {
    if (!run.halted || run.sim.runtimeError) {
      r.actual = run.sim.runtimeError ? 'RUNTIME ERROR: ' + run.sim.runtimeError : 'did not halt within cycle cap';
      return r;
    }
  }

  const primary = runs[0];
  const checkResults = DLX.evalChecks(primary.sim, primary.prog, parsed.checks);
  const badChecks = checkResults.filter((c) => !c.pass);
  r.checks = checkResults;
  r.stats = primary.sim.stats;
  r.cycles = primary.sim.stats.cycles;

  if (t.diagram) {
    r.diagram = pipelineTable(primary.sim);
    r.stallLog = stallExplanations(primary.sim);
    r.forwardLog = forwardLog(primary.sim);
    r.flushLog = flushLog(primary.sim);
  }
  if (t.performance) {
    r.perf = {
      cycles: primary.sim.stats.cycles, instrs: primary.sim.stats.instrs,
      cpi: primary.sim.stats.instrs ? (primary.sim.stats.cycles / primary.sim.stats.instrs) : 0,
      stalls: primary.sim.stats.stalls, stallCauses: primary.sim.stats.stallCauses,
      forwards: primary.sim.stats.forwards, flushes: primary.sim.stats.flushes,
      memReads: primary.sim.stats.memReads, memWrites: primary.sim.stats.memWrites,
      branches: primary.sim.stats.branches, branchesTaken: primary.sim.stats.branchesTaken,
      jumps: primary.sim.stats.jumps,
    };
  }

  let ok = badChecks.length === 0;
  let detail = badChecks.map((c) => c.desc + ': expected ' + JSON.stringify(c.expected) + ', got ' + JSON.stringify(c.actual)).join(' | ');

  if (t.forwarding === 'both') {
    const [on, off] = runs;
    r.compare = { onCycles: on.sim.cycle, offCycles: off.sim.cycle, onStalls: on.sim.stats.stalls, offStalls: off.sim.stats.stalls };
    const regsMatch = Array.from({ length: 32 }, (_, i) => i).every((i) => on.sim.regs[i] === off.sim.regs[i]);
    const fasterWithFwd = on.sim.cycle < off.sim.cycle;
    if (!regsMatch) { ok = false; detail += (detail ? ' | ' : '') + 'forwarding ON/OFF produced DIFFERENT final register state (correctness bug)'; }
    if (!fasterWithFwd) { ok = false; detail += (detail ? ' | ' : '') + 'forwarding ON was not faster than OFF (' + on.sim.cycle + ' vs ' + off.sim.cycle + ' cycles)'; }
  }

  r.expected = parsed.checks.length ? parsed.checks.map((c) => describeCheck(c)).join('; ') : '(no @expect — pipeline/behavioral test)';
  r.actual = ok ? 'all checks passed' : detail;
  r.ok = ok;
  return r;
}

function describeCheck(c) {
  switch (c.kind) {
    case 'reg': return 'R' + c.reg + ' = ' + c.value;
    case 'memw': return 'word ' + c.label + (c.index ? '[' + c.index + ']' : '') + ' = ' + c.value;
    case 'memh': return 'half ' + c.label + (c.index ? '[' + c.index + ']' : '') + ' = ' + c.value;
    case 'memb': return 'byte ' + c.label + (c.index ? '[' + c.index + ']' : '') + ' = ' + c.value;
    case 'mems': return 'string ' + c.label + ' = "' + c.value + '"';
    case 'out': return 'output contains "' + c.includes + '"';
    default: return '?';
  }
}

/* ------------------------------- run all ------------------------------- */
const results = SPEC.map(runOne);

/* ------------------------------- report --------------------------------- */
let md = '# DLX-Sim comprehensive test report\n\n';
md += 'Generated by `test/comprehensive/run.js`. Every value below (registers, memory, cycles, ';
md += 'stalls, forwards, flushes, pipeline timelines) is captured live from the real simulator — ';
md += 'nothing in this report is hand-typed.\n\n';

const byCat = {};
for (const r of results) (byCat[r.category] = byCat[r.category] || []).push(r);

md += '## Summary\n\n| Category | Pass | Fail | Total |\n|---|---|---|---|\n';
let totalPass = 0, totalFail = 0;
for (const cat of Object.keys(byCat)) {
  const rs = byCat[cat];
  const pass = rs.filter((r) => r.ok).length;
  const fail = rs.length - pass;
  totalPass += pass; totalFail += fail;
  md += `| ${cat} | ${pass} | ${fail} | ${rs.length} |\n`;
}
md += `| **TOTAL** | **${totalPass}** | **${totalFail}** | **${results.length}** |\n\n`;

for (const cat of Object.keys(byCat)) {
  md += `## ${cat}\n\n`;
  for (const r of byCat[cat]) {
    md += `### ${r.id} — ${r.name} ${r.ok ? '✅ PASS' : '❌ FAIL'}\n\n`;
    md += `**Purpose:** ${r.purpose}\n\n`;
    md += '**DLX Assembly:**\n```asm\n' + r.code + '\n```\n\n';
    md += `**Expected result:** ${r.expected}\n\n`;
    md += `**Actual result:** ${r.actual}\n\n`;
    if (r.cycles !== undefined) md += `**Cycle count:** ${r.cycles}\n\n`;
    if (r.stats) {
      md += `**Stalls:** ${r.stats.stalls} (load-use ${r.stats.stallCauses.loadUse}, branch ${r.stats.stallCauses.branchWait}, RAW-no-forwarding ${r.stats.stallCauses.rawNoFwd})\n\n`;
      md += `**Forwards:** ${r.stats.forwards}   **Flushes:** ${r.stats.flushes}   **Mem reads/writes:** ${r.stats.memReads}/${r.stats.memWrites}   **Branches (taken):** ${r.stats.branches} (${r.stats.branchesTaken})   **Jumps:** ${r.stats.jumps}\n\n`;
    }
    if (r.perf) {
      md += '**Performance report:**\n\n';
      md += '| metric | value |\n|---|---|\n';
      md += `| instructions | ${r.perf.instrs} |\n| cycles | ${r.perf.cycles} |\n| CPI | ${r.perf.cpi.toFixed(3)} |\n`;
      md += `| stalls | ${r.perf.stalls} (load-use ${r.perf.stallCauses.loadUse}, branch ${r.perf.stallCauses.branchWait}, RAW ${r.perf.stallCauses.rawNoFwd}) |\n`;
      md += `| forwarded values | ${r.perf.forwards} |\n| flushes | ${r.perf.flushes} |\n`;
      md += `| memory reads | ${r.perf.memReads} |\n| memory writes | ${r.perf.memWrites} |\n`;
      md += `| branches (taken) | ${r.perf.branches} (${r.perf.branchesTaken}) |\n| jumps | ${r.perf.jumps} |\n\n`;
    }
    if (r.compare) {
      md += `**Forwarding ON vs OFF:** ${r.compare.onCycles} cycles / ${r.compare.onStalls} stalls (ON) vs ${r.compare.offCycles} cycles / ${r.compare.offStalls} stalls (OFF)\n\n`;
    }
    if (r.diagram) {
      md += '**Pipeline timeline (real, captured per-cycle):**\n```\n' + r.diagram + '\n```\n\n';
      if (r.stallLog.length) md += '**Why each stall occurred:**\n' + r.stallLog.map((s) => '- ' + s).join('\n') + '\n\n';
      if (r.forwardLog.length) md += '**Forwards that occurred:**\n' + r.forwardLog.slice(0, 12).map((s) => '- ' + s).join('\n') + '\n\n';
      if (r.flushLog.length) md += '**Flushes that occurred:**\n' + r.flushLog.map((s) => '- ' + s).join('\n') + '\n\n';
    }
    md += `**What a failure here would expose:** ${r.notes || '(see purpose)'}\n\n`;
    md += '---\n\n';
  }
}

const outPath = path.join(__dirname, 'REPORT.md');
fs.writeFileSync(outPath, md);

/* ------------------------------- console -------------------------------- */
console.log('DLX-Sim comprehensive test suite\n');
for (const cat of Object.keys(byCat)) {
  const rs = byCat[cat];
  const pass = rs.filter((r) => r.ok).length;
  console.log(`${cat.padEnd(14)} ${pass}/${rs.length} passed`);
}
console.log(`\nTOTAL: ${totalPass}/${results.length} passed`);
if (totalFail) {
  console.log('\nFAILURES:');
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id} ${r.name}\n      expected: ${r.expected}\n      actual:   ${r.actual}`);
}
console.log('\nFull report written to test/comprehensive/REPORT.md (' + (md.length / 1024).toFixed(0) + ' KB)');
process.exit(totalFail ? 1 : 0);
