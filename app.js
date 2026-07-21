/* ================= DLX-Sim UI logic (workspace IDE) ================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let prog = null;          // assembled program
  let sim = null;           // simulator instance
  let simFile = null;       // file the current sim was assembled from
  let asmDirty = true;      // active source changed since last assemble
  let runTimer = null;
  let bpResumeSeq = -1;     // seq to skip after resuming from a breakpoint

  /* ========================== workspace ========================== */
  const WS_KEY = 'dlxsim.ws.v1';
  const STARTER = `        .text
main:   TRAP 0
`;

  let ws = null;
  function wsLoad() {
    try { ws = JSON.parse(localStorage.getItem(WS_KEY)); } catch (e) { ws = null; }
    if (!ws || !ws.files || !Object.keys(ws.files).length) {
      ws = { files: { 'main.s': STARTER }, open: ['main.s'], active: 'main.s', bps: {} };
    }
    if (!ws.bps) ws.bps = {};
    if (!ws.open.length || !ws.files[ws.active]) {
      ws.open = [Object.keys(ws.files)[0]];
      ws.active = ws.open[0];
    }
  }
  let saveT = null;
  function wsSave() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(WS_KEY, JSON.stringify(ws)); } catch (e) { /* quota */ }
    }, 250);
  }

  function uniqueName(base) {
    if (!/\.(s|asm|dlx|txt)$/i.test(base)) base += '.s';
    if (!ws.files[base]) return base;
    const m = /^(.*?)(\.[^.]+)$/.exec(base);
    for (let i = 2; ; i++) {
      const cand = m[1] + '-' + i + m[2];
      if (!ws.files[cand]) return cand;
    }
  }

  function openFile(name) {
    if (!ws.files[name]) return;
    if (!ws.open.includes(name)) ws.open.push(name);
    ws.active = name;
    asmDirty = true;
    srcEl.value = ws.files[name];
    wsSave();
    refreshExplorer();
    refreshEditor();
  }

  function createFile(name, content, open) {
    const n = uniqueName(name);
    ws.files[n] = content || '; ' + n + '\n\n        .text\nmain:   NOP\n        TRAP 0\n';
    wsSave();
    refreshExplorer();
    if (open !== false) openFile(n);
    return n;
  }

  function deleteFile(name) {
    if (!confirm('Delete "' + name + '" from the workspace?')) return;
    delete ws.files[name];
    delete ws.bps[name];
    ws.open = ws.open.filter((f) => f !== name);
    if (ws.active === name) {
      ws.active = ws.open[ws.open.length - 1] || Object.keys(ws.files)[0] || null;
      if (!ws.active) { ws.files['untitled.s'] = ''; ws.active = 'untitled.s'; ws.open = ['untitled.s']; }
      else if (!ws.open.includes(ws.active)) ws.open.push(ws.active);
      srcEl.value = ws.files[ws.active];
      asmDirty = true;
    }
    wsSave();
    refreshExplorer();
    refreshEditor();
  }

  function renameFile(name) {
    const to = prompt('Rename "' + name + '" to:', name);
    if (!to || to === name) return;
    const n = uniqueName(to);
    ws.files[n] = ws.files[name];
    if (ws.bps[name]) ws.bps[n] = ws.bps[name];
    delete ws.files[name];
    delete ws.bps[name];
    ws.open = ws.open.map((f) => (f === name ? n : f));
    if (ws.active === name) ws.active = n;
    if (simFile === name) simFile = n;
    wsSave();
    refreshExplorer();
  }

  function closeTab(name) {
    ws.open = ws.open.filter((f) => f !== name);
    if (ws.active === name) {
      ws.active = ws.open[ws.open.length - 1] || Object.keys(ws.files)[0];
      if (!ws.open.includes(ws.active)) ws.open.push(ws.active);
      srcEl.value = ws.files[ws.active];
      asmDirty = true;
      refreshEditor();
    }
    wsSave();
    refreshExplorer();
  }

  /* ------------------ explorer / tabs rendering ------------------ */
  function refreshExplorer() {
    const fl = $('fileList');
    fl.innerHTML = '';
    for (const name of Object.keys(ws.files).sort()) {
      const div = document.createElement('div');
      div.className = 'file-item' + (name === ws.active ? ' active' : '');
      div.innerHTML = '<span class="fi-ic">.s</span><span class="fi-name"></span><button class="fi-x" title="delete">✕</button>';
      div.querySelector('.fi-name').textContent = name;
      div.addEventListener('click', (e) => { if (e.target.className !== 'fi-x') openFile(name); });
      div.addEventListener('dblclick', (e) => { if (e.target.className !== 'fi-x') renameFile(name); });
      div.querySelector('.fi-x').addEventListener('click', () => deleteFile(name));
      fl.appendChild(div);
    }
    const tb = $('tabsBar');
    tb.innerHTML = '';
    for (const name of ws.open) {
      const t = document.createElement('div');
      t.className = 'tab' + (name === ws.active ? ' active' : '');
      t.innerHTML = '<span></span><button class="tab-x" title="close">✕</button>';
      t.querySelector('span').textContent = name;
      t.addEventListener('click', (e) => { if (e.target.className !== 'tab-x') openFile(name); });
      t.querySelector('.tab-x').addEventListener('click', () => closeTab(name));
      tb.appendChild(t);
    }
  }

  $('btnNewFile').addEventListener('click', () => {
    const name = prompt('New file name:', 'program.s');
    if (name) createFile(name, '');
  });
  $('btnImport').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (e) => {
    let last = null;
    for (const f of e.target.files) {
      const text = await f.text();
      last = createFile(f.name, text, false);
    }
    if (last) openFile(last);
    e.target.value = '';
  });

  /* ------------------------ examples menu ------------------------ */
  const exMenu = $('examplesMenu');
  exMenu.innerHTML = DLX_EXAMPLES.map((e, i) => '<button data-i="' + i + '">' + esc(e.name) + '</button>').join('');
  $('btnExamplesMenu').addEventListener('click', (e) => { e.stopPropagation(); exMenu.classList.toggle('hidden'); });
  document.addEventListener('click', () => exMenu.classList.add('hidden'));
  exMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const ex = DLX_EXAMPLES[parseInt(b.dataset.i, 10)];
    let code = ex.code;
    if (ex.checks && ex.checks.length && !/@expect/.test(code)) {
      code += '\n; ---- expected results (checked in the Tests tab) ----\n' + DLX.checksToDirectives(ex.checks).join('\n') + '\n';
    }
    const n = createFile(ex.id.toLowerCase() + '.s', code);
    term('added ' + n + ' — ' + ex.brief, 't-info');
    exMenu.classList.add('hidden');
  });

  /* ============================ views ============================ */
  const sideButtons = document.querySelectorAll('#side button');
  sideButtons.forEach((b) =>
    b.addEventListener('click', () => {
      sideButtons.forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      $('view-' + b.dataset.view).classList.add('active');
      refreshAll();
    })
  );
  const activeView = () => document.querySelector('#side button.active').dataset.view;

  /* ==================== editor + highlighting ==================== */
  const srcEl = $('src'), hlEl = $('hl'), gutEl = $('gutter');

  const PSEUDO = { MOV: 1, MOVE: 1, LI: 1, LA: 1, RET: 1 };
  function highlightLine(line) {
    const re = /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])')|((?:;|#|\/\/).*$)|(^[ \t]*[A-Za-z_.$][A-Za-z0-9_.$]*:)|(\.[A-Za-z]+)|(\b[Rr](?:3[01]|[12]?[0-9])\b)|(\b0[xX][0-9a-fA-F]+\b|\b0[bB][01]+\b|\b[0-9]+\b)|([A-Za-z_.$][A-Za-z0-9_.$]*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index));
      const t = m[0];
      let cls = 'tok-id';
      if (m[1]) cls = 'tok-str';
      else if (m[2]) cls = 'tok-num';
      else if (m[3]) cls = 'tok-cmt';
      else if (m[4]) cls = 'tok-lbl';
      else if (m[5]) cls = 'tok-dir';
      else if (m[6]) cls = 'tok-reg';
      else if (m[7]) cls = 'tok-num';
      else if (m[8]) cls = DLX.OPS[t.toUpperCase()] || PSEUDO[t.toUpperCase()] ? 'tok-kw' : 'tok-id';
      out += '<span class="' + cls + '">' + esc(t) + '</span>';
      last = m.index + t.length;
    }
    return out + esc(line.slice(last));
  }

  function execLine() {
    if (!sim || sim.halted || simFile !== ws.active) return -1;
    const d = sim.stID || sim.stEX || sim.stIF;
    return d ? d.line : -1;
  }

  function refreshEditor() {
    const lines = srcEl.value.split('\n');
    const ex = execLine();
    const bps = new Set(ws.bps[ws.active] || []);
    hlEl.innerHTML = lines
      .map((l, i) => {
        const h = highlightLine(l) || ' ';
        return i + 1 === ex ? '<span class="line-exec">' + h + '</span>' : h;
      })
      .join('\n') + '\n';
    gutEl.innerHTML = lines
      .map((_, i) => {
        const n = i + 1;
        return '<span class="gl' + (bps.has(n) ? ' bp' : '') + (n === ex ? ' exec' : '') + '" data-line="' + n + '">' + n + '</span>';
      })
      .join('');
    syncScroll();
  }
  function syncScroll() {
    hlEl.scrollTop = srcEl.scrollTop;
    hlEl.scrollLeft = srcEl.scrollLeft;
    gutEl.scrollTop = srcEl.scrollTop;
  }
  srcEl.addEventListener('input', () => {
    ws.files[ws.active] = srcEl.value;
    asmDirty = true;
    wsSave();
    refreshEditor();
  });
  srcEl.addEventListener('scroll', syncScroll);
  srcEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = srcEl.selectionStart, t = srcEl.selectionEnd;
      srcEl.value = srcEl.value.slice(0, s) + '        ' + srcEl.value.slice(t);
      srcEl.selectionStart = srcEl.selectionEnd = s + 8;
      ws.files[ws.active] = srcEl.value;
      asmDirty = true; wsSave(); refreshEditor();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      downloadActive();
    }
  });
  gutEl.addEventListener('click', (e) => {
    const g = e.target.closest('.gl');
    if (!g) return;
    const n = parseInt(g.dataset.line, 10);
    const arr = ws.bps[ws.active] || (ws.bps[ws.active] = []);
    const i = arr.indexOf(n);
    if (i >= 0) arr.splice(i, 1); else arr.push(n);
    wsSave();
    refreshEditor();
  });

  function downloadActive() {
    const blob = new Blob([ws.files[ws.active]], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ws.active;
    a.click();
    URL.revokeObjectURL(a.href);
    term('downloaded ' + ws.active, 't-info');
  }

  /* ========================== terminal =========================== */
  const termLines = [];
  function term(msg, cls) {
    termLines.push({ msg, cls });
    if (termLines.length > 400) termLines.shift();
    $('termOut').innerHTML = termLines.map((l) => '<span class="' + (l.cls || '') + '">' + esc(l.msg) + '</span>').join('\n');
    $('termOut').scrollTop = $('termOut').scrollHeight;
  }
  let printedOutputLen = 0;
  function flushProgramOutput() {
    if (!sim) return;
    if (sim.output.length > printedOutputLen) {
      const chunk = sim.output.slice(printedOutputLen);
      printedOutputLen = sim.output.length;
      for (const ln of chunk.split('\n')) if (ln !== '') term('  ' + ln);
    }
  }

  /* ====================== assemble / control ===================== */
  function assemble() {
    stopRun();
    prog = DLX.assemble(srcEl.value);
    if (!prog.ok) {
      sim = null; simFile = null;
      term('assembly failed (' + ws.active + '):', 't-err');
      for (const e of prog.errors) term('  line ' + e.line + ': ' + e.msg, 't-err');
      setState('error');
      refreshAll();
      return false;
    }
    sim = new DLX.Sim(prog, { forwarding: $('chkFwd').checked });
    simFile = ws.active;
    printedOutputLen = 0;
    bpResumeSeq = -1;
    asmDirty = false;
    const n = prog.instrs.filter(Boolean).length;
    term('assembled ' + ws.active + ': ' + n + ' instructions, ' + Object.keys(prog.symbols).length + ' symbols  (forwarding ' + ($('chkFwd').checked ? 'ON' : 'OFF') + ')', 't-info');
    setState('ready');
    populateSymbols();
    refreshAll();
    return true;
  }

  function ensureSim() {
    if (!sim || asmDirty || simFile !== ws.active) return assemble();
    return true;
  }

  function setState(s) {
    const el = $('stState');
    el.className = 'state-' + s;
    el.textContent = s;
  }

  function bpSet() { return new Set(ws.bps[simFile] || []); }
  // after step(), the instruction that just completed ID sits in stEX
  function hitBreakpoint(set) {
    if (!sim || sim.halted || !sim.stEX) return false;
    if (!set.size) return false;
    if (sim.stEX.seq === bpResumeSeq) return false;
    return set.has(sim.stEX.line);
  }

  function pauseAtBp() {
    const d = sim.stEX;
    stopRun();
    setState('paused');
    term('breakpoint: line ' + d.line + ' — "' + d.asm + '" decoded at cycle ' + sim.cycle, 't-info');
    refreshAll();
  }

  function afterStep() {
    flushProgramOutput();
    if (sim.halted) {
      stopRun();
      setState(sim.runtimeError ? 'error' : 'halted');
      if (sim.runtimeError) term('runtime error: ' + sim.runtimeError, 't-err');
      else term('halted at cycle ' + sim.cycle + ' — ' + sim.stats.instrs + ' instructions, CPI ' + (sim.cycle / Math.max(1, sim.stats.instrs)).toFixed(2), 't-info');
    }
    refreshAll();
  }

  function doStep(n) {
    if (!ensureSim()) return;
    for (let i = 0; i < n && !sim.halted; i++) sim.step();
    afterStep();
  }

  function stopRun() {
    if (runTimer) { clearInterval(runTimer); runTimer = null; }
    $('btnRun').textContent = 'Run';
    if (sim && !sim.halted && $('stState').textContent === 'running') setState('ready');
  }

  function toggleRun() {
    if (runTimer) { stopRun(); return; }
    if (!ensureSim()) return;
    if (sim.halted) return;
    bpResumeSeq = sim.stEX ? sim.stEX.seq : -1; // don't re-trip the breakpoint we're sitting on
    const set = bpSet();
    const speed = parseInt($('speedSel').value, 10);
    const perTick = speed <= 60 ? 1 : 200;
    const interval = speed <= 60 ? 1000 / speed : 16;
    setState('running');
    $('btnRun').textContent = 'Pause';
    runTimer = setInterval(() => {
      for (let i = 0; i < perTick && !sim.halted; i++) {
        sim.step();
        if (hitBreakpoint(set)) { pauseAtBp(); return; }
      }
      afterStep();
    }, interval);
  }

  function runToEnd() {
    if (!ensureSim()) return;
    if (sim.halted) return;
    bpResumeSeq = sim.stEX ? sim.stEX.seq : -1;
    const set = bpSet();
    setState('running');
    const chunk = () => {
      const t0 = performance.now();
      while (!sim.halted && performance.now() - t0 < 40) {
        for (let i = 0; i < 2000 && !sim.halted; i++) {
          sim.step();
          if (hitBreakpoint(set)) { pauseAtBp(); return; }
        }
        if (sim.cycle > 2000000) { term('stopped: exceeded 2,000,000 cycles (infinite loop?)', 't-err'); sim.halted = true; }
      }
      if (!sim.halted) { flushProgramOutput(); requestAnimationFrame(chunk); }
      else afterStep();
    };
    chunk();
  }

  $('btnAssemble').addEventListener('click', assemble);
  $('btnStep').addEventListener('click', () => { stopRun(); doStep(1); });
  $('btnStep10').addEventListener('click', () => { stopRun(); doStep(10); });
  $('btnRun').addEventListener('click', toggleRun);
  $('btnFast').addEventListener('click', () => { stopRun(); runToEnd(); });
  $('btnReset').addEventListener('click', () => {
    stopRun();
    if (sim) { sim.opts.forwarding = $('chkFwd').checked; sim.reset(); printedOutputLen = 0; bpResumeSeq = -1; term('machine reset', 't-info'); setState('ready'); refreshAll(); }
  });
  $('chkFwd').addEventListener('change', () => {
    if (sim) { stopRun(); sim.opts.forwarding = $('chkFwd').checked; sim.reset(); printedOutputLen = 0; bpResumeSeq = -1; term('forwarding ' + ($('chkFwd').checked ? 'ON' : 'OFF') + ' — machine reset', 't-info'); setState('ready'); refreshAll(); }
  });

  /* ========================= status bar ========================== */
  function refreshStatus() {
    $('stCycle').textContent = 'cycle ' + (sim ? sim.cycle : 0);
    $('stPC').textContent = 'PC ' + (sim ? DLX.hex(sim.pc, 4) : '0x0000');
  }

  /* ======================== pipeline view ======================== */
  const CELL_W = 68, WIN = 60;
  const followChk = $('chkFollow'), winSlider = $('cycleWin');
  winSlider.addEventListener('input', () => { followChk.checked = false; refreshPipeline(); });
  followChk.addEventListener('change', refreshPipeline);

  function refreshPipeline() {
    if (activeView() !== 'pipeline') return;
    const chart = $('pipeChart');
    if (!sim || sim.cycle === 0) {
      chart.innerHTML = '<div class="pipe-empty">Assemble a program and step / run to see the pipeline diagram.</div>';
      $('winLabel').textContent = '';
      return;
    }
    const maxStart = Math.max(1, sim.cycle - WIN + 1);
    winSlider.max = maxStart;
    if (followChk.checked) winSlider.value = maxStart;
    const c0 = Math.min(parseInt(winSlider.value, 10) || 1, maxStart);
    const c1 = c0 + WIN - 1;
    $('winLabel').textContent = 'cycles ' + c0 + ' – ' + Math.min(c1, sim.cycle) + ' of ' + sim.cycle;

    let html = '<div class="pipe-row pipe-header"><div class="pipe-label"></div><div class="pipe-cells" style="width:' + (WIN * CELL_W) + 'px">';
    for (let c = c0; c <= c1; c++) {
      if ((c - c0) % 2 === 0 || c === sim.cycle)
        html += '<div class="pchead' + (c === sim.cycle ? ' cur' : '') + '" style="left:' + ((c - c0) * CELL_W) + 'px">' + c + '</div>';
    }
    html += '</div></div>';

    let rows = 0;
    for (const r of sim.records) {
      const cells = r.cells;
      if (!cells.length || cells[cells.length - 1][0] < c0 || cells[0][0] > c1) continue;
      if (++rows > 300) { html += '<div class="pipe-empty">… more rows hidden (move the cycle window)</div>'; break; }
      html += '<div class="pipe-row"><div class="pipe-label"><b>' + esc(shortAsm(r.asm)) + '</b> &nbsp;' + DLX.hex(r.addr, 4) + '</div>';
      html += '<div class="pipe-cells" style="width:' + (WIN * CELL_W) + 'px">';
      for (const [c, st] of cells) {
        if (c < c0 || c > c1) continue;
        html += '<div class="pcell st' + st + '" style="left:' + ((c - c0) * CELL_W) + 'px">' + st + '</div>';
      }
      html += '</div></div>';
    }
    if (rows === 0) html += '<div class="pipe-empty">no instructions in this cycle window</div>';
    chart.innerHTML = html;
    if (followChk.checked) {
      chart.scrollLeft = Math.max(0, (Math.min(c1, sim.cycle) - c0 + 1) * CELL_W - (chart.clientWidth - 310));
      chart.scrollTop = chart.scrollHeight;
    }
  }
  function shortAsm(a) { return a.length > 30 ? a.slice(0, 29) + '…' : a; }

  /* ======================= registers & mem ======================= */
  function refreshRegs() {
    if (activeView() !== 'regmem') return;
    const g = $('regGrid');
    if (!sim) { g.innerHTML = '<span class="dim">assemble first</span>'; return; }
    let html = '';
    for (let i = 0; i < 32; i++) {
      const v = sim.regs[i];
      const hot = sim.lastRegWrite.reg === i && sim.lastRegWrite.cycle === sim.cycle;
      html += '<div class="reg' + (hot ? ' hot' : '') + '"><span class="rn">R' + i + '</span><span class="rv">' + DLX.hex(v) + '</span><span class="rd2">' + v + '</span></div>';
    }
    g.innerHTML = html;
    refreshMem();
  }

  function populateSymbols() {
    const s = $('symSel');
    if (!prog) { s.innerHTML = ''; return; }
    const syms = Object.entries(prog.symbols).sort((a, b) => a[1] - b[1]);
    s.innerHTML = '<option value="">symbol…</option>' + syms.map(([k, v]) => '<option value="' + v + '">' + esc(k) + ' (' + DLX.hex(v, 4) + ')</option>').join('');
  }
  $('symSel').addEventListener('change', () => {
    if ($('symSel').value !== '') { $('memAddr').value = DLX.hex(parseInt($('symSel').value, 10), 4); refreshMem(); }
  });
  $('btnMemGo').addEventListener('click', refreshMem);
  $('memAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') refreshMem(); });

  function refreshMem() {
    const el = $('memDump');
    if (!sim) { el.textContent = ''; return; }
    let base = parseInt($('memAddr').value, 16);
    if (isNaN(base)) base = DLX.DATA_BASE;
    base = Math.max(0, Math.min(sim.mem.length - 256, base & ~15));
    let out = '';
    for (let row = 0; row < 16; row++) {
      const a = base + row * 16;
      out += '<span class="ma">' + DLX.hex(a, 4) + '</span>  ';
      let asc = '';
      for (let i = 0; i < 16; i++) {
        const b = sim.mem[a + i];
        const hot = sim.lastMemWrite.cycle === sim.cycle && a + i >= sim.lastMemWrite.addr && a + i < sim.lastMemWrite.addr + sim.lastMemWrite.size;
        const h = b.toString(16).toUpperCase().padStart(2, '0');
        out += (hot ? '<span class="hot">' + h + '</span>' : h) + (i === 7 ? '  ' : ' ');
        asc += b >= 32 && b < 127 ? String.fromCharCode(b) : '·';
      }
      out += ' <span class="asc">' + esc(asc) + '</span>\n';
    }
    el.innerHTML = out;
  }

  /* ============================ logs ============================= */
  $('logFilter').addEventListener('change', refreshLogs);
  function refreshLogs() {
    if (activeView() !== 'logs') return;
    const el = $('logList');
    if (!sim) { el.innerHTML = '<span class="dim">assemble first</span>'; return; }
    const f = $('logFilter').value;
    const entries = f ? sim.log.filter((l) => l.kind === f) : sim.log;
    const shown = entries.slice(-800);
    el.innerHTML = shown.map((l) =>
      '<div class="log-line"><span class="log-c">' + l.c + '</span><span class="log-k lk-' + l.kind + '">' + l.kind + '</span><span class="log-m">' + esc(l.msg) + '</span></div>'
    ).join('') || '<span class="dim">no events' + (f ? ' of this kind' : '') + ' yet</span>';
    el.scrollTop = el.scrollHeight;
  }

  /* ============================ tests ============================ */
  // Tests are fully general: any workspace file that contains @expect
  // directives can be verified. Results identical to `sim` semantics.
  function runFileTest(name) {
    const src = ws.files[name];
    const { checks, errors } = DLX.parseExpects(src);
    const out = { name, ok: false, detail: '', metrics: '', checks: [] };
    if (errors.length) { out.detail = errors.map((e) => 'line ' + e.line + ': ' + e.msg).join('\n'); return out; }
    if (!checks.length) { out.detail = 'no @expect directives in this file'; out.none = true; return out; }
    const p = DLX.assemble(src);
    if (!p.ok) { out.detail = p.errors.map((e) => 'line ' + e.line + ': ' + e.msg).join('\n'); return out; }
    const s = new DLX.Sim(p, { forwarding: $('chkFwd').checked });
    s.run(2000000);
    if (!s.halted || s.runtimeError) { out.detail = s.runtimeError || 'did not halt within 2M cycles'; return out; }
    // checks may reference labels that don't exist — evalChecks needs guarding
    for (const ck of checks) {
      if (ck.label !== undefined && p.symbols[ck.label] === undefined) {
        out.checks.push({ desc: 'line ' + ck.line, expected: ck.value, actual: 'unknown label "' + ck.label + '"', pass: false });
        continue;
      }
      out.checks.push(Object.assign({ line: ck.line }, DLX.evalChecks(s, p, [ck])[0]));
    }
    out.ok = out.checks.every((c) => c.pass);
    out.metrics = s.cycle + ' cyc · CPI ' + (s.cycle / Math.max(1, s.stats.instrs)).toFixed(2) + ' · ' + s.stats.stalls + ' stalls';
    return out;
  }

  function renderTestResults(results) {
    const list = $('testList');
    list.innerHTML = '';
    let pass = 0, fail = 0, skipped = 0;
    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'test-row';
      const status = r.none ? '<span class="test-status wait">—</span>' : '<span class="test-status ' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? 'PASS' : 'FAIL') + '</span>';
      row.innerHTML = status + '<span class="test-name"></span><span class="test-metrics"></span><button>open</button>';
      row.querySelector('.test-name').textContent = r.name;
      row.querySelector('.test-metrics').textContent = r.metrics;
      row.querySelector('button').addEventListener('click', () => {
        openFile(r.name);
        document.querySelector('#side button[data-view="code"]').click();
      });
      const details = [];
      if (r.detail) details.push(r.detail);
      for (const c of r.checks || []) {
        if (!c.pass) details.push((c.line ? 'line ' + c.line + ' — ' : '') + c.desc + ': expected ' + JSON.stringify(c.expected) + ', got ' + JSON.stringify(c.actual));
      }
      if (!r.ok && details.length) {
        const d = document.createElement('div');
        d.className = 'test-fail';
        d.textContent = details.join('\n');
        row.appendChild(d);
      } else if (r.ok) {
        const d = document.createElement('div');
        d.className = 'test-pass-note';
        d.textContent = (r.checks || []).length + ' check' + (r.checks.length === 1 ? '' : 's') + ' passed';
        row.appendChild(d);
      }
      if (r.none) skipped++; else if (r.ok) pass++; else fail++;
      list.appendChild(row);
    }
    $('testSummary').textContent = pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' without @expect' : '');
  }

  $('btnRunTests').addEventListener('click', () => {
    renderTestResults([runFileTest(ws.active)]);
  });
  $('btnRunAllTests').addEventListener('click', () => {
    const names = Object.keys(ws.files).sort();
    renderTestResults(names.map(runFileTest));
  });

  /* ========================= performance ========================= */
  function refreshPerf() {
    if (activeView() !== 'perf') return;
    const el = $('perfCards');
    if (!sim) { el.innerHTML = '<span class="dim">assemble first</span>'; return; }
    const st = sim.stats;
    const cpi = st.instrs ? (st.cycles / st.instrs) : 0;
    const ideal = st.instrs ? st.instrs + 4 : 0;
    const cards = [
      [st.cycles, 'clock cycles', ''],
      [st.instrs, 'instructions retired', ''],
      [st.instrs ? cpi.toFixed(3) : '—', 'CPI', 'ideal 1.0 (+4 fill)'],
      [st.stalls, 'stall cycles', 'load-use ' + st.stallCauses.loadUse + ' · branch ' + st.stallCauses.branchWait + ' · RAW ' + st.stallCauses.rawNoFwd],
      [st.forwards, 'forwards taken', 'EX/MEM + MEM/WB paths'],
      [st.flushes, 'control flushes', '1 bubble per taken branch/jump'],
      [ideal ? ideal : '—', 'ideal cycles', 'instructions + pipeline fill'],
      [ideal && st.cycles ? Math.round((ideal / st.cycles) * 100) + '%' : '—', 'pipeline efficiency', 'ideal / actual'],
      [st.memReads, 'memory reads', ''],
      [st.memWrites, 'memory writes', ''],
      [st.branches, 'branches', st.branchesTaken + ' taken · ' + (st.branches - st.branchesTaken) + ' not taken'],
      [st.jumps, 'unconditional jumps', 'J / JAL / JR / JALR'],
    ];
    el.innerHTML = cards.map(([v, l, s]) => '<div class="pcard"><div class="pv">' + v + '</div><div class="pl">' + l + '</div>' + (s ? '<div class="ps">' + s + '</div>' : '') + '</div>').join('');
  }

  $('btnCompare').addEventListener('click', () => {
    const p = DLX.assemble(srcEl.value);
    const out = $('perfCompare');
    if (!p.ok) { out.innerHTML = '<span class="dim">fix assembly errors first</span>'; return; }
    const res = {};
    for (const fwd of [true, false]) {
      const s = new DLX.Sim(p, { forwarding: fwd });
      s.run(2000000);
      res[fwd] = s;
    }
    const a = res[true].stats, b = res[false].stats;
    const cpi = (s) => (s.instrs ? (s.cycles / s.instrs).toFixed(3) : '—');
    out.innerHTML =
      '<h2>' + esc(ws.active) + ' — run to completion in both configurations</h2><table>' +
      '<tr><th></th><th>forwarding ON</th><th>forwarding OFF</th></tr>' +
      '<tr><td>cycles</td><td class="better">' + a.cycles + '</td><td>' + b.cycles + '</td></tr>' +
      '<tr><td>instructions</td><td>' + a.instrs + '</td><td>' + b.instrs + '</td></tr>' +
      '<tr><td>CPI</td><td class="better">' + cpi(a) + '</td><td>' + cpi(b) + '</td></tr>' +
      '<tr><td>stall cycles</td><td>' + a.stalls + '</td><td>' + b.stalls + '</td></tr>' +
      '<tr><td>&nbsp;&nbsp;load-use</td><td>' + a.stallCauses.loadUse + '</td><td>' + b.stallCauses.loadUse + '</td></tr>' +
      '<tr><td>&nbsp;&nbsp;branch operand</td><td>' + a.stallCauses.branchWait + '</td><td>' + b.stallCauses.branchWait + '</td></tr>' +
      '<tr><td>&nbsp;&nbsp;RAW (no fwd)</td><td>' + a.stallCauses.rawNoFwd + '</td><td>' + b.stallCauses.rawNoFwd + '</td></tr>' +
      '<tr><td>forwards</td><td>' + a.forwards + '</td><td>' + b.forwards + '</td></tr>' +
      '<tr><td>control flushes</td><td>' + a.flushes + '</td><td>' + b.flushes + '</td></tr>' +
      '<tr><td>speed-up</td><td class="better">' + (b.cycles / a.cycles).toFixed(2) + '×</td><td>1.00×</td></tr>' +
      '</table>';
  });

  /* ============================= help ============================ */
  $('helpBody').innerHTML = `
<h2>What this is</h2>
<p>A DLX (RISC) assembler and cycle-accurate 5-stage pipeline simulator: <b>IF → ID → EX → MEM → WB</b>,
in-order, branches resolved in ID, 64&nbsp;KiB big-endian memory, 32 registers (R0 is always 0).
The register file is written in the first half of WB and read in the second half of ID.</p>

<h2>Workspace</h2>
<ul>
<li>Files live in your browser (localStorage). Create (＋), import from disk (⇪), download with <code>Ctrl/Cmd+S</code>.</li>
<li>Double-click a file to rename it; ✕ deletes it.</li>
<li>The ☰ menu adds the UEC 610 example projects (P1–P20) as ordinary editable files.</li>
<li>Click a line number to toggle a <b>breakpoint</b>; Run pauses when that line reaches the ID stage. The highlighted line is the instruction currently in ID.</li>
</ul>

<h2>Hazard model</h2>
<ul>
<li><b>Forwarding ON</b> — EX/MEM and MEM/WB forward into EX (and into ID for branch operands):
load-use costs 1 stall; a branch right after its producer costs 1 stall (2 after a load); taken branches/jumps flush 1 fetched instruction.</li>
<li><b>Forwarding OFF</b> — every RAW dependence stalls until the producer completes WB (up to 2 stalls).</li>
</ul>

<h2>Instruction set</h2>
<table>
<tr><th>Group</th><th>Instructions</th></tr>
<tr><td>ALU R-type</td><td>ADD ADDU SUB SUBU AND OR XOR NOR SLL SRL SRA SLT SGT SLE SGE SEQ SNE SLTU SGTU MULT MUL MULTU DIV DIVU MOD</td></tr>
<tr><td>ALU immediate</td><td>ADDI ADDUI SUBI SUBUI ANDI ORI XORI SLLI SRLI SRAI SLTI SGTI SLEI SGEI SEQI SNEI LHI</td></tr>
<tr><td>Load / store</td><td>LW LH LHU LB LBU &nbsp;·&nbsp; SW SH SB &nbsp; (e.g. <code>LW R1, 8(R2)</code>, <code>SW label(R0), R3</code>)</td></tr>
<tr><td>Control</td><td>BEQZ BNEZ BEQ BNE J JAL JR JALR &nbsp; (<code>BEQZ R1, label</code>, <code>BEQ R1, R2, label</code>)</td></tr>
<tr><td>Other</td><td>NOP HALT TRAP</td></tr>
<tr><td>Pseudo</td><td>MOV rd,rs · LI rd,imm32 · LA rd,label · RET</td></tr>
</table>

<h2>Traps (I/O)</h2>
<table>
<tr><th>Call</th><th>Effect</th></tr>
<tr><td><code>TRAP 0</code> / <code>HALT</code></td><td>stop the program</td></tr>
<tr><td><code>TRAP 1</code></td><td>print R1 as signed decimal</td></tr>
<tr><td><code>TRAP 2</code></td><td>print NUL-terminated string at address in R1</td></tr>
<tr><td><code>TRAP 3</code></td><td>print R1 as a single character</td></tr>
<tr><td><code>TRAP 4</code></td><td>print R1 as hexadecimal</td></tr>
</table>

<h2>Directives</h2>
<p><code>.text</code> <code>.data</code> <code>.org addr</code> <code>.word v,…</code> <code>.half v,…</code> <code>.byte v,…</code>
<code>.ascii "s"</code> <code>.asciiz "s"</code> <code>.space n</code> <code>.align k</code> —
code starts at 0x0000, data at 0x1000. Comments with <code>;</code>, <code>#</code> or <code>//</code>.
Labels may be used wherever an immediate is expected.</p>

<h2>Self-checking programs (@expect)</h2>
<p>Declare expected results as comments anywhere in a program; the Tests tab runs the
program to completion and verifies them:</p>
<table>
<tr><td><code>; @expect reg R2 = 55</code></td><td>register value</td></tr>
<tr><td><code>; @expect word result = 55</code></td><td>32-bit word at label (also <code>half</code>, <code>byte</code>)</td></tr>
<tr><td><code>; @expect word C[4] = 69</code></td><td>indexed, scaled by element size</td></tr>
<tr><td><code>; @expect string rev = "ENILEPIP"</code></td><td>NUL-terminated string at label</td></tr>
<tr><td><code>; @expect output "55"</code></td><td>program output contains text</td></tr>
</table>`;

  /* ========================== refresh all ======================== */
  function refreshAll() {
    refreshStatus();
    refreshEditor();
    refreshPipeline();
    refreshRegs();
    refreshLogs();
    refreshPerf();
  }

  /* ============================ boot ============================= */
  wsLoad();
  refreshExplorer();
  srcEl.value = ws.files[ws.active];
  refreshEditor();
  term('workspace loaded — ' + Object.keys(ws.files).length + ' file(s). Add the UEC 610 projects from the ☰ menu.', 't-info');
  assemble();
})();
