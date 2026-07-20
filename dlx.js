/* ============================================================
 * DLX-Sim — DLX (RISC) assembler + 5-stage pipeline simulator
 * Pure JS, no dependencies. Works in the browser and in Node.
 * Pipeline: IF ID EX MEM WB, in-order, branches resolved in ID.
 * Hazard model (Hennessy & Patterson DLX):
 *   - Register file is written in the first half of WB and read in
 *     the second half of ID (so producer-in-WB never stalls a reader).
 *   - Forwarding ON : EX/MEM and MEM/WB forward into EX;
 *       load-use     -> 1 stall
 *       ALU->branch  -> 1 stall (branch compares in ID)
 *       load->branch -> 2 stalls
 *   - Forwarding OFF: any RAW whose producer is still in EX or MEM stalls.
 *   - Taken branches / jumps flush the instruction being fetched (1 bubble).
 * ============================================================ */
(function (root) {
  'use strict';

  /* ----------------------------- helpers ----------------------------- */
  const s32 = (x) => x | 0;
  const u32 = (x) => x >>> 0;
  const hex = (x, w) => '0x' + u32(x).toString(16).toUpperCase().padStart(w || 8, '0');

  /* ------------------------- instruction set ------------------------- */
  // fmt: RRR  op rd, rs1, rs2      | RRI  op rd, rs1, imm
  //      RI   op rd, imm  (LHI)    | LOAD op rd, off(rb)
  //      STORE op off(rb), rs      | BR   op rs, label
  //      J    op label             | JR   op rs
  //      TRAP op n                 | N    op          (nop/halt)
  const OPS = {};
  function def(name, spec) { OPS[name] = Object.assign({ name }, spec); }

  const rrr = (fn) => ({ fmt: 'RRR', ex: fn });
  const rri = (fn, uimm) => ({ fmt: 'RRI', ex: fn, uimm: !!uimm });

  def('ADD',  rrr((a, b) => s32(a + b)));
  def('ADDU', rrr((a, b) => s32(a + b)));
  def('SUB',  rrr((a, b) => s32(a - b)));
  def('SUBU', rrr((a, b) => s32(a - b)));
  def('AND',  rrr((a, b) => a & b));
  def('OR',   rrr((a, b) => a | b));
  def('XOR',  rrr((a, b) => a ^ b));
  def('SLL',  rrr((a, b) => s32(a << (b & 31))));
  def('SRL',  rrr((a, b) => s32(a >>> (b & 31))));
  def('SRA',  rrr((a, b) => s32(a >> (b & 31))));
  def('SLT',  rrr((a, b) => (a < b ? 1 : 0)));
  def('SGT',  rrr((a, b) => (a > b ? 1 : 0)));
  def('SLE',  rrr((a, b) => (a <= b ? 1 : 0)));
  def('SGE',  rrr((a, b) => (a >= b ? 1 : 0)));
  def('SEQ',  rrr((a, b) => (a === b ? 1 : 0)));
  def('SNE',  rrr((a, b) => (a !== b ? 1 : 0)));
  def('SLTU', rrr((a, b) => (u32(a) < u32(b) ? 1 : 0)));
  def('SGTU', rrr((a, b) => (u32(a) > u32(b) ? 1 : 0)));
  def('MULT', rrr((a, b) => s32(Math.imul(a, b))));
  def('MULTU',rrr((a, b) => s32(Math.imul(a, b))));
  def('DIV',  Object.assign(rrr((a, b) => s32(a / b)), { trapOnZero: true }));
  def('DIVU', Object.assign(rrr((a, b) => s32(u32(a) / u32(b))), { trapOnZero: true }));
  def('MOD',  Object.assign(rrr((a, b) => s32(a % b)), { trapOnZero: true }));
  def('NOR',  rrr((a, b) => s32(~(a | b))));
  OPS.MUL = OPS.MULT; // common textbook alias

  def('ADDI',  rri((a, i) => s32(a + i)));
  def('ADDUI', rri((a, i) => s32(a + i), true));
  def('SUBI',  rri((a, i) => s32(a - i)));
  def('SUBUI', rri((a, i) => s32(a - i), true));
  def('ANDI',  rri((a, i) => a & i, true));
  def('ORI',   rri((a, i) => a | i, true));
  def('XORI',  rri((a, i) => a ^ i, true));
  def('SLLI',  rri((a, i) => s32(a << (i & 31)), true));
  def('SRLI',  rri((a, i) => s32(a >>> (i & 31)), true));
  def('SRAI',  rri((a, i) => s32(a >> (i & 31)), true));
  def('SLTI',  rri((a, i) => (a < i ? 1 : 0)));
  def('SGTI',  rri((a, i) => (a > i ? 1 : 0)));
  def('SLEI',  rri((a, i) => (a <= i ? 1 : 0)));
  def('SGEI',  rri((a, i) => (a >= i ? 1 : 0)));
  def('SEQI',  rri((a, i) => (a === i ? 1 : 0)));
  def('SNEI',  rri((a, i) => (a !== i ? 1 : 0)));
  def('LHI',   { fmt: 'RI', ex: (a, i) => s32(i << 16) });

  def('LW',  { fmt: 'LOAD', size: 4, signed: true });
  def('LH',  { fmt: 'LOAD', size: 2, signed: true });
  def('LHU', { fmt: 'LOAD', size: 2, signed: false });
  def('LB',  { fmt: 'LOAD', size: 1, signed: true });
  def('LBU', { fmt: 'LOAD', size: 1, signed: false });
  def('SW',  { fmt: 'STORE', size: 4 });
  def('SH',  { fmt: 'STORE', size: 2 });
  def('SB',  { fmt: 'STORE', size: 1 });

  def('BEQZ', { fmt: 'BR', cond: (a) => a === 0 });
  def('BNEZ', { fmt: 'BR', cond: (a) => a !== 0 });
  // two-register compare-and-branch (not canonical H&P DLX, but common in
  // textbook problem sets); resolved in ID like BEQZ/BNEZ
  def('BEQ',  { fmt: 'BRR', cond: (a, b) => a === b });
  def('BNE',  { fmt: 'BRR', cond: (a, b) => a !== b });
  def('J',    { fmt: 'J' });
  def('JAL',  { fmt: 'J', link: true });
  def('JR',   { fmt: 'JR' });
  def('JALR', { fmt: 'JR', link: true });

  def('TRAP', { fmt: 'TRAP' });
  def('NOP',  { fmt: 'N' });
  def('HALT', { fmt: 'N', halt: true });

  /* ------------------------------ lexer ------------------------------ */
  function stripComment(line) {
    let out = '';
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        out += c;
        if (c === '\\') { out += line[++i] || ''; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ';' || c === '#') break;
      if (c === '/' && line[i + 1] === '/') break;
      out += c;
    }
    return out;
  }

  function parseReg(tok) {
    const m = /^[Rr]([0-9]|[12][0-9]|3[01])$/.exec(tok.trim());
    return m ? parseInt(m[1], 10) : null;
  }

  const ESCAPES = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, '"': 34, "'": 39 };

  function parseNum(tok, symbols) {
    tok = tok.trim();
    let neg = false;
    if (tok[0] === '-') { neg = true; tok = tok.slice(1).trim(); }
    else if (tok[0] === '+') { tok = tok.slice(1).trim(); }
    let v = null;
    if (/^0[xX][0-9a-fA-F]+$/.test(tok)) v = parseInt(tok, 16);
    else if (/^0[bB][01]+$/.test(tok)) v = parseInt(tok.slice(2), 2);
    else if (/^[0-9]+$/.test(tok)) v = parseInt(tok, 10);
    else if (/^'(\\.|[^\\'])'$/.test(tok)) {
      const inner = tok.slice(1, -1);
      v = inner[0] === '\\' ? (ESCAPES[inner[1]] !== undefined ? ESCAPES[inner[1]] : inner.charCodeAt(1)) : inner.charCodeAt(0);
    } else if (symbols && /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(tok)) {
      if (Object.prototype.hasOwnProperty.call(symbols, tok)) v = symbols[tok];
      else return { err: 'undefined symbol "' + tok + '"' };
    }
    if (v === null) return { err: 'bad number/symbol "' + tok + '"' };
    return { val: s32(neg ? -v : v) };
  }

  function parseString(tok) {
    tok = tok.trim();
    if (tok[0] !== '"' || tok[tok.length - 1] !== '"') return null;
    const bytes = [];
    for (let i = 1; i < tok.length - 1; i++) {
      let c = tok[i];
      if (c === '\\') {
        i++;
        const e = tok[i];
        bytes.push(ESCAPES[e] !== undefined ? ESCAPES[e] : e.charCodeAt(0));
      } else bytes.push(c.charCodeAt(0));
    }
    return bytes;
  }

  // splits operands on commas that are not inside quotes/parens
  function splitOperands(s) {
    const parts = [];
    let cur = '', depth = 0, inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; cur += c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  /* ---------------------------- assembler ---------------------------- */
  const TEXT_BASE = 0x0000;
  const DATA_BASE = 0x1000;
  const MEM_SIZE = 0x10000; // 64 KiB

  function assemble(src) {
    const errors = [];
    const lines = src.split(/\r?\n/);
    const items = []; // parsed line items

    // ---- parse each line into an item ----
    for (let ln = 0; ln < lines.length; ln++) {
      let text = stripComment(lines[ln]).trim();
      if (!text) continue;
      const lineNo = ln + 1;
      // labels (possibly several) at start of line
      const labels = [];
      let m;
      while ((m = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/.exec(text))) {
        labels.push(m[1]);
        text = text.slice(m[0].length).trim();
      }
      if (!text) { items.push({ lineNo, labels }); continue; }

      if (text[0] === '.') {
        const sp = text.indexOf(' ');
        const dir = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
        const rest = sp < 0 ? '' : text.slice(sp + 1).trim();
        items.push({ lineNo, labels, dir, rest });
      } else {
        const sp = text.search(/\s/);
        const mn = (sp < 0 ? text : text.slice(0, sp)).toUpperCase();
        const rest = sp < 0 ? '' : text.slice(sp + 1).trim();
        items.push({ lineNo, labels, mn, rest, raw: text });
      }
    }

    /* ---- pass 1: layout (sizes + label addresses) ---- */
    const symbols = {};
    let seg = 'text';
    let tc = TEXT_BASE, dc = DATA_BASE;
    const err = (lineNo, msg) => errors.push({ line: lineNo, msg });

    // instruction size incl. pseudo-expansion
    function instrWords(it) {
      const mn = it.mn;
      if (mn === 'LI' || mn === 'LA') {
        // may expand to LHI+ORI when value doesn't fit in 16-bit signed imm.
        // Address labels here always fit (mem is 64 KiB, data base 0x1000),
        // but numeric LI can need 2 words. Conservative: decide by literal now.
        const ops = splitOperands(it.rest);
        if (ops.length === 2) {
          const n = parseNum(ops[1], null);
          if (n && n.val !== undefined && (n.val < -32768 || n.val > 32767)) return 2;
          if (n && n.err && /^0[xX]/.test(ops[1].trim()) === false) return 1; // label -> fits
        }
        return 1;
      }
      return 1;
    }

    const pendingLabels = [];   // labels on their own line bind at the NEXT
                                // emitted item, after its alignment
    const bindLabel = (lb, lineNo) => {
      if (Object.prototype.hasOwnProperty.call(symbols, lb)) err(lineNo, 'duplicate label "' + lb + '"');
      symbols[lb] = seg === 'text' ? tc : dc;
    };

    for (const it of items) {
      // .text/.data can carry labels too — bind after possible segment switch
      const segSwitch = it.dir === '.text' || it.dir === '.data' || it.dir === '.org';
      if (it.dir === '.text') { seg = 'text'; if (it.rest) { const n = parseNum(it.rest, null); if (n.val !== undefined) tc = n.val; } }
      else if (it.dir === '.data') { seg = 'data'; if (it.rest) { const n = parseNum(it.rest, null); if (n.val !== undefined) dc = n.val; } }
      else if (it.dir === '.org') { const n = parseNum(it.rest, null); if (n.val !== undefined) { if (seg === 'text') tc = n.val; else dc = n.val; } else err(it.lineNo, n.err); }

      const align = (a) => { if (seg === 'text') tc = (tc + a - 1) & ~(a - 1); else dc = (dc + a - 1) & ~(a - 1); };

      if (it.dir === '.word') align(4);
      if (it.dir === '.half') align(2);
      if (it.dir === '.align') { const n = parseNum(it.rest, null); if (n.val !== undefined) align(1 << n.val); }

      if (!it.mn && !it.dir) {           // label-only line: defer binding
        pendingLabels.push({ lb: it.labels, line: it.lineNo });
        it.addr = seg === 'text' ? tc : dc;
        it.seg = seg;
        continue;
      }
      if (!segSwitch) {
        for (const p of pendingLabels.splice(0)) for (const lb of p.lb) bindLabel(lb, p.line);
      }
      for (const lb of it.labels) bindLabel(lb, it.lineNo);
      it.addr = seg === 'text' ? tc : dc;
      it.seg = seg;

      if (it.mn) {
        if (seg !== 'text') { err(it.lineNo, 'instruction outside .text'); continue; }
        tc += 4 * instrWords(it);
      } else if (it.dir) {
        const ops = it.dir === '.ascii' || it.dir === '.asciiz' ? null : splitOperands(it.rest);
        switch (it.dir) {
          case '.word': dcOrTc(4 * ops.length); break;
          case '.half': dcOrTc(2 * ops.length); break;
          case '.byte': dcOrTc(1 * ops.length); break;
          case '.space': { const n = parseNum(it.rest, null); if (n.val !== undefined) dcOrTc(n.val); else err(it.lineNo, n.err); break; }
          case '.ascii': case '.asciiz': {
            const b = parseString(it.rest);
            if (!b) err(it.lineNo, 'expected quoted string');
            else dcOrTc(b.length + (it.dir === '.asciiz' ? 1 : 0));
            break;
          }
          case '.text': case '.data': case '.org': case '.align': case '.global': case '.globl': break;
          default: err(it.lineNo, 'unknown directive ' + it.dir);
        }
      }
      function dcOrTc(n) { if (seg === 'text') tc += n; else dc += n; }
    }
    // labels at the very end of the file bind at the final location counter
    for (const p of pendingLabels) for (const lb of p.lb) bindLabel(lb, p.line);

    /* ---- pass 2: emit ---- */
    const instrs = [];           // sparse by addr/4
    const dataImage = [];        // {addr, bytes:[..]}
    seg = 'text'; tc = TEXT_BASE; dc = DATA_BASE;

    function emitInstr(addr, op, args, asm, lineNo) {
      instrs[addr >> 2] = { addr, op, ...args, asm, line: lineNo };
    }

    for (const it of items) {
      if (it.dir === '.text') { seg = 'text'; if (it.rest) { const n = parseNum(it.rest, symbols); if (n.val !== undefined) tc = n.val; } continue; }
      if (it.dir === '.data') { seg = 'data'; if (it.rest) { const n = parseNum(it.rest, symbols); if (n.val !== undefined) dc = n.val; } continue; }
      if (it.dir === '.org') { const n = parseNum(it.rest, symbols); if (n.val !== undefined) { if (seg === 'text') tc = n.val; else dc = n.val; } continue; }
      if (!it.mn && !it.dir) continue;

      if (it.dir) {
        // data directives are allowed in both segments; in .text the bytes are
        // placed in memory at the current text address (like real assemblers)
        const put = (bytes) => {
          if (seg === 'data') { dataImage.push({ addr: dc, bytes }); dc += bytes.length; }
          else { dataImage.push({ addr: tc, bytes }); tc += bytes.length; }
        };
        const alignTo = (a) => { if (seg === 'text') tc = (tc + a - 1) & ~(a - 1); else dc = (dc + a - 1) & ~(a - 1); };
        switch (it.dir) {
          case '.word': {
            alignTo(4);
            for (const o of splitOperands(it.rest)) {
              const n = parseNum(o, symbols);
              if (n.val === undefined) { err(it.lineNo, n.err); continue; }
              put([ (n.val >>> 24) & 255, (n.val >>> 16) & 255, (n.val >>> 8) & 255, n.val & 255 ]);
            }
            break;
          }
          case '.half': {
            alignTo(2);
            for (const o of splitOperands(it.rest)) {
              const n = parseNum(o, symbols);
              if (n.val === undefined) { err(it.lineNo, n.err); continue; }
              put([ (n.val >>> 8) & 255, n.val & 255 ]);
            }
            break;
          }
          case '.byte': {
            for (const o of splitOperands(it.rest)) {
              const n = parseNum(o, symbols);
              if (n.val === undefined) { err(it.lineNo, n.err); continue; }
              put([ n.val & 255 ]);
            }
            break;
          }
          case '.space': { const n = parseNum(it.rest, symbols); if (n.val !== undefined) put(new Array(n.val).fill(0)); break; }
          case '.ascii': case '.asciiz': {
            const b = parseString(it.rest);
            if (b) put(it.dir === '.asciiz' ? b.concat([0]) : b);
            break;
          }
          case '.align': { const n = parseNum(it.rest, symbols); if (n.val !== undefined) alignTo(1 << n.val); break; }
        }
        continue;
      }

      // instruction
      let mn = it.mn;
      let ops = splitOperands(it.rest);
      const bad = (msg) => err(it.lineNo, msg + ' — "' + it.raw + '"');

      // pseudo-instructions
      if (mn === 'MOV' || mn === 'MOVE') {
        const rd = parseReg(ops[0] || ''), rs = parseReg(ops[1] || '');
        if (rd === null || rs === null) { bad('MOV needs two registers'); continue; }
        emitInstr(tc, OPS.ADD, { rd, rs1: rs, rs2: 0 }, it.raw, it.lineNo); tc += 4; continue;
      }
      if (mn === 'RET') { emitInstr(tc, OPS.JR, { rs1: 31 }, it.raw, it.lineNo); tc += 4; continue; }
      if (mn === 'LI' || mn === 'LA') {
        const rd = parseReg(ops[0] || '');
        const n = parseNum(ops[1] || '', symbols);
        if (rd === null || n.val === undefined) { bad(mn + ' needs register, value/label'); continue; }
        if (n.val >= -32768 && n.val <= 32767) {
          emitInstr(tc, OPS.ADDI, { rd, rs1: 0, imm: n.val }, it.raw, it.lineNo); tc += 4;
        } else {
          emitInstr(tc, OPS.LHI, { rd, imm: (n.val >>> 16) & 0xffff }, it.raw + '  [LHI]', it.lineNo); tc += 4;
          emitInstr(tc, OPS.ORI, { rd, rs1: rd, imm: n.val & 0xffff }, it.raw + '  [ORI]', it.lineNo); tc += 4;
        }
        continue;
      }

      const op = OPS[mn];
      if (!op) { bad('unknown instruction "' + mn + '"'); continue; }

      const memOperand = (tok) => {
        // off(Rb) | (Rb) | label(Rb) | label | number
        const mm = /^(.*)\(\s*([Rr][0-9]+)\s*\)$/.exec(tok.trim());
        if (mm) {
          const rb = parseReg(mm[2]);
          if (rb === null) return null;
          const offTok = mm[1].trim();
          if (!offTok) return { rb, off: 0 };
          const n = parseNum(offTok, symbols);
          if (n.val === undefined) { bad(n.err); return null; }
          return { rb, off: n.val };
        }
        const n = parseNum(tok, symbols);
        if (n.val === undefined) { bad(n.err); return null; }
        return { rb: 0, off: n.val };
      };

      switch (op.fmt) {
        case 'RRR': {
          const rd = parseReg(ops[0] || ''), a = parseReg(ops[1] || ''), b = parseReg(ops[2] || '');
          if (rd === null || a === null || b === null) { bad(mn + ' needs rd, rs1, rs2'); break; }
          emitInstr(tc, op, { rd, rs1: a, rs2: b }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'RRI': {
          const rd = parseReg(ops[0] || ''), a = parseReg(ops[1] || '');
          const n = parseNum(ops[2] || '', symbols);
          if (rd === null || a === null || n.val === undefined) { bad(mn + ' needs rd, rs1, imm — ' + (n.err || '')); break; }
          let imm = n.val;
          if (op.uimm) imm = imm & 0xffff;
          else if (imm < -32768 || imm > 32767) bad('immediate out of 16-bit signed range');
          emitInstr(tc, op, { rd, rs1: a, imm }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'RI': {
          const rd = parseReg(ops[0] || '');
          const n = parseNum(ops[1] || '', symbols);
          if (rd === null || n.val === undefined) { bad('LHI needs rd, imm16'); break; }
          emitInstr(tc, op, { rd, imm: n.val & 0xffff }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'LOAD': {
          const rd = parseReg(ops[0] || '');
          const mo = ops[1] !== undefined ? memOperand(ops[1]) : null;
          if (rd === null || !mo) { bad(mn + ' needs rd, off(rb)'); break; }
          emitInstr(tc, op, { rd, rs1: mo.rb, imm: mo.off }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'STORE': {
          // classic: SW off(rb), rs   — also accepted: SW rs, off(rb)
          let mo = null, rs = null;
          if (ops.length === 2 && ops[0].indexOf('(') >= 0) { mo = memOperand(ops[0]); rs = parseReg(ops[1] || ''); }
          else if (ops.length === 2 && ops[1] && (ops[1].indexOf('(') >= 0 || parseReg(ops[0]) !== null)) { rs = parseReg(ops[0] || ''); mo = memOperand(ops[1]); }
          else { mo = memOperand(ops[0] || ''); rs = parseReg(ops[1] || ''); }
          if (!mo || rs === null) { bad(mn + ' needs off(rb), rs'); break; }
          emitInstr(tc, op, { rs1: mo.rb, rs2: rs, imm: mo.off }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'BR': {
          const a = parseReg(ops[0] || '');
          const n = parseNum(ops[1] || '', symbols);
          if (a === null || n.val === undefined) { bad(mn + ' needs rs, label — ' + (n.err || '')); break; }
          emitInstr(tc, op, { rs1: a, target: n.val }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'BRR': {
          const a = parseReg(ops[0] || ''), b = parseReg(ops[1] || '');
          const n = parseNum(ops[2] || '', symbols);
          if (a === null || b === null || n.val === undefined) { bad(mn + ' needs rs1, rs2, label — ' + (n.err || '')); break; }
          emitInstr(tc, op, { rs1: a, rs2: b, target: n.val }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'J': {
          const n = parseNum(ops[0] || '', symbols);
          if (n.val === undefined) { bad(mn + ' needs label — ' + (n.err || '')); break; }
          emitInstr(tc, op, { target: n.val, rd: op.link ? 31 : undefined }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'JR': {
          const a = parseReg(ops[0] || '');
          if (a === null) { bad(mn + ' needs rs'); break; }
          emitInstr(tc, op, { rs1: a, rd: op.link ? 31 : undefined }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'TRAP': {
          const n = parseNum(ops[0] || '0', symbols);
          emitInstr(tc, op, { imm: n.val || 0 }, it.raw, it.lineNo); tc += 4;
          break;
        }
        case 'N': {
          emitInstr(tc, op, {}, it.raw, it.lineNo); tc += 4;
          break;
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      instrs,
      dataImage,
      symbols,
      textBase: TEXT_BASE,
      textEnd: tc,
      memSize: MEM_SIZE,
    };
  }

  /* ---------------------------- simulator ---------------------------- */
  const STALL_LIMIT_NOTE = 'possible infinite loop — raise max cycles if intentional';

  class Sim {
    constructor(prog, opts) {
      this.prog = prog;
      this.opts = Object.assign({ forwarding: true, maxRecords: 60000 }, opts || {});
      this.reset();
    }

    reset() {
      this.regs = new Int32Array(32);
      this.mem = new Uint8Array(this.prog.memSize);
      for (const d of this.prog.dataImage) {
        for (let i = 0; i < d.bytes.length; i++) this.mem[(d.addr + i) & (this.prog.memSize - 1)] = d.bytes[i] & 255;
      }
      this.pc = this.prog.textBase;
      this.cycle = 0;
      this.halted = false;
      this.fetchStopped = false;
      this.pcFromRedirect = false;
      this.seq = 0;
      this.stIF = null; this.stID = null; this.stEX = null; this.stMEM = null; this.stWB = null;
      this.records = [];
      this.log = [];
      this.output = '';
      this.lastRegWrite = { reg: -1, cycle: -1 };
      this.lastMemWrite = { addr: -1, size: 0, cycle: -1 };
      this.runtimeError = null;
      this.stats = {
        cycles: 0, instrs: 0, stalls: 0, forwards: 0, flushes: 0,
        stallCauses: { loadUse: 0, branchWait: 0, rawNoFwd: 0 },
        memReads: 0, memWrites: 0, branches: 0, branchesTaken: 0, jumps: 0,
      };
    }

    logev(kind, msg) {
      if (this.log.length < 20000) this.log.push({ c: this.cycle, kind, msg });
    }

    /* ---- memory helpers (big-endian) ---- */
    rd(addr, size, signed) {
      addr = u32(addr);
      if (addr + size > this.mem.length) return this.fault('memory read out of bounds at ' + hex(addr));
      if (addr % size !== 0) return this.fault('unaligned ' + size + '-byte read at ' + hex(addr));
      let v = 0;
      for (let i = 0; i < size; i++) v = (v << 8) | this.mem[addr + i];
      if (signed) {
        if (size === 1) v = (v << 24) >> 24;
        else if (size === 2) v = (v << 16) >> 16;
        else v = s32(v);
      } else v = size === 4 ? s32(v) : v;
      return v;
    }

    wr(addr, size, val) {
      addr = u32(addr);
      if (addr + size > this.mem.length) return this.fault('memory write out of bounds at ' + hex(addr));
      if (addr % size !== 0) return this.fault('unaligned ' + size + '-byte write at ' + hex(addr));
      for (let i = size - 1; i >= 0; i--) { this.mem[addr + i] = val & 255; val >>>= 8; }
      this.lastMemWrite = { addr, size, cycle: this.cycle };
      return 0;
    }

    fault(msg) {
      this.runtimeError = msg;
      this.logev('error', 'RUNTIME ERROR: ' + msg);
      this.halted = true;
      return 0;
    }

    readString(addr) {
      let s = '', a = u32(addr), guard = 0;
      while (a < this.mem.length && this.mem[a] !== 0 && guard++ < 4096) { s += String.fromCharCode(this.mem[a]); a++; }
      return s;
    }

    /* ---- per-dynamic-instruction record ---- */
    makeDyn(instr) {
      const d = {
        seq: this.seq++, addr: instr.addr, asm: instr.asm, line: instr.line,
        op: instr.op, rd: instr.rd, rs1: instr.rs1, rs2: instr.rs2, imm: instr.imm, target: instr.target,
        cells: [], result: 0, memAddr: 0, taken: false, flushed: false,
      };
      if (this.records.length < this.opts.maxRecords) this.records.push(d);
      return d;
    }

    recCell(d, stage) { if (d.cells.length < 4096) d.cells.push([this.cycle, stage]); }

    writesReg(d) {
      if (!d) return false;
      const f = d.op.fmt;
      if (f === 'RRR' || f === 'RRI' || f === 'RI' || f === 'LOAD') return d.rd !== 0;
      if ((f === 'J' || f === 'JR') && d.op.link) return true;
      return false;
    }
    destOf(d) { return (d.op.fmt === 'J' || d.op.fmt === 'JR') && d.op.link ? 31 : d.rd; }

    // registers needed at EX (address/ALU operands)
    exSrcs(d) {
      const f = d.op.fmt;
      if (f === 'RRR') return [d.rs1, d.rs2];
      if (f === 'RRI' || f === 'LOAD' || f === 'STORE') return [d.rs1]; // store: base reg
      return [];
    }
    // registers needed in ID (branch/jump-register comparison)
    idSrcs(d) {
      const f = d.op.fmt;
      if (f === 'BR' || f === 'JR') return [d.rs1];
      if (f === 'BRR') return [d.rs1, d.rs2];
      return [];
    }
    // store data register (needed at MEM)
    memSrc(d) { return d.op.fmt === 'STORE' ? d.rs2 : null; }

    /* ---- hazard detection at ID ---- */
    checkHazard(C, inEX, inMEM) {
      const producers = [inEX, inMEM]; // inWB never stalls (split-phase regfile)
      const conflictsWith = (P, reg) => P && this.writesReg(P) && this.destOf(P) === reg && reg !== 0;

      const nearestProducer = (reg) => {
        if (conflictsWith(inEX, reg)) return { P: inEX, where: 'EX' };
        if (conflictsWith(inMEM, reg)) return { P: inMEM, where: 'MEM' };
        return null;
      };

      if (!this.opts.forwarding) {
        for (const r of [...this.exSrcs(C), ...this.idSrcs(C), this.memSrc(C)].filter((x) => x !== null && x !== 0)) {
          const np = nearestProducer(r);
          if (np) return { cause: 'rawNoFwd', msg: 'RAW hazard on R' + r + ' (no forwarding): waiting for "' + np.P.asm + '"' };
        }
        return null;
      }

      // forwarding enabled
      for (const r of this.idSrcs(C).filter((x) => x !== 0)) {
        const np = nearestProducer(r);
        if (np) {
          if (np.where === 'EX') return { cause: 'branchWait', msg: 'branch/jump needs R' + r + ' in ID: producer "' + np.P.asm + '" still in EX' };
          if (np.where === 'MEM' && np.P.op.fmt === 'LOAD') return { cause: 'branchWait', msg: 'branch/jump needs R' + r + ' in ID: load "' + np.P.asm + '" still in MEM' };
        }
      }
      for (const r of this.exSrcs(C).filter((x) => x !== 0)) {
        if (conflictsWith(inEX, r) && inEX.op.fmt === 'LOAD') {
          return { cause: 'loadUse', msg: 'load-use hazard on R' + r + ': "' + inEX.asm + '" must reach MEM first' };
        }
      }
      return null;
    }

    /* ---- operand fetch with forwarding at EX ---- */
    exOperand(reg, inMEM, inWB) {
      if (reg === 0) return 0;
      if (this.opts.forwarding) {
        if (inMEM && this.writesReg(inMEM) && this.destOf(inMEM) === reg && inMEM.op.fmt !== 'LOAD') {
          this.stats.forwards++; this.logev('forward', 'forward EX/MEM -> EX: R' + reg + ' = ' + inMEM.result + ' (from "' + inMEM.asm + '")');
          return inMEM.result;
        }
        if (inWB && this.writesReg(inWB) && this.destOf(inWB) === reg) {
          this.stats.forwards++; this.logev('forward', 'forward MEM/WB -> EX: R' + reg + ' = ' + inWB.result + ' (from "' + inWB.asm + '")');
          return inWB.result;
        }
      }
      return this.regs[reg];
    }

    idOperand(reg, inMEM, inWB) {
      if (reg === 0) return 0;
      if (this.opts.forwarding) {
        if (inMEM && this.writesReg(inMEM) && this.destOf(inMEM) === reg && inMEM.op.fmt !== 'LOAD') {
          this.stats.forwards++; this.logev('forward', 'forward EX/MEM -> ID (branch): R' + reg + ' = ' + inMEM.result);
          return inMEM.result;
        }
        if (inWB && this.writesReg(inWB) && this.destOf(inWB) === reg) {
          this.stats.forwards++; this.logev('forward', 'forward MEM/WB -> ID (branch): R' + reg + ' = ' + inWB.result);
          return inWB.result;
        }
      }
      return this.regs[reg];
    }

    memStoreValue(reg, inWB) {
      if (reg === 0) return 0;
      if (this.opts.forwarding && inWB && this.writesReg(inWB) && this.destOf(inWB) === reg) {
        this.stats.forwards++; this.logev('forward', 'forward MEM/WB -> MEM (store data): R' + reg + ' = ' + inWB.result);
        return inWB.result;
      }
      return this.regs[reg];
    }

    /* ---- one clock cycle ---- */
    step() {
      if (this.halted) return false;
      this.cycle++;
      this.stats.cycles = this.cycle;

      // cycle-boundary latch update: an instruction fetched last cycle
      // enters the ID stage now (unless a stalled instruction still sits there)
      if (!this.stID && this.stIF) { this.stID = this.stIF; this.stIF = null; }

      const inIF = this.stIF, inID = this.stID, inEX = this.stEX, inMEM = this.stMEM, inWB = this.stWB;

      /* WB */
      if (inWB) {
        this.recCell(inWB, 'WB');
        if (this.writesReg(inWB)) {
          const d = this.destOf(inWB);
          this.regs[d] = inWB.result | 0;
          this.lastRegWrite = { reg: d, cycle: this.cycle };
        }
        if (inWB.op.fmt === 'TRAP' || inWB.op.halt) this.doTrap(inWB);
        this.stats.instrs++;
        this.stWB = null;
        if (this.halted) return true; // trap 0 / fault
      }

      /* MEM */
      if (inMEM) {
        this.recCell(inMEM, 'MEM');
        const op = inMEM.op;
        if (op.fmt === 'LOAD') {
          inMEM.result = this.rd(inMEM.memAddr, op.size, op.signed);
          this.stats.memReads++;
          this.logev('mem', inMEM.asm + ' : loaded ' + inMEM.result + ' from ' + hex(inMEM.memAddr, 4));
        } else if (op.fmt === 'STORE') {
          const v = this.memStoreValue(inMEM.rs2, inWB);
          this.wr(inMEM.memAddr, op.size, v);
          this.stats.memWrites++;
          this.logev('mem', inMEM.asm + ' : stored ' + v + ' to ' + hex(inMEM.memAddr, 4));
        }
        if (this.halted) return true; // memory fault
        this.stWB = inMEM; this.stMEM = null;
      }

      /* EX */
      if (inEX) {
        this.recCell(inEX, 'EX');
        const op = inEX.op;
        if (op.fmt === 'RRR') {
          const a = this.exOperand(inEX.rs1, inMEM, inWB);
          const b = this.exOperand(inEX.rs2, inMEM, inWB);
          if (op.trapOnZero && b === 0) {
            this.fault('division by zero: "' + inEX.asm + '"');
            return true;
          }
          inEX.result = op.ex(a, b) | 0;
        } else if (op.fmt === 'RRI') {
          const a = this.exOperand(inEX.rs1, inMEM, inWB);
          inEX.result = op.ex(a, inEX.imm) | 0;
        } else if (op.fmt === 'RI') {
          inEX.result = op.ex(0, inEX.imm) | 0;
        } else if (op.fmt === 'LOAD' || op.fmt === 'STORE') {
          const a = this.exOperand(inEX.rs1, inMEM, inWB);
          inEX.memAddr = s32(a + inEX.imm);
        }
        this.stMEM = inEX; this.stEX = null;
      }

      /* ID */
      let stalled = false;
      let redirected = false;
      if (inID) {
        const hz = this.checkHazard(inID, inEX, inMEM);
        if (hz) {
          stalled = true;
          this.recCell(inID, 'STALL');
          this.stats.stalls++;
          this.stats.stallCauses[hz.cause]++;
          this.logev('stall', 'STALL "' + inID.asm + '": ' + hz.msg);
        } else {
          this.recCell(inID, 'ID');
          const op = inID.op;
          let redirect = null;
          if (op.fmt === 'BR') {
            const v = this.idOperand(inID.rs1, inMEM, inWB);
            inID.taken = op.cond(v);
            this.stats.branches++; if (inID.taken) this.stats.branchesTaken++;
            if (inID.taken) redirect = inID.target;
            this.logev('branch', inID.asm + ' : ' + (inID.taken ? 'TAKEN -> ' + hex(inID.target, 4) : 'not taken'));
          } else if (op.fmt === 'BRR') {
            const a = this.idOperand(inID.rs1, inMEM, inWB);
            const b = this.idOperand(inID.rs2, inMEM, inWB);
            inID.taken = op.cond(a, b);
            this.stats.branches++; if (inID.taken) this.stats.branchesTaken++;
            if (inID.taken) redirect = inID.target;
            this.logev('branch', inID.asm + ' : ' + (inID.taken ? 'TAKEN -> ' + hex(inID.target, 4) : 'not taken'));
          } else if (op.fmt === 'J') {
            inID.taken = true; redirect = inID.target;
            this.stats.jumps++;
            if (op.link) inID.result = s32(inID.addr + 4);
            this.logev('branch', inID.asm + ' : jump -> ' + hex(inID.target, 4));
          } else if (op.fmt === 'JR') {
            const v = this.idOperand(inID.rs1, inMEM, inWB);
            inID.taken = true; redirect = v;
            this.stats.jumps++;
            if (op.link) inID.result = s32(inID.addr + 4);
            this.logev('branch', inID.asm + ' : jump -> ' + hex(v, 4));
          } else if (op.halt || (op.fmt === 'TRAP' && inID.imm === 0)) {
            // stop fetching; let it drain to WB
            this.fetchStopped = 'halt';
            if (inIF) { this.recCell(inIF, 'FLUSH'); inIF.flushed = true; this.stIF = null; }
          }

          if (redirect !== null) {
            redirected = true;
            this.stats.flushes++;
            if (inIF) {
              this.recCell(inIF, 'FLUSH'); inIF.flushed = true; this.stIF = null;
              this.logev('flush', 'flushed "' + inIF.asm + '" (control transfer)');
            } else {
              // the fetch happening this cycle is squashed — show it as a flushed slot
              const wrong = this.prog.instrs[this.pc >> 2];
              if (wrong && this.pc < this.prog.textEnd) {
                const ph = this.makeDyn(wrong);
                this.recCell(ph, 'FLUSH'); ph.flushed = true;
                this.logev('flush', 'flushed fetch of "' + wrong.asm + '" (control transfer)');
              }
            }
            this.pc = u32(redirect);
            this.pcFromRedirect = true; // next fetch attempt at this PC came from a jump/branch, not linear fall-off
            if (this.fetchStopped === 'end') this.fetchStopped = false; // fall-through past .text end is undone by the jump
          }
          this.stEX = inID; this.stID = null;
        }
      }

      /* IF */
      if (this.stIF) {
        // an already-fetched instruction is waiting for the ID slot
        this.recCell(this.stIF, 'STALL');
      } else if (!redirected && !this.fetchStopped) {
        const idx = this.pc >> 2;
        const instr = this.prog.instrs[idx];
        if (this.pc >= this.prog.textEnd || !instr) {
          if (this.pc >= this.prog.textEnd && !this.pcFromRedirect) {
            // linear fall-off the end of .text: benign (program forgot TRAP 0 / HALT)
            this.fetchStopped = 'end';
            this.logev('info', 'fetch reached end of .text at ' + hex(this.pc, 4) + ' (no HALT/TRAP 0 executed yet)');
          } else if (this.pcFromRedirect) {
            this.fault('fetch from address with no instruction: ' + hex(this.pc, 4) +
              ' (a jump/branch targeted an address with no instruction — likely a bad computed address)');
            return true;
          } else {
            this.fault('fetch from address with no instruction: ' + hex(this.pc, 4) +
              ' (PC ran into data in .text, or the program is missing TRAP 0 / HALT)');
            return true;
          }
        } else {
          this.pcFromRedirect = false;
          const d = this.makeDyn(instr);
          this.recCell(d, 'IF');
          this.stIF = d;
          this.pc = u32(this.pc + 4);
        }
      }

      /* drain detection */
      if (this.fetchStopped && !this.stIF && !this.stID && !this.stEX && !this.stMEM && !this.stWB && !this.halted) {
        this.halted = true;
        this.logev('halt', 'pipeline drained — program ended');
      }
      return true;
    }

    doTrap(d) {
      const n = d.op.halt ? 0 : d.imm | 0;
      switch (n) {
        case 0:
          this.halted = true;
          this.logev('halt', 'TRAP 0 — program halted normally at cycle ' + this.cycle);
          break;
        case 1: { const v = this.regs[1]; this.output += String(v) + '\n'; this.logev('trap', 'TRAP 1 (print int): ' + v); break; }
        case 2: { const s = this.readString(this.regs[1]); this.output += s + '\n'; this.logev('trap', 'TRAP 2 (print string): "' + s + '"'); break; }
        case 3: { const c = String.fromCharCode(this.regs[1] & 255); this.output += c; this.logev('trap', 'TRAP 3 (print char): "' + c + '"'); break; }
        case 4: { const v = this.regs[1]; this.output += hex(v) + '\n'; this.logev('trap', 'TRAP 4 (print hex): ' + hex(v)); break; }
        default: this.logev('trap', 'TRAP ' + n + ' — unknown service (ignored)');
      }
    }

    run(maxCycles) {
      const max = maxCycles || 200000;
      while (!this.halted && this.cycle < max) this.step();
      if (!this.halted) this.logev('error', 'stopped at max cycles (' + max + ') — ' + STALL_LIMIT_NOTE);
      return this.halted;
    }
  }

  /* ------------------------ check evaluation ------------------------- */
  // checks: {kind:'reg',   reg, value}
  //         {kind:'memw'|'memh'|'memb', label|addr, index?, value}
  //         {kind:'mems',  label|addr, value}     (NUL-terminated string)
  //         {kind:'out',   includes}
  function evalChecks(sim, prog, checks) {
    const results = [];
    for (const ck of checks) {
      let addr = ck.addr;
      if (ck.label !== undefined) addr = prog.symbols[ck.label];
      const size = ck.kind === 'memw' ? 4 : ck.kind === 'memh' ? 2 : 1;
      if (ck.index) addr += ck.index * size;
      let actual, pass, expected = ck.value !== undefined ? ck.value : ck.includes;
      switch (ck.kind) {
        case 'reg': actual = sim.regs[ck.reg]; pass = actual === s32(ck.value); break;
        case 'memw': actual = sim.rd(addr, 4, true); pass = actual === s32(ck.value); break;
        case 'memh': actual = sim.rd(addr, 2, true); pass = actual === s32(ck.value); break;
        case 'memb': actual = sim.rd(addr, 1, false); pass = actual === (ck.value & 255); break;
        case 'mems': actual = sim.readString(addr); pass = actual === ck.value; break;
        case 'out': actual = sim.output; pass = sim.output.indexOf(ck.includes) >= 0; break;
        default: actual = '?'; pass = false;
      }
      results.push({ desc: describeCheck(ck), expected, actual, pass });
    }
    return results;
  }

  function describeCheck(ck) {
    const loc = ck.label !== undefined ? ck.label + (ck.index ? '[' + ck.index + ']' : '') : ck.addr !== undefined ? hex(ck.addr, 4) : '';
    switch (ck.kind) {
      case 'reg': return 'R' + ck.reg;
      case 'memw': return 'word ' + loc;
      case 'memh': return 'half ' + loc;
      case 'memb': return 'byte ' + loc;
      case 'mems': return 'string ' + loc;
      case 'out': return 'output contains';
      default: return '?';
    }
  }

  /* --------------------- @expect test directives --------------------- */
  // Any program can declare its own expected results as comments:
  //   ; @expect reg R2 = 55
  //   ; @expect word result = 55         (32-bit word at label)
  //   ; @expect word C[4] = 69           (index scaled by element size)
  //   ; @expect half arr[0] = 1
  //   ; @expect byte buf[2] = 'A'
  //   ; @expect string rev = "ENILEPIP"  (NUL-terminated string at label)
  //   ; @expect output "55"              (program output contains)
  function parseExpects(src) {
    const checks = [];
    const errors = [];
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^[\s;#/]*@expect\s+(reg|word|half|byte|string|output)\s+(.*)$/i.exec(lines[i]);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      const rest = m[2].trim();
      const bad = (msg) => errors.push({ line: i + 1, msg: '@expect: ' + msg });
      if (kind === 'output') {
        const s = /^"((?:\\.|[^"\\])*)"\s*$/.exec(rest);
        if (!s) { bad('output needs a quoted string'); continue; }
        checks.push({ kind: 'out', includes: unescapeStr(s[1]), line: i + 1 });
      } else if (kind === 'reg') {
        const s = /^[Rr](\d+)\s*=\s*(.+)$/.exec(rest);
        const v = s && parseNum(s[2], null);
        if (!s || !v || v.val === undefined) { bad('use: reg R2 = value'); continue; }
        checks.push({ kind: 'reg', reg: parseInt(s[1], 10), value: v.val, line: i + 1 });
      } else if (kind === 'string') {
        const s = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*=\s*"((?:\\.|[^"\\])*)"\s*$/.exec(rest);
        if (!s) { bad('use: string label = "text"'); continue; }
        checks.push({ kind: 'mems', label: s[1], value: unescapeStr(s[2]), line: i + 1 });
      } else {
        const s = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*(?:\[\s*(\d+)\s*\])?\s*=\s*(.+)$/.exec(rest);
        const v = s && parseNum(s[3], null);
        if (!s || !v || v.val === undefined) { bad('use: ' + kind + ' label[idx] = value'); continue; }
        const kmap = { word: 'memw', half: 'memh', byte: 'memb' };
        const ck = { kind: kmap[kind], label: s[1], value: v.val, line: i + 1 };
        if (s[2] !== undefined) ck.index = parseInt(s[2], 10);
        checks.push(ck);
      }
    }
    return { checks, errors };
  }

  function unescapeStr(s) {
    return s.replace(/\\(.)/g, (_, c) => (ESCAPES[c] !== undefined ? String.fromCharCode(ESCAPES[c]) : c));
  }

  // inverse: turn programmatic checks into @expect comment lines
  function checksToDirectives(checks) {
    const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    return checks.map((ck) => {
      switch (ck.kind) {
        case 'reg': return '; @expect reg R' + ck.reg + ' = ' + ck.value;
        case 'memw': return '; @expect word ' + ck.label + (ck.index ? '[' + ck.index + ']' : '') + ' = ' + ck.value;
        case 'memh': return '; @expect half ' + ck.label + (ck.index ? '[' + ck.index + ']' : '') + ' = ' + ck.value;
        case 'memb': return '; @expect byte ' + ck.label + (ck.index ? '[' + ck.index + ']' : '') + ' = ' + ck.value;
        case 'mems': return '; @expect string ' + ck.label + ' = ' + q(ck.value);
        case 'out': return '; @expect output ' + q(ck.includes);
        default: return '';
      }
    }).filter(Boolean);
  }

  const DLX = { assemble, Sim, OPS, evalChecks, parseExpects, checksToDirectives, hex, TEXT_BASE, DATA_BASE, MEM_SIZE };
  root.DLX = DLX;
  if (typeof module !== 'undefined' && module.exports) module.exports = DLX;
})(typeof self !== 'undefined' ? self : globalThis);
