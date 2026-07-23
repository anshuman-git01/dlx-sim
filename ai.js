/* ============================================================
 * DLX-Sim — AI chat assistant (ai.js)
 *
 * A Copilot-style helper docked to the right of the editor. It can
 * explain programs and errors, fix broken DLX, write new programs,
 * and edit the current one — replying with prose + DLX code blocks
 * that the user applies to the editor with a click.
 *
 * Fully client-side and provider-pluggable (bring-your-own-key):
 *   - Google Gemini  (free tier — the default)
 *   - Anthropic Claude (optional, paid)
 * Keys live only in this browser's localStorage. No backend.
 *
 * Talks to the IDE exclusively through window.DLXIDE (see app.js).
 * ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AI_KEY = 'dlxsim.ai.v1';

  /* -------------------------- providers -------------------------- */
  const PROVIDERS = {
    gemini: {
      label: 'Google Gemini (free)',
      models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
      keyHint: 'Free key from Google AI Studio → "Get API key"',
      keyUrl: 'https://aistudio.google.com/apikey',
    },
    anthropic: {
      label: 'Anthropic Claude (paid)',
      models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
      keyHint: 'Paid key from console.anthropic.com (not free)',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    },
  };

  /* --------------------------- settings -------------------------- */
  let cfg = loadCfg();
  function loadCfg() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(AI_KEY)); } catch (e) { c = null; }
    if (!c || typeof c !== 'object') c = {};
    c.provider = PROVIDERS[c.provider] ? c.provider : 'gemini';
    c.keys = c.keys && typeof c.keys === 'object' ? c.keys : {};
    if (!PROVIDERS[c.provider].models.includes(c.model)) c.model = PROVIDERS[c.provider].models[0];
    c.open = !!c.open;
    return c;
  }
  function saveCfg() {
    try { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); } catch (e) { /* quota */ }
  }
  const currentKey = () => (cfg.keys[cfg.provider] || '').trim();

  /* ----------------------- system prompt ------------------------- */
  // Built at runtime from the live ISA so it can never drift from dlx.js.
  function buildSystemPrompt() {
    const ops = (window.DLX && DLX.OPS) ? Object.keys(DLX.OPS).sort().join(' ') : '(unavailable)';
    return [
      'You are an expert teaching assistant embedded in "DLX-Sim", a browser-based',
      'simulator for the DLX RISC processor with a classic 5-stage pipeline',
      '(IF → ID → EX → MEM → WB). You help students read, write, debug, and optimize',
      'DLX assembly programs for THIS specific simulator.',
      '',
      'CRITICAL — generate code ONLY in this simulator\'s dialect:',
      '• Instruction mnemonics available (case-insensitive): ' + ops + '.',
      '  Do NOT invent MIPS/other instructions (no syscall, no la/li beyond the pseudo-ops below).',
      '• Pseudo-instructions: MOV rd,rs · LI rd,imm32 · LA rd,label · RET.',
      '• Registers R0–R31; R0 is hardwired to 0. 16-bit signed immediates.',
      '• Directives: .text .data .word .half .byte .ascii .asciiz .space .align .org.',
      '• Memory is 64 KiB, big-endian; text at 0x0000, data at 0x1000. Labels usable as immediates.',
      '• Loads/stores: LW/LH/LHU/LB/LBU and SW/SH/SB, e.g. `LW R1, 8(R2)` or `SW label(R0), R3`.',
      '• Control: BEQZ/BNEZ (1-reg), BEQ/BNE (2-reg), J, JAL, JR, JALR.',
      '• I/O traps: TRAP 0 = halt · TRAP 1 = print R1 as signed int · TRAP 2 = print string at R1',
      '  · TRAP 3 = print R1 as char · TRAP 4 = print R1 as hex. Every program must end with TRAP 0.',
      '• Self-checking directives (as comments) verified by the Tests tab — ADD THESE when you write a program:',
      '    ; @expect reg R2 = 55',
      '    ; @expect word label = 55        (also: half, byte)',
      '    ; @expect word C[4] = 69         (indexed, scaled by element size)',
      '    ; @expect string buf = "OK"',
      '    ; @expect output "55"',
      '',
      'Pipeline model (for optimization/hazard questions): branches resolve in ID (a taken',
      'branch/jump costs 1 bubble); split-phase register file (write first half of WB, read',
      'second half of ID); with forwarding ON: load-use = 1 stall, load→branch = 2 stalls.',
      '',
      'When you provide DLX code, ALWAYS put it in a fenced ```dlx code block so the user can',
      'apply it with one click. Give a complete, runnable program (with .text, a main label,',
      'and TRAP 0) unless the user explicitly asks for only a snippet.',
      '',
      'BE CONCISE — this matters:',
      '• Write the shortest correct program for the task. No extra helper subroutines, no',
      '  alternate implementations, no defensive checks for cases that cannot occur.',
      '• Comment sparingly: at most one short comment per logical step, never one per line.',
      "  Don't restate what an instruction obviously does (no '; add R1 and R2' next to ADD R1,R1,R2).",
      '• Do not repeat the program in prose — say what it does in 1-2 sentences, then show it',
      '  once in the code block. No line-by-line walkthrough unless the user asks to have it explained.',
      '• Give ONE version. Do not offer multiple variants or "alternative approaches" unless asked.',
      '• Use plain text — no LaTeX, no headers, no bullet-point essays for simple requests.',
    ].join('\n');
  }

  // Context about the file the user is currently editing.
  function editorContext() {
    if (!window.DLXIDE) return '';
    const name = DLXIDE.activeName();
    const src = DLXIDE.getSource();
    const errs = DLXIDE.getErrors();
    let s = '\n\n---\nCurrent file: ' + name + '\n```dlx\n' + src + '\n```';
    if (errs.length) {
      s += '\nAssembler errors right now:\n' + errs.map((e) => '  line ' + e.line + ': ' + e.msg).join('\n');
    } else {
      s += '\n(The current file assembles without errors.)';
    }
    return s;
  }

  /* --------------------- provider adapters ----------------------- */
  // Async generator yielding text deltas. Falls back to a single
  // non-streaming chunk if streaming is unavailable/blocked.
  async function* streamChat(system, history, signal) {
    if (cfg.provider === 'anthropic') {
      yield* streamAnthropic(system, history, signal);
    } else {
      yield* streamGemini(system, history, signal);
    }
  }

  async function* sseLines(resp, signal) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      if (signal && signal.aborted) { reader.cancel(); return; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        yield line;
      }
    }
    if (buf) yield buf;
  }

  async function* streamGemini(system, history, signal) {
    const key = currentKey();
    const model = cfg.model;
    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    };
    const base = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model);
    let resp;
    try {
      resp = await fetch(base + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
    } catch (e) {
      // network/CORS on the stream endpoint — try non-streaming
      yield* geminiNonStream(base, key, body, signal); return;
    }
    if (!resp.ok) { throw new Error('Gemini ' + resp.status + ': ' + (await safeErr(resp))); }
    for await (const line of sseLines(resp, signal)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
        if (parts) for (const p of parts) if (p.text) yield p.text;
      } catch (e) { /* partial JSON line — ignore */ }
    }
  }

  async function* geminiNonStream(base, key, body, signal) {
    const resp = await fetch(base + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    if (!resp.ok) { throw new Error('Gemini ' + resp.status + ': ' + (await safeErr(resp))); }
    const j = await resp.json();
    const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    if (parts) for (const p of parts) if (p.text) yield p.text;
  }

  async function* streamAnthropic(system, history, signal) {
    const key = currentKey();
    const body = {
      model: cfg.model,
      max_tokens: 4096,
      system,
      stream: true,
      messages: history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal,
    });
    if (!resp.ok) { throw new Error('Claude ' + resp.status + ': ' + (await safeErr(resp))); }
    for await (const line of sseLines(resp, signal)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') yield j.delta.text;
      } catch (e) { /* ignore */ }
    }
  }

  async function safeErr(resp) {
    try { const t = await resp.text(); return t.slice(0, 300); } catch (e) { return resp.statusText || ''; }
  }

  /* --------------------------- chat state ------------------------ */
  const history = []; // {role:'user'|'assistant', content}
  let busy = false;
  let abort = null;

  function esc(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Render assistant text: fenced code blocks become cards with actions;
  // everything else is escaped prose.
  function renderAssistant(text) {
    const parts = [];
    const re = /```(?:dlx|asm|assembly|s)?\n([\s\S]*?)```/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(prose(text.slice(last, m.index)));
      parts.push(codeCard(m[1].replace(/\n$/, '')));
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(prose(text.slice(last)));
    return parts.join('');
  }
  function prose(t) {
    t = t.trim();
    if (!t) return '';
    // minimal inline `code` support
    const html = esc(t).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
    return '<div class="ai-prose">' + html + '</div>';
  }
  function codeCard(code) {
    const b64 = encodeURIComponent(code);
    return '<div class="ai-code"><pre>' + esc(code) + '</pre>' +
      '<div class="ai-code-actions">' +
      '<button class="ai-apply" data-code="' + b64 + '">Apply to editor</button>' +
      '<button class="ai-copy" data-code="' + b64 + '">Copy</button>' +
      '</div></div>';
  }

  function addMsg(role, html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-' + role;
    wrap.innerHTML = html;
    if (opts && opts.id) wrap.id = opts.id;
    $('aiMessages').appendChild(wrap);
    $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
    return wrap;
  }

  /* --------------------------- sending --------------------------- */
  async function send(userText, includeContext) {
    if (busy) return;
    userText = (userText || '').trim();
    if (!userText) return;
    if (!currentKey()) { showSettings(true); return; }

    busy = true; setBusy(true);
    addMsg('user', prose(userText));

    // Model sees the raw question; we append editor context to the copy we send.
    history.push({ role: 'user', content: userText + (includeContext ? editorContext() : '') });

    const holder = addMsg('assistant', '<div class="ai-prose ai-typing">…</div>', { id: 'ai-live' });
    let acc = '';
    abort = new AbortController();
    try {
      for await (const delta of streamChat(buildSystemPrompt(), history, abort.signal)) {
        acc += delta;
        holder.innerHTML = renderAssistant(acc) || '<div class="ai-prose ai-typing">…</div>';
        $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
      }
      if (!acc.trim()) { holder.innerHTML = prose('(empty response)'); }
      history.push({ role: 'assistant', content: acc });
    } catch (e) {
      holder.innerHTML = '<div class="ai-error">' + esc(String(e.message || e)) + '</div>' +
        hintFor(String(e.message || e));
      // don't keep a failed assistant turn in history
    } finally {
      holder.removeAttribute('id');
      busy = false; setBusy(false); abort = null;
    }
  }

  function hintFor(msg) {
    if (/401|403|invalid|API key|API_KEY|permission/i.test(msg)) {
      return '<div class="ai-prose ai-dim">Check your API key in the ⚙ settings above.</div>';
    }
    if (/Failed to fetch|CORS|NetworkError/i.test(msg)) {
      return '<div class="ai-prose ai-dim">Network/CORS error reaching the provider. If it persists, try the other provider.</div>';
    }
    return '';
  }

  function setBusy(b) {
    $('aiSend').textContent = b ? 'Stop' : 'Send';
    $('aiSend').classList.toggle('busy', b);
    $('aiInput').disabled = false;
  }

  /* ------------------------- quick actions ----------------------- */
  const QUICK = [
    { label: 'Fix errors', prompt: 'Fix the assembler errors in my current program. Explain briefly what was wrong, then give the corrected full program.' },
    { label: 'Explain errors', prompt: 'Explain the current assembler errors in my program in plain language and how to fix each one.' },
    { label: 'Explain program', prompt: 'Explain what my current program does, step by step.' },
    { label: 'Optimize', prompt: 'Suggest how to reduce pipeline stalls in my current program, and give an optimized version.' },
    { label: 'Add @expect tests', prompt: 'Add appropriate ; @expect self-check directives to my current program so the Tests tab can verify it, and return the full program.' },
  ];

  /* --------------------------- UI wiring ------------------------- */
  function buildPanel() {
    // provider + model selectors
    const provSel = $('aiProvider');
    provSel.innerHTML = Object.keys(PROVIDERS).map((p) =>
      '<option value="' + p + '"' + (p === cfg.provider ? ' selected' : '') + '>' + PROVIDERS[p].label + '</option>').join('');
    rebuildModels();

    // quick actions
    $('aiQuick').innerHTML = QUICK.map((q, i) => '<button data-q="' + i + '">' + q.label + '</button>').join('');

    refreshKeyUI();
    applyOpenState();
  }
  function rebuildModels() {
    const modelSel = $('aiModel');
    const models = PROVIDERS[cfg.provider].models;
    if (!models.includes(cfg.model)) cfg.model = models[0];
    modelSel.innerHTML = models.map((m) =>
      '<option value="' + m + '"' + (m === cfg.model ? ' selected' : '') + '>' + m + '</option>').join('');
  }
  function refreshKeyUI() {
    const p = PROVIDERS[cfg.provider];
    $('aiKey').value = cfg.keys[cfg.provider] || '';
    $('aiKey').placeholder = 'Paste your ' + (cfg.provider === 'gemini' ? 'Gemini' : 'Claude') + ' API key';
    $('aiKeyHint').innerHTML = p.keyHint + ' — <a href="' + p.keyUrl + '" target="_blank" rel="noopener">get one</a>';
    $('aiNokey').classList.toggle('hidden', !!currentKey());
  }
  function showSettings(force) {
    const box = $('aiSettings');
    const show = force || box.classList.contains('hidden');
    box.classList.toggle('hidden', !show);
  }
  function applyOpenState() {
    document.getElementById('app').classList.toggle('ai-open', cfg.open);
    const t = $('btnAI');
    if (t) t.classList.toggle('active', cfg.open);
  }
  function toggleOpen(force) {
    cfg.open = (typeof force === 'boolean') ? force : !cfg.open;
    saveCfg();
    applyOpenState();
    if (cfg.open) $('aiInput').focus();
  }

  function decode(el) { return decodeURIComponent(el.dataset.code); }

  function wire() {
    $('btnAI').addEventListener('click', () => toggleOpen());
    $('aiClose').addEventListener('click', () => toggleOpen(false));
    $('aiGear').addEventListener('click', () => showSettings());

    $('aiProvider').addEventListener('change', (e) => {
      cfg.provider = e.target.value; rebuildModels(); saveCfg(); refreshKeyUI();
    });
    $('aiModel').addEventListener('change', (e) => { cfg.model = e.target.value; saveCfg(); });
    $('aiKey').addEventListener('input', (e) => {
      cfg.keys[cfg.provider] = e.target.value.trim(); saveCfg(); $('aiNokey').classList.toggle('hidden', !!currentKey());
    });

    $('aiSend').addEventListener('click', () => {
      if (busy) { if (abort) abort.abort(); return; }
      const v = $('aiInput').value; $('aiInput').value = ''; send(v, true);
    });
    $('aiInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('aiSend').click(); }
    });

    $('aiQuick').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-q]'); if (!b) return;
      send(QUICK[+b.dataset.q].prompt, true);
    });

    // Apply / Copy / Undo (delegated — cards are added dynamically)
    $('aiMessages').addEventListener('click', (e) => {
      const apply = e.target.closest('.ai-apply');
      const copy = e.target.closest('.ai-copy');
      if (apply) {
        window.DLXIDE.setSource(decode(apply));
        apply.textContent = 'Applied ✓';
        apply.insertAdjacentHTML('afterend', '<button class="ai-undo">Undo</button>');
        setTimeout(() => { apply.textContent = 'Apply to editor'; }, 1500);
      } else if (copy) {
        const code = decode(copy);
        (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(
          () => { copy.textContent = 'Copied ✓'; setTimeout(() => copy.textContent = 'Copy', 1200); },
          () => { copy.textContent = 'Copy failed'; }
        );
      } else if (e.target.closest('.ai-undo')) {
        window.DLXIDE.undo(); e.target.closest('.ai-undo').remove();
      }
    });
  }

  /* ----------------------------- boot ---------------------------- */
  function boot() {
    if (!window.DLXIDE || !window.DLX) { setTimeout(boot, 30); return; }
    buildPanel();
    wire();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
