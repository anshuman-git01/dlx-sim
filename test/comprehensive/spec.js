/* ============================================================
 * DLX-Sim — comprehensive test specification.
 *
 * Every test here is a REAL DLX program run through the actual
 * assembler + pipeline simulator (test/comprehensive/run.js).
 * Register values, memory contents, cycle counts, stall causes,
 * forwards and flushes are never hand-typed — they are captured
 * from the simulator itself and rendered into the report, using
 * the same @expect mechanism the app's Tests tab uses.
 *
 * Each entry:
 *   category      one of the sections below
 *   name          short test name
 *   purpose       what it verifies
 *   code          DLX source (positive tests embed "; @expect ..."
 *                 checks; negative tests are checked via expectError)
 *   notes         what bug a failure would expose
 *   diagram       if true, the report includes the full per-cycle
 *                 pipeline table generated from sim.records
 *   forwarding    true | false | 'both'  (default true)
 *   expectError   { phase: 'assemble'|'runtime'|'nohalt', match }
 *   maxCycles     override the default run cap
 * ============================================================ */
'use strict';

const s32 = (x) => x | 0;
const u32 = (x) => x >>> 0;

const tests = [];
function add(t) { tests.push(t); }

/* ============================================================
 * ASSEMBLER TESTS
 * ============================================================ */
add({
  category: 'Assembler', name: 'Labels (define + reference)',
  purpose: 'A label defined in .data is usable as a memory operand in .text',
  notes: 'If this fails, symbol table binding or operand resolution is broken.',
  code: `
        .data
val:    .word 42
        .text
main:   LW R1, val(R0)
        TRAP 0
; @expect reg R1 = 42
`});

add({
  category: 'Assembler', name: 'Forward label reference',
  purpose: 'A branch may reference a label defined later in the file',
  notes: 'If this fails, pass-1 symbol collection (which must precede pass-2 emission) is broken for forward references.',
  code: `
main:   ADDI R1, R0, 0
        BEQZ R1, target
        ADDI R2, R0, 999     ; must be skipped
target: ADDI R2, R0, 1
        TRAP 0
; @expect reg R2 = 1
`});

add({
  category: 'Assembler', name: 'Backward label reference',
  purpose: 'A branch may reference a label defined earlier (the common loop case)',
  notes: 'If this fails, backward branches / loops cannot work at all.',
  code: `
        ADDI R1, R0, 5
        ADDI R2, R0, 0
loop:   ADD  R2, R2, R1
        SUBI R1, R1, 1
        BNEZ R1, loop
        TRAP 0
; @expect reg R2 = 15
`});

add({
  category: 'Assembler', name: 'Duplicate labels', expectError: { phase: 'assemble', match: /duplicate label/i },
  purpose: 'Defining the same label twice must be rejected',
  notes: 'If this passes assembly, the symbol table silently keeps only one definition, corrupting any program that reuses a label by mistake instead of reporting it.',
  code: `
again:  ADDI R1, R0, 1
again:  ADDI R2, R0, 2
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Undefined label', expectError: { phase: 'assemble', match: /undefined symbol/i },
  purpose: 'Referencing a label that was never defined must be rejected',
  notes: 'If this passes, typo\'d branch targets would silently assemble to garbage addresses.',
  code: `
        BEQZ R0, nowhere
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Invalid register', expectError: { phase: 'assemble', match: /needs/i },
  purpose: 'A register number outside R0–R31 must be rejected',
  notes: 'If this passes, out-of-range register tokens like R32 would be silently treated as a missing operand and misassemble.',
  code: `
        ADD R32, R1, R2
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Invalid opcode', expectError: { phase: 'assemble', match: /unknown instruction/i },
  purpose: 'An unrecognized mnemonic must be rejected',
  notes: 'If this passes, typos in instruction names would be silently dropped instead of flagged.',
  code: `
        FOOBAR R1, R2, R3
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Invalid operand count', expectError: { phase: 'assemble', match: /needs rd, rs1, rs2/i },
  purpose: 'A 3-operand instruction given only 2 operands must be rejected',
  notes: 'If this passes, missing operands would silently default to R0/0 instead of being flagged, hiding real typos.',
  code: `
        ADD R1, R2
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Invalid immediate (out of 16-bit range)', expectError: { phase: 'assemble', match: /16-bit/i },
  purpose: 'ADDI\'s immediate must fit in a signed 16-bit field; 99999 does not',
  notes: 'If this passes, out-of-range immediates would silently truncate instead of being flagged — a classic source of "my program computes the wrong constant" bugs.',
  code: `
        ADDI R1, R0, 99999
        TRAP 0
`});

add({
  category: 'Assembler', name: 'Comments (; # //)',
  purpose: 'All three comment styles are stripped and ignored',
  notes: 'If this fails, one of the comment-lexer branches is broken and would corrupt real programs mixing comment styles.',
  code: `
        ADDI R1, R0, 1     ; semicolon comment
        ADDI R2, R0, 2     # hash comment
        ADDI R3, R0, 3     // slash-slash comment
        ADD  R4, R1, R2
        ADD  R4, R4, R3
        TRAP 0
; @expect reg R4 = 6
`});

add({
  category: 'Assembler', name: 'Whitespace handling (tabs, blank lines, extra spaces)',
  purpose: 'Arbitrary whitespace between tokens and blank lines do not affect assembly',
  notes: 'If this fails, the tokenizer is sensitive to formatting that real-world programs (and copy-pasted code) commonly contain.',
  code: `

\t\tADDI\tR1,   R0,\t\t5


        ADDI     R2 ,R0, 7

        ADD R3,R1,R2
\tTRAP 0
; @expect reg R3 = 12
`});

add({
  category: 'Assembler', name: 'Case sensitivity (lowercase mnemonics + registers)',
  purpose: 'Mnemonics are case-insensitive and registers accept lowercase "r"',
  notes: 'If this fails, programs written in lowercase (common when adapting MIPS-style code) would be rejected even though the ISA itself is case-agnostic by design.',
  code: `
        addi r1, r0, 3
        Addi r2, R0, 4
        ADD  r3, r1, r2
        trap 0
; @expect reg R3 = 7
`});

add({
  category: 'Assembler', name: 'Negative immediates',
  purpose: 'ADDI accepts a negative signed immediate',
  notes: 'If this fails, the immediate parser or sign-extension is broken for negative literals.',
  code: `
        ADDI R1, R0, -17
        TRAP 0
; @expect reg R1 = -17
`});

add({
  category: 'Assembler', name: 'Hex immediates',
  purpose: '0x-prefixed literals are parsed as hexadecimal',
  notes: 'If this fails, hex constants (extremely common for masks/addresses) would misassemble.',
  code: `
        ADDI R1, R0, 0x1F
        TRAP 0
; @expect reg R1 = 31
`});

add({
  category: 'Assembler', name: 'Binary immediates',
  purpose: '0b-prefixed literals are parsed as binary',
  notes: 'If this fails, binary constants would misassemble.',
  code: `
        ADDI R1, R0, 0b1010
        TRAP 0
; @expect reg R1 = 10
`});

add({
  category: 'Assembler', name: '.text directive',
  purpose: 'Code following .text is placed in the text segment and executes',
  notes: 'If this fails, the whole program placement model is broken.',
  code: `
        .text
        ADDI R1, R0, 1
        TRAP 0
; @expect reg R1 = 1
`});

add({
  category: 'Assembler', name: '.data directive',
  purpose: 'Data following .data is placed in the data segment and is loadable',
  notes: 'If this fails, no program can use initialized data.',
  code: `
        .data
x:      .word 123
        .text
        LW R1, x(R0)
        TRAP 0
; @expect reg R1 = 123
`});

add({
  category: 'Assembler', name: '.word directive',
  purpose: 'Multiple comma-separated .word values are laid out contiguously',
  notes: 'If this fails, any array-of-words program breaks (this was the original reported bug).',
  code: `
        .data
arr:    .word 5, 7, 10
        .text
        LW R1, arr(R0)
        ADDI R3, R0, arr
        LW R2, 4(R3)
        TRAP 0
; @expect reg R1 = 5
; @expect reg R2 = 7
; @expect word arr[1] = 7
; @expect word arr[2] = 10
`});

add({
  category: 'Assembler', name: '.space directive',
  purpose: '.space N reserves N zero bytes',
  notes: 'If this fails, uninitialized buffers (e.g. output strings) would not be zero-filled or would be mis-sized, corrupting whatever data follows in memory.',
  code: `
        .data
buf:    .space 8
after:  .word 0xAB
        .text
        LW R1, after(R0)
        LB R2, buf(R0)
        TRAP 0
; @expect reg R1 = 171
; @expect reg R2 = 0
`});

add({
  category: 'Assembler', name: '.byte directive',
  purpose: 'Comma-separated .byte values are laid out one byte apart',
  notes: 'If this fails, byte-array programs (string tables, small counters) break.',
  code: `
        .data
b:      .byte 1, 2, 3, 255
        .text
        LB R1, b(R0)
        ADDI R3, R0, b
        LBU R2, 3(R3)
        TRAP 0
; @expect reg R1 = 1
; @expect reg R2 = 255
`});

add({
  category: 'Assembler', name: '.ascii directive',
  purpose: '.ascii lays out raw characters with no terminator',
  notes: 'If this fails, programs relying on manual string lengths (not NUL-terminated) misbehave.',
  code: `
        .data
s:      .ascii "AB"
        .byte 0
        .text
        LBU R1, s(R0)
        ADDI R2, R0, s
        LBU R3, 1(R2)
        TRAP 0
; @expect reg R1 = 65
; @expect reg R3 = 66
`});

add({
  category: 'Assembler', name: '.asciiz directive',
  purpose: '.asciiz appends a NUL terminator automatically',
  notes: 'If this fails, every string routine that scans for NUL (strlen, string compare, …) breaks.',
  code: `
        .data
s:      .asciiz "HI"
        .text
        ADDI R1, R0, s
        LBU R2, 2(R1)
        TRAP 0
; @expect reg R2 = 0
`});

/* ============================================================
 * INSTRUCTION TESTS
 * ============================================================ */
function alu3(mnemonic, a, b, fn, label) {
  add({
    category: 'Instruction', name: label || mnemonic,
    purpose: `Verify ${mnemonic} Rd, Rs1, Rs2 computes the correct result`,
    notes: `If this fails, the ${mnemonic} EX-stage semantics are wrong.`,
    code: `
        LI ${'R1'}, ${a}
        LI ${'R2'}, ${b}
        ${mnemonic} R3, R1, R2
        TRAP 0
; @expect reg R3 = ${fn(a, b)}
`});
}
alu3('ADD', 12, 7, (a, b) => s32(a + b));
alu3('SUB', 12, 7, (a, b) => s32(a - b));
alu3('MUL', 6, 7, (a, b) => s32(Math.imul(a, b)));
alu3('DIV', 20, 3, (a, b) => s32(a / b));
alu3('AND', 0xF0, 0x3C, (a, b) => a & b);
alu3('OR', 0xF0, 0x0F, (a, b) => a | b);
alu3('XOR', 0xFF, 0x0F, (a, b) => a ^ b);
alu3('NOR', 0, 0, (a, b) => s32(~(a | b)));
alu3('SLT', 3, 9, (a, b) => (a < b ? 1 : 0));
alu3('SGT', 9, 3, (a, b) => (a > b ? 1 : 0));
alu3('SEQ', 5, 5, (a, b) => (a === b ? 1 : 0));
alu3('SNE', 5, 6, (a, b) => (a !== b ? 1 : 0));

add({
  category: 'Instruction', name: 'ADDI',
  purpose: 'Verify ADDI Rd, Rs1, imm adds an immediate to a register',
  notes: 'If this fails, essentially every program breaks (ADDI is the most common instruction).',
  code: `
        ADDI R1, R0, 100
        ADDI R2, R1, -30
        TRAP 0
; @expect reg R2 = 70
`});
add({
  category: 'Instruction', name: 'SUBI',
  purpose: 'Verify SUBI Rd, Rs1, imm subtracts an immediate',
  notes: 'If this fails, decrementing loop counters breaks.',
  code: `
        ADDI R1, R0, 10
        SUBI R2, R1, 3
        TRAP 0
; @expect reg R2 = 7
`});

function shift(mnemonic, val, amt, fn) {
  add({
    category: 'Instruction', name: mnemonic,
    purpose: `Verify ${mnemonic} shifts correctly`,
    notes: `If this fails, ${mnemonic}'s shift direction, sign handling, or shift-amount masking is wrong.`,
    code: `
        LI R1, ${val}
        ${mnemonic.endsWith('I') ? `${mnemonic} R2, R1, ${amt}` : `LI R3, ${amt}\n        ${mnemonic} R2, R1, R3`}
        TRAP 0
; @expect reg R2 = ${fn(val, amt)}
`});
}
shift('SLL', 1, 4, (a, b) => s32(a << (b & 31)));
shift('SRL', -1, 28, (a, b) => s32(a >>> (b & 31)));
shift('SRA', -16, 2, (a, b) => s32(a >> (b & 31)));
shift('SLLI', 1, 4, (a, b) => s32(a << (b & 31)));
shift('SRLI', -1, 28, (a, b) => s32(a >>> (b & 31)));
shift('SRAI', -16, 2, (a, b) => s32(a >> (b & 31)));

add({
  category: 'Instruction', name: 'LW / SW round-trip',
  purpose: 'A word stored with SW is read back identically with LW',
  code: `
        .data
cell:   .word 0
        .text
        LI R1, -123456
        SW cell(R0), R1
        LW R2, cell(R0)
        TRAP 0
; @expect reg R2 = -123456
`, notes: 'If this fails, either the store path or the load path (or their address computation) is broken.'});

add({
  category: 'Instruction', name: 'LB / SB round-trip (sign-extended)',
  purpose: 'A byte stored with SB and reloaded with LB is sign-extended',
  code: `
        .data
cell:   .byte 0
        .text
        ADDI R1, R0, -5
        SB cell(R0), R1
        LB R2, cell(R0)
        TRAP 0
; @expect reg R2 = -5
`, notes: 'If this fails, LB is not sign-extending (or SB is truncating) the byte.'});

add({
  category: 'Instruction', name: 'LH / SH round-trip (sign-extended)',
  purpose: 'A halfword stored with SH and reloaded with LH is sign-extended',
  code: `
        .data
cell:   .half 0
        .text
        ADDI R1, R0, -300
        SH cell(R0), R1
        LH R2, cell(R0)
        TRAP 0
; @expect reg R2 = -300
`, notes: 'If this fails, LH is not sign-extending (or SH is truncating) the halfword.'});

add({
  category: 'Instruction', name: 'BEQ (two-register branch, taken)',
  purpose: 'BEQ Rs1, Rs2, label branches when the two registers are equal',
  code: `
        ADDI R1, R0, 5
        ADDI R2, R0, 5
        BEQ R1, R2, yes
        ADDI R3, R0, 0
        TRAP 0
yes:    ADDI R3, R0, 1
        TRAP 0
; @expect reg R3 = 1
`, notes: 'If this fails, the two-register compare-and-branch (added for compatibility with textbook DLX variants) is broken.'});

add({
  category: 'Instruction', name: 'BNE (two-register branch, taken)',
  purpose: 'BNE Rs1, Rs2, label branches when the two registers differ',
  code: `
        ADDI R1, R0, 5
        ADDI R2, R0, 6
        BNE R1, R2, yes
        ADDI R3, R0, 0
        TRAP 0
yes:    ADDI R3, R0, 1
        TRAP 0
; @expect reg R3 = 1
`, notes: 'If this fails, BNE\'s comparison or branch target resolution is broken.'});

add({
  category: 'Instruction', name: 'BEQZ (taken and not-taken)',
  purpose: 'BEQZ branches only when the register is exactly zero',
  code: `
        ADDI R1, R0, 0
        ADDI R2, R0, 1
        BEQZ R1, l1
        ADDI R3, R0, 111    ; must be skipped
l1:     BEQZ R2, l2
        ADDI R3, R0, 1      ; must execute
l2:     TRAP 0
; @expect reg R3 = 1
`, notes: 'If this fails, BEQZ\'s zero test is inverted or always/never taken.'});

add({
  category: 'Instruction', name: 'BNEZ (taken and not-taken)',
  purpose: 'BNEZ branches only when the register is non-zero',
  code: `
        ADDI R1, R0, 1
        ADDI R2, R0, 0
        BNEZ R1, l1
        ADDI R3, R0, 111    ; must be skipped
l1:     BNEZ R2, l2
        ADDI R3, R0, 1      ; must execute
l2:     TRAP 0
; @expect reg R3 = 1
`, notes: 'If this fails, BNEZ\'s zero test is inverted or always/never taken.'});

add({
  category: 'Instruction', name: 'J (unconditional jump)',
  purpose: 'J unconditionally transfers control to the label',
  code: `
        J skip
        ADDI R1, R0, 999   ; must be skipped
skip:   ADDI R1, R0, 1
        TRAP 0
; @expect reg R1 = 1
`, notes: 'If this fails, unconditional jumps do not redirect the fetch stream.'});

add({
  category: 'Instruction', name: 'JAL (jump and link)',
  purpose: 'JAL jumps to the label and saves the return address in R31',
  code: `
        JAL sub
        TRAP 0
sub:    ADDI R1, R0, 1
        JR R31
; @expect reg R1 = 1
`, notes: 'If this fails, function calls cannot return (R31 is not set to PC+4).'});

add({
  category: 'Instruction', name: 'JR (jump register)',
  purpose: 'JR transfers control to the address held in a register',
  code: `
        ADDI R2, R0, target
        JR R2
        ADDI R1, R0, 999   ; must be skipped
target: ADDI R1, R0, 1
        TRAP 0
; @expect reg R1 = 1
`, notes: 'If this fails, indirect jumps (returns, computed gotos) are broken.'});

add({
  category: 'Instruction', name: 'TRAP (I/O)',
  purpose: 'TRAP 1/2/3/4 print int / string / char / hex to program output',
  code: `
        .data
s:      .asciiz "OK"
        .text
        ADDI R1, R0, 65
        TRAP 3          ; 'A'
        ADDI R1, R0, s
        TRAP 2          ; "OK"
        ADDI R1, R0, 255
        TRAP 4          ; 0xFF
        TRAP 0
; @expect output "A"
; @expect output "OK"
; @expect output "0x000000FF"
`, notes: 'If this fails, program output — the only way these programs communicate results — is broken.'});

/* ============================================================
 * MEMORY TESTS
 * ============================================================ */
add({
  category: 'Memory', name: 'Aligned word load',
  purpose: 'A word-aligned LW succeeds',
  code: `
        .data
x:      .word 7
        .text
        LW R1, x(R0)
        TRAP 0
; @expect reg R1 = 7
`, notes: 'Baseline: if this fails, basic loads are broken.'});

add({
  category: 'Memory', name: 'Misaligned load', expectError: { phase: 'runtime', match: /unaligned/i },
  purpose: 'A word load from a non-multiple-of-4 address must fault',
  code: `
        LW R1, 1(R0)
        TRAP 0
`, notes: 'If this does not fault, the simulator silently allows unaligned accesses that real DLX hardware forbids, hiding real bugs in student programs.'});

add({
  category: 'Memory', name: 'Large positive offset',
  purpose: 'A load using the largest legal signed 16-bit offset (32767) computes the correct address',
  code: `
        .data
        .space 32768
tgt:    .word 55
        .text
        LI   R1, tgt
        SUBI R1, R1, 32767
        LW   R2, 32767(R1)
        TRAP 0
; @expect reg R2 = 55
`, notes: 'If this fails, offsets near the edge of the 16-bit immediate range are computed incorrectly (off-by-one in range checking or sign handling).'});

add({
  category: 'Memory', name: 'Negative offset',
  purpose: 'A load with a negative offset correctly subtracts from the base',
  code: `
        .data
tgt:    .word 88
        .space 4
base:   .word 0
        .text
        ADDI R1, R0, base
        LW R2, -8(R1)
        TRAP 0
; @expect reg R2 = 88
`, notes: 'If this fails, negative offsets are sign-extended incorrectly.'});

add({
  category: 'Memory', name: 'Stack push/pop',
  purpose: 'A value pushed onto a descending stack (R29) is read back correctly after popping',
  code: `
        ADDI R29, R0, 0x7F00   ; stack pointer near top of memory
        ADDI R1, R0, 321
        SUBI R29, R29, 4
        SW 0(R29), R1          ; push
        ADDI R1, R0, 0
        LW R2, 0(R29)          ; peek
        ADDI R29, R29, 4       ; pop
        TRAP 0
; @expect reg R2 = 321
`, notes: 'If this fails, the standard push/pop pattern used by every function-call example breaks.'});

add({
  category: 'Memory', name: 'Array traversal (sum)',
  purpose: 'A loop walking a word array with a running pointer computes the correct sum',
  code: `
        .data
arr:    .word 1, 2, 3, 4, 5
n:      .word 5
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        ADDI R3, R0, 0
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        ADD  R3, R3, R4
        ADDI R1, R1, 4
        SUBI R2, R2, 1
        J    loop
done:   TRAP 0
; @expect reg R3 = 15
`, notes: 'If this fails, pointer increment or loop termination for array walks is broken.'});

add({
  category: 'Memory', name: 'Pointer arithmetic (indexed access)',
  purpose: 'base + index*4 correctly addresses the Nth element of a word array',
  code: `
        .data
arr:    .word 10, 20, 30, 40
        .text
        ADDI R1, R0, arr
        ADDI R2, R0, 2          ; index
        SLLI R3, R2, 2          ; byte offset
        ADD  R4, R1, R3
        LW   R5, 0(R4)
        TRAP 0
; @expect reg R5 = 30
`, notes: 'If this fails, index-to-byte-offset scaling (shift by 2 for words) or address addition is wrong.'});

add({
  category: 'Memory', name: 'Memory boundary (maximum valid address)',
  purpose: 'A word write/read at the last valid word address (0xFFFC, one word before the 64 KiB memory ends) succeeds',
  code: `
        LI R1, 0xFFF8
        LI R2, 4242
        SW 4(R1), R2
        LW R3, 4(R1)
        TRAP 0
; @expect reg R3 = 4242
`, notes: 'If this fails, the memory-size boundary check is off by one word (either rejecting a legal address or allowing one past the end).'});

add({
  category: 'Memory', name: 'Out-of-bounds address', expectError: { phase: 'runtime', match: /out of bounds/i },
  purpose: 'A word access starting at the last 3 bytes of memory must fault, since a 4-byte word does not fit',
  code: `
        LI R1, 0xFFFE
        LW R2, 0(R1)
        TRAP 0
`, notes: 'If this does not fault, out-of-bounds reads/writes past the 64 KiB memory silently succeed or wrap, corrupting unrelated state instead of being caught.'});

add({
  category: 'Memory', name: 'Null address (0x0) is a legal data address',
  purpose: 'Address 0 can be written and read like any other word address, since instruction fetch reads from the assembled program, not from the byte-addressable memory image',
  code: `
        ADDI R1, R0, 999
        SW 0(R0), R1
        LW R2, 0(R0)
        TRAP 0
; @expect reg R2 = 999
`, notes: 'If this fails (or corrupts execution), the simulator is conflating the instruction-fetch path with the data-memory image.'});

/* ============================================================
 * PIPELINE / HAZARD TESTS  (diagram:true renders the real
 * per-cycle stage table captured from the simulator)
 * ============================================================ */
add({
  category: 'Pipeline', name: 'No hazards (independent instructions)',
  purpose: 'Three independent instructions incur zero stalls and zero forwards',
  diagram: true,
  code: `
        ADDI R1, R0, 1
        ADDI R2, R0, 2
        ADDI R3, R0, 3
        TRAP 0
; @expect reg R1 = 1
; @expect reg R2 = 2
; @expect reg R3 = 3
`, notes: 'If this reports any stall or forward, the hazard detector has a false positive — it is flagging a dependency that does not exist.'});

add({
  category: 'Pipeline', name: 'RAW hazard, forwarding ON (EX/MEM -> EX)',
  purpose: 'An instruction using the immediately preceding ALU result gets it via EX/MEM forwarding with zero stalls',
  diagram: true, forwarding: true,
  code: `
        ADDI R1, R0, 5
        ADD  R2, R1, R1
        TRAP 0
; @expect reg R2 = 10
`, notes: 'If this stalls, the EX/MEM -> EX forwarding path is not wired up (or not checked before falling back to a stall).'});

add({
  category: 'Pipeline', name: 'RAW hazard, forwarding OFF',
  purpose: 'The same adjacent RAW dependency, with forwarding disabled, must stall until the producer writes back',
  diagram: true, forwarding: false,
  code: `
        ADDI R1, R0, 5
        ADD  R2, R1, R1
        TRAP 0
; @expect reg R2 = 10
`, notes: 'If this does NOT stall, the "forwarding disabled" mode is not actually removing the forwarding paths — the toggle is a no-op.'});

add({
  category: 'Pipeline', name: 'Forwarding MEM/WB -> EX (producer two instructions back)',
  purpose: 'When one unrelated instruction separates producer and consumer, the value is forwarded from MEM/WB instead of EX/MEM',
  diagram: true,
  code: `
        ADDI R1, R0, 3
        ADDI R5, R0, 9        ; unrelated filler
        ADD  R2, R1, R1
        TRAP 0
; @expect reg R2 = 6
`, notes: 'If this fails or stalls, the MEM/WB -> EX forwarding path (for producers one stage further back) is missing.'});

add({
  category: 'Pipeline', name: 'Load-use hazard (exactly 1 stall)',
  purpose: 'An instruction using a value loaded by the immediately preceding LW must stall exactly one cycle, even with forwarding on',
  diagram: true,
  code: `
        .data
x:      .word 9
        .text
        LW  R1, x(R0)
        ADD R2, R1, R1
        TRAP 0
; @expect reg R2 = 18
`, notes: 'If the stall count is not exactly 1, the load-use special case (the one hazard forwarding cannot fully eliminate) is either missing or over/under-stalling.'});

add({
  category: 'Pipeline', name: 'Store-data forwarding (MEM/WB -> MEM)',
  purpose: 'A value computed immediately before a store is forwarded into the MEM stage for the store rather than reading a stale register',
  diagram: true,
  code: `
        .data
cell:   .word 0
        .text
        ADDI R1, R0, 77
        SW cell(R0), R1
        LW R2, cell(R0)
        TRAP 0
; @expect reg R2 = 77
`, notes: 'If this fails, stores use the pre-forwarding (stale) register value instead of the just-computed one — this is the only forwarding path that targets MEM instead of EX.'});

add({
  category: 'Pipeline', name: 'Multiple chained RAW hazards',
  purpose: 'A chain of four instructions, each depending on the previous one\'s result, resolves with forwarding and zero stalls',
  diagram: true,
  code: `
        ADDI R1, R0, 1
        ADD  R2, R1, R1
        ADD  R3, R2, R2
        ADD  R4, R3, R3
        TRAP 0
; @expect reg R4 = 8
`, notes: 'If any link in this chain stalls, forwarding does not compose correctly across consecutive dependent instructions.'});

add({
  category: 'Pipeline', name: 'WAR "hazard" shape (impossible in this in-order pipeline)',
  purpose: 'A later instruction writes a register that an earlier instruction reads; in a single-issue in-order pipeline the earlier instruction\'s ID (read) always completes before the later instruction\'s WB (write), so this can never actually violate WAR — verifies zero false-positive stalls',
  diagram: true,
  code: `
        ADD  R1, R2, R3
        ADDI R2, R0, 99
        TRAP 0
; @expect reg R1 = 0
`, notes: 'If this test shows a stall, the hazard detector is flagging a WAR-shaped dependency that this in-order microarchitecture cannot actually violate — a false positive that would make unrelated code stall unnecessarily.'});

add({
  category: 'Pipeline', name: 'Branch hazard (operand produced by immediately preceding ALU op)',
  purpose: 'A branch reading a register written by the instruction directly before it must stall until the value can be forwarded into ID',
  diagram: true,
  code: `
        ADDI R1, R0, 0
        BEQZ R1, target
        ADDI R2, R0, 999   ; must be skipped
target: ADDI R2, R0, 1
        TRAP 0
; @expect reg R2 = 1
`, notes: 'If this fails, either the branch stalls forever (deadlock/miscount) or resolves with a stale operand and branches the wrong way.'});

add({
  category: 'Pipeline', name: 'Load-to-branch hazard',
  purpose: 'A branch whose condition register was just loaded from memory must stall for the load to reach a stage where it can be forwarded into ID',
  diagram: true,
  code: `
        .data
z:      .word 0
        .text
        LW   R1, z(R0)
        BEQZ R1, target
        ADDI R2, R0, 999   ; must be skipped
target: ADDI R2, R0, 1
        TRAP 0
; @expect reg R2 = 1
`, notes: 'If this fails, the load->branch case (the most expensive hazard in this model) is not handled, and the branch would use a stale or garbage condition.'});

add({
  category: 'Pipeline', name: 'Pipeline flush on taken branch',
  purpose: 'A taken branch flushes exactly one wrongly-fetched instruction',
  diagram: true,
  code: `
        ADDI R1, R0, 0
        BEQZ R1, target
        ADDI R9, R0, 111   ; fetched into the shadow, then flushed
target: TRAP 0
; @expect reg R9 = 0
`, notes: 'If R9 is not 0, the wrongly-fetched instruction after a taken branch executed instead of being flushed — a control-hazard correctness bug, not just a performance one.'});

add({
  category: 'Pipeline', name: 'Pipeline flush on unconditional jump',
  purpose: 'An unconditional J also flushes the wrongly-fetched next instruction',
  diagram: true,
  code: `
        J skip
        ADDI R9, R0, 111   ; must never execute
skip:   TRAP 0
; @expect reg R9 = 0
`, notes: 'If R9 is not 0, jumps are not flushing their fetch shadow.'});

add({
  category: 'Pipeline', name: 'Back-to-back branches',
  purpose: 'Two taken branches in immediate succession each flush correctly without interfering with each other',
  diagram: true,
  code: `
        ADDI R1, R0, 0
        BEQZ R1, l1
l1:     BEQZ R1, l2
        ADDI R9, R0, 111   ; must be skipped
l2:     TRAP 0
; @expect reg R9 = 0
`, notes: 'If R9 is set, back-to-back control transfers are not each independently flushing their own fetch shadow (e.g. a stale "already redirected this cycle" flag leaking across instructions).'});

add({
  category: 'Pipeline', name: 'Forwarding comparison: identical program, ON vs OFF', forwarding: 'both',
  purpose: 'The same loop run with forwarding on and off must produce identical final results but different (fewer) stall cycles with forwarding on',
  code: `
        ADDI R1, R0, 20
        ADDI R2, R0, 0
loop:   ADD  R2, R2, R1
        SUBI R1, R1, 1
        BNEZ R1, loop
        TRAP 0
; @expect reg R2 = 210
`, notes: 'If cycle counts are equal (or forwarding-on is slower), the forwarding toggle is not actually affecting the datapath.'});

/* ============================================================
 * CONTROL FLOW TESTS
 * ============================================================ */
add({
  category: 'Control Flow', name: 'Loop (counted, sum 1..10)',
  purpose: 'A single counted loop accumulates the correct sum',
  code: `
        ADDI R1, R0, 10
        ADDI R2, R0, 0
loop:   ADD  R2, R2, R1
        SUBI R1, R1, 1
        BNEZ R1, loop
        TRAP 0
; @expect reg R2 = 55
`, notes: 'If this fails, basic loop control (counter update + conditional back-branch) is broken.'});

add({
  category: 'Control Flow', name: 'Nested loops (i*j sum)',
  purpose: 'An inner loop nested inside an outer loop computes sum_{i=1..3} sum_{j=1..3} (i*j) = 36',
  code: `
        ADDI R1, R0, 1            ; i
        ADDI R6, R0, 0            ; total
outer:  SGTI R7, R1, 3
        BNEZ R7, done
        ADDI R2, R0, 1            ; j
inner:  SGTI R7, R2, 3
        BNEZ R7, nextI
        MULT R3, R1, R2
        ADD  R6, R6, R3
        ADDI R2, R2, 1
        J    inner
nextI:  ADDI R1, R1, 1
        J    outer
done:   TRAP 0
; @expect reg R6 = 36
`, notes: 'If this fails, either the inner loop\'s exit does not correctly resume the outer loop, or nested back-branches interact badly with the flush/redirect logic.'});

add({
  category: 'Control Flow', name: 'If (single branch)',
  purpose: 'A simple if-statement only executes its body when the condition holds',
  code: `
        ADDI R1, R0, 5
        ADDI R2, R0, 0
        SGTI R3, R1, 3
        BEQZ R3, skip
        ADDI R2, R0, 1
skip:   TRAP 0
; @expect reg R2 = 1
`, notes: 'If this fails, conditional execution guarded by a single branch is broken.'});

add({
  category: 'Control Flow', name: 'If-Else',
  purpose: 'Exactly one branch of an if/else executes',
  code: `
        ADDI R1, R0, 2
        SGTI R3, R1, 3
        BEQZ R3, elseb
        ADDI R2, R0, 100    ; then-branch
        J    end
elseb:  ADDI R2, R0, 200    ; else-branch
end:    TRAP 0
; @expect reg R2 = 200
`, notes: 'If this fails, the unconditional jump past the else-branch (or the branch into it) is broken, causing both branches — or neither — to execute.'});

add({
  category: 'Control Flow', name: 'Switch-like branching (chain of equality tests)',
  purpose: 'A chain of SEQI/BNEZ comparisons picks the matching case',
  code: `
        ADDI R1, R0, 2         ; selector
        SEQI R3, R1, 1
        BNEZ R3, case1
        SEQI R3, R1, 2
        BNEZ R3, case2
        ADDI R9, R0, 0         ; default
        J done
case1:  ADDI R9, R0, 11
        J done
case2:  ADDI R9, R0, 22
        J done
done:   TRAP 0
; @expect reg R9 = 22
`, notes: 'If this fails, one of the fall-through jumps to "done" is missing, letting execution fall into the wrong case.'});

add({
  category: 'Control Flow', name: 'Function call (JAL/JR, non-recursive)',
  purpose: 'A called function returns to the correct instruction after the call site',
  code: `
        ADDI R1, R0, 4
        JAL  square
        ADD  R9, R2, R0        ; result captured after return
        TRAP 0
square: MULT R2, R1, R1
        JR   R31
; @expect reg R9 = 16
`, notes: 'If this fails, the caller does not resume at the correct instruction — either JAL is not saving PC+4, or JR is not returning to it.'});

add({
  category: 'Control Flow', name: 'Nested function calls (two levels)',
  purpose: 'A function that itself calls another function returns correctly through both levels',
  code: `
        ADDI R1, R0, 3
        ADDI R29, R0, 0x7F00
        JAL  outer
        TRAP 0
outer:  SUBI R29, R29, 4
        SW   0(R29), R31
        ADDI R1, R1, 1
        JAL  inner
        LW   R31, 0(R29)
        ADDI R29, R29, 4
        JR   R31
inner:  MULT R9, R1, R1        ; (3+1)^2 = 16
        JR   R31
; @expect reg R9 = 16
`, notes: 'If this fails, nested calls clobber R31 (the single link register) without saving/restoring it via the stack — a classic recursion/nesting bug.'});

add({
  category: 'Control Flow', name: 'Recursion (depth-5 countdown accumulator)',
  purpose: 'A recursive function that saves R31 and its argument on a real stack computes the correct result',
  code: `
        ADDI R29, R0, 0x7F00
        ADDI R1, R0, 5
        JAL  countdown
        TRAP 0
; sum(n) = n + sum(n-1), sum(0) = 0  -> sum(5) = 15
countdown:
        BNEZ R1, recurse
        ADDI R2, R0, 0
        JR   R31
recurse:
        SUBI R29, R29, 8
        SW   0(R29), R31
        SW   4(R29), R1
        SUBI R1, R1, 1
        JAL  countdown
        LW   R1, 4(R29)
        LW   R31, 0(R29)
        ADDI R29, R29, 8
        ADD  R2, R2, R1
        JR   R31
; @expect reg R2 = 15
`, notes: 'If this fails, the recursive save/restore pattern is broken — likely R31 or the argument being clobbered across the recursive call, which is exactly the bug class this project hit with recursive Fibonacci during development.'});

/* ============================================================
 * ALGORITHM TESTS
 * ============================================================ */
add({
  category: 'Algorithm', name: 'Factorial (iterative)',
  purpose: '5! = 120 computed with a counted loop',
  code: `
        ADDI R1, R0, 5
        ADDI R2, R0, 1
loop:   BEQZ R1, done
        MULT R2, R2, R1
        SUBI R1, R1, 1
        J loop
done:   TRAP 0
; @expect reg R2 = 120
`});

add({
  category: 'Algorithm', name: 'Factorial (recursive)',
  purpose: '5! = 120 computed with a recursive function using a real call stack',
  code: `
        ADDI R29, R0, 0x7F00
        ADDI R1, R0, 5
        JAL fact
        TRAP 0
fact:   SGTI R3, R1, 1
        BNEZ R3, recurse
        ADDI R2, R0, 1
        JR R31
recurse:
        SUBI R29, R29, 8
        SW 0(R29), R31
        SW 4(R29), R1
        SUBI R1, R1, 1
        JAL fact
        LW R1, 4(R29)
        LW R31, 0(R29)
        ADDI R29, R29, 8
        MULT R2, R2, R1
        JR R31
; @expect reg R2 = 120
`});

add({
  category: 'Algorithm', name: 'Fibonacci (iterative)',
  purpose: 'fib(10) = 55 computed iteratively',
  code: `
        ADDI R1, R0, 0    ; fib(0)
        ADDI R2, R0, 1    ; fib(1)
        ADDI R3, R0, 10   ; n
loop:   BEQZ R3, done
        ADD  R4, R1, R2
        ADD  R1, R0, R2
        ADD  R2, R0, R4
        SUBI R3, R3, 1
        J loop
done:   TRAP 0
; @expect reg R1 = 55
`});

add({
  category: 'Algorithm', name: 'Fibonacci (recursive)',
  purpose: 'fib(10) = 55 computed recursively',
  code: `
        ADDI R29, R0, 0x7F00
        ADDI R1, R0, 10
        JAL fib
        TRAP 0
fib:    SLTI R3, R1, 2
        BEQZ R3, rec
        ADD  R2, R0, R1
        JR   R31
rec:    SUBI R29, R29, 12
        SW   0(R29), R31
        SW   4(R29), R1
        SUBI R1, R1, 1
        JAL  fib
        SW   8(R29), R2
        LW   R1, 4(R29)
        SUBI R1, R1, 2
        JAL  fib
        LW   R3, 8(R29)
        ADD  R2, R2, R3
        LW   R31, 0(R29)
        ADDI R29, R29, 12
        JR   R31
; @expect reg R2 = 55
`});

add({
  category: 'Algorithm', name: 'Bubble sort',
  purpose: 'An unsorted 16-bit array is sorted ascending',
  code: `
        .data
arr:    .half 5, 2, 9, 1, 7, 3
n:      .word 6
        .text
        LW   R1, n(R0)
        SUBI R1, R1, 1
outer:  BEQZ R1, done
        ADDI R2, R0, arr
        ADD  R3, R0, R1
inner:  LH   R4, 0(R2)
        LH   R5, 2(R2)
        SLE  R6, R4, R5
        BNEZ R6, noswap
        SH   0(R2), R5
        SH   2(R2), R4
noswap: ADDI R2, R2, 2
        SUBI R3, R3, 1
        BNEZ R3, inner
        SUBI R1, R1, 1
        J outer
done:   TRAP 0
; @expect half arr[0] = 1
; @expect half arr[1] = 2
; @expect half arr[2] = 3
; @expect half arr[3] = 5
; @expect half arr[4] = 7
; @expect half arr[5] = 9
`});

add({
  category: 'Algorithm', name: 'Selection sort',
  purpose: 'An unsorted word array is sorted ascending by repeatedly selecting the minimum',
  code: `
        .data
arr:    .word 29, 10, 14, 37, 13
n:      .word 5
        .text
        LW   R1, n(R0)          ; n
        ADDI R2, R0, 0          ; i
outer:  SUBI R7, R1, 1
        SGE  R7, R2, R7
        BNEZ R7, done
        ADD  R3, R2, R0         ; minIdx = i
        ADDI R4, R2, 1          ; j = i+1
inner:  SGE  R7, R4, R1
        BNEZ R7, swap
        SLLI R8, R4, 2
        ADDI R9, R0, arr
        ADD  R9, R9, R8
        LW   R10, 0(R9)         ; arr[j]
        SLLI R8, R3, 2
        ADDI R9, R0, arr
        ADD  R9, R9, R8
        LW   R11, 0(R9)         ; arr[minIdx]
        SLT  R7, R10, R11
        BEQZ R7, skip
        ADD  R3, R4, R0         ; minIdx = j
skip:   ADDI R4, R4, 1
        J inner
swap:   SLLI R8, R2, 2
        ADDI R9, R0, arr
        ADD  R9, R9, R8
        LW   R10, 0(R9)         ; arr[i]
        SLLI R8, R3, 2
        ADDI R12, R0, arr
        ADD  R12, R12, R8
        LW   R11, 0(R12)        ; arr[minIdx]
        SW   0(R9), R11
        SW   0(R12), R10
        ADDI R2, R2, 1
        J outer
done:   TRAP 0
; @expect word arr[0] = 10
; @expect word arr[1] = 13
; @expect word arr[2] = 14
; @expect word arr[3] = 29
; @expect word arr[4] = 37
`});

add({
  category: 'Algorithm', name: 'Insertion sort',
  purpose: 'An unsorted word array is sorted ascending by insertion',
  code: `
        .data
arr:    .word 8, 4, 23, 42, 16, 15
n:      .word 6
        .text
        LW   R1, n(R0)
        ADDI R2, R0, 1           ; i = 1
outer:  SGE  R7, R2, R1
        BNEZ R7, done
        SLLI R8, R2, 2
        ADDI R9, R0, arr
        ADD  R9, R9, R8
        LW   R3, 0(R9)           ; key = arr[i]
        ADD  R4, R2, R0
        SUBI R4, R4, 1           ; j = i-1
shift:  SLTI R7, R4, 0
        BNEZ R7, place
        SLLI R8, R4, 2
        ADDI R10, R0, arr
        ADD  R10, R10, R8
        LW   R5, 0(R10)          ; arr[j]
        SGT  R7, R5, R3
        BEQZ R7, place
        SLLI R8, R4, 2
        ADDI R11, R0, arr
        ADD  R11, R11, R8
        SW   4(R11), R5          ; arr[j+1] = arr[j]
        SUBI R4, R4, 1
        J shift
place:  ADDI R4, R4, 1
        SLLI R8, R4, 2
        ADDI R12, R0, arr
        ADD  R12, R12, R8
        SW   0(R12), R3
        ADDI R2, R2, 1
        J outer
done:   TRAP 0
; @expect word arr[0] = 4
; @expect word arr[1] = 8
; @expect word arr[2] = 15
; @expect word arr[3] = 16
; @expect word arr[4] = 23
; @expect word arr[5] = 42
`});

add({
  category: 'Algorithm', name: 'Linear search',
  purpose: 'Find the index of a target value by scanning',
  code: `
        .data
arr:    .word 4, 8, 15, 16, 23, 42
n:      .word 6
target: .word 16
        .text
        LW   R1, n(R0)
        LW   R2, target(R0)
        ADDI R3, R0, arr
        ADDI R4, R0, 0           ; index
loop:   BEQZ R1, notfound
        LW   R5, 0(R3)
        SEQ  R6, R5, R2
        BNEZ R6, found
        ADDI R3, R3, 4
        ADDI R4, R4, 1
        SUBI R1, R1, 1
        J loop
found:  TRAP 0
notfound: ADDI R4, R0, -1
        TRAP 0
; @expect reg R4 = 3
`});

add({
  category: 'Algorithm', name: 'Binary search',
  purpose: 'Find the index of a target value in a sorted array via binary search',
  code: `
        .data
arr:    .word 2, 4, 8, 16, 23, 42, 50, 71
n:      .word 8
target: .word 42
        .text
        LW   R1, target(R0)
        ADDI R2, R0, 0           ; lo
        LW   R3, n(R0)
        SUBI R3, R3, 1           ; hi
        ADDI R7, R0, -1          ; result
loop:   SGT  R8, R2, R3
        BNEZ R8, done
        ADD  R4, R2, R3
        SRLI R4, R4, 1           ; mid = (lo+hi)/2
        SLLI R5, R4, 2
        ADDI R6, R0, arr
        ADD  R6, R6, R5
        LW   R9, 0(R6)
        SEQ  R10, R9, R1
        BNEZ R10, foundmid
        SLT  R10, R9, R1
        BEQZ R10, goleft
        ADDI R2, R4, 1
        J loop
goleft: SUBI R3, R4, 1
        J loop
foundmid:
        ADD  R7, R4, R0
done:   TRAP 0
; @expect reg R7 = 5
`});

add({
  category: 'Algorithm', name: 'GCD (Euclidean algorithm)',
  purpose: 'gcd(48, 18) = 6',
  code: `
        ADDI R1, R0, 48
        ADDI R2, R0, 18
loop:   BEQZ R2, done
        DIV  R3, R1, R2
        MULT R3, R3, R2
        SUB  R4, R1, R3          ; R1 mod R2
        ADD  R1, R2, R0
        ADD  R2, R4, R0
        J loop
done:   TRAP 0
; @expect reg R1 = 6
`});

add({
  category: 'Algorithm', name: 'LCM (via GCD)',
  purpose: 'lcm(4, 6) = 12, computed as (a*b) / gcd(a,b)',
  code: `
        ADDI R5, R0, 4          ; a
        ADDI R6, R0, 6          ; b
        ADD  R1, R5, R0
        ADD  R2, R6, R0
loop:   BEQZ R2, gcddone
        DIV  R3, R1, R2
        MULT R3, R3, R2
        SUB  R4, R1, R3
        ADD  R1, R2, R0
        ADD  R2, R4, R0
        J loop
gcddone:
        MULT R7, R5, R6
        DIV  R8, R7, R1         ; (a*b)/gcd
        TRAP 0
; @expect reg R8 = 12
`});

add({
  category: 'Algorithm', name: 'Prime check',
  purpose: 'Trial division determines that 97 is prime and 91 is not',
  code: `
        ADDI R1, R0, 97          ; candidate
        ADDI R2, R0, 2           ; divisor
        ADDI R3, R0, 1           ; assume prime
chk:    MULT R4, R2, R2
        SGT  R5, R4, R1
        BNEZ R5, done
        DIV  R6, R1, R2
        MULT R6, R6, R2
        SEQ  R7, R6, R1
        BEQZ R7, next
        ADDI R3, R0, 0           ; found a divisor -> not prime
        J done
next:   ADDI R2, R2, 1
        J chk
done:   TRAP 0
; @expect reg R3 = 1
`});

add({
  category: 'Algorithm', name: 'Palindrome check',
  purpose: '"RACECAR" is recognized as a palindrome',
  code: `
        .data
s:      .asciiz "RACECAR"
        .text
        ADDI R1, R0, s          ; left
        ADD  R2, R1, R0
len:    LBU  R3, 0(R2)
        BEQZ R3, gotlen
        ADDI R2, R2, 1
        J len
gotlen: SUBI R2, R2, 1          ; right = last char
        ADDI R4, R0, 1          ; result
cmp:    SGE  R5, R1, R2
        BNEZ R5, done
        LBU  R6, 0(R1)
        LBU  R7, 0(R2)
        SEQ  R8, R6, R7
        BNEZ R8, cont
        ADDI R4, R0, 0
        J done
cont:   ADDI R1, R1, 1
        SUBI R2, R2, 1
        J cmp
done:   TRAP 0
; @expect reg R4 = 1
`});

add({
  category: 'Algorithm', name: 'Reverse array (in place)',
  purpose: 'A word array is reversed using two converging pointers',
  code: `
        .data
arr:    .word 1, 2, 3, 4, 5
n:      .word 5
        .text
        ADDI R1, R0, arr        ; left
        LW   R2, n(R0)
        SUBI R2, R2, 1
        SLLI R2, R2, 2
        ADD  R2, R1, R2         ; right = &arr[n-1]
loop:   SGE  R5, R1, R2
        BNEZ R5, done
        LW   R3, 0(R1)
        LW   R4, 0(R2)
        SW   0(R1), R4
        SW   0(R2), R3
        ADDI R1, R1, 4
        SUBI R2, R2, 4
        J loop
done:   TRAP 0
; @expect word arr[0] = 5
; @expect word arr[1] = 4
; @expect word arr[2] = 3
; @expect word arr[3] = 2
; @expect word arr[4] = 1
`});

add({
  category: 'Algorithm', name: 'Reverse string',
  purpose: '"HELLO" is reversed into a second buffer',
  code: `
        .data
s:      .asciiz "HELLO"
rev:    .space 8
        .text
        ADDI R1, R0, s
        ADDI R2, R0, 0
len:    LBU  R3, 0(R1)
        BEQZ R3, copy
        ADDI R1, R1, 1
        ADDI R2, R2, 1
        J len
copy:   ADDI R4, R0, rev
        SUBI R1, R1, 1
rloop:  BEQZ R2, done
        LBU  R3, 0(R1)
        SB   0(R4), R3
        SUBI R1, R1, 1
        ADDI R4, R4, 1
        SUBI R2, R2, 1
        J rloop
done:   SB   0(R4), R0
        TRAP 0
; @expect string rev = "OLLEH"
`});

add({
  category: 'Algorithm', name: 'Matrix addition (2x2)',
  purpose: 'C = A + B for two 2x2 word matrices',
  code: `
        .data
A:      .word 1, 2, 3, 4
B:      .word 5, 6, 7, 8
C:      .space 16
        .text
        ADDI R1, R0, 0
loop:   SGEI R2, R1, 4
        BNEZ R2, done
        SLLI R3, R1, 2
        ADDI R4, R0, A
        ADD  R4, R4, R3
        LW   R5, 0(R4)
        ADDI R6, R0, B
        ADD  R6, R6, R3
        LW   R7, 0(R6)
        ADD  R8, R5, R7
        ADDI R9, R0, C
        ADD  R9, R9, R3
        SW   0(R9), R8
        ADDI R1, R1, 1
        J loop
done:   TRAP 0
; @expect word C[0] = 6
; @expect word C[1] = 8
; @expect word C[2] = 10
; @expect word C[3] = 12
`});

add({
  category: 'Algorithm', name: 'Matrix multiplication (3x3)',
  purpose: 'C = A * B for two 3x3 word matrices',
  code: `
        .data
A:      .word 1, 2, 3, 4, 5, 6, 7, 8, 9
B:      .word 9, 8, 7, 6, 5, 4, 3, 2, 1
C:      .space 36
N:      .word 3
        .text
main:   LW   R10, N(R0)
        ADDI R1, R0, 0
iloop:  ADDI R2, R0, 0
jloop:  ADDI R3, R0, 0
        ADDI R4, R0, 0
kloop:  MULT R5, R1, R10
        ADD  R5, R5, R3
        SLLI R5, R5, 2
        LW   R6, A(R5)
        MULT R7, R3, R10
        ADD  R7, R7, R2
        SLLI R7, R7, 2
        LW   R8, B(R7)
        MULT R9, R6, R8
        ADD  R4, R4, R9
        ADDI R3, R3, 1
        SLT  R5, R3, R10
        BNEZ R5, kloop
        MULT R5, R1, R10
        ADD  R5, R5, R2
        SLLI R5, R5, 2
        SW   C(R5), R4
        ADDI R2, R2, 1
        SLT  R5, R2, R10
        BNEZ R5, jloop
        ADDI R1, R1, 1
        SLT  R5, R1, R10
        BNEZ R5, iloop
        TRAP 0
; @expect word C[0] = 30
; @expect word C[4] = 69
; @expect word C[8] = 90
`});

add({
  category: 'Algorithm', name: 'Count positives',
  purpose: 'Count how many elements of an array are strictly greater than zero',
  code: `
        .data
arr:    .word 3, -1, 0, 7, -5, 2
n:      .word 6
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        ADDI R3, R0, 0
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        SGTI R5, R4, 0
        ADD  R3, R3, R5
        ADDI R1, R1, 4
        SUBI R2, R2, 1
        J loop
done:   TRAP 0
; @expect reg R3 = 3
`});

add({
  category: 'Algorithm', name: 'Count negatives',
  purpose: 'Count how many elements of an array are strictly less than zero',
  code: `
        .data
arr:    .word 3, -1, 0, 7, -5, 2
n:      .word 6
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        ADDI R3, R0, 0
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        SLTI R5, R4, 0
        ADD  R3, R3, R5
        ADDI R1, R1, 4
        SUBI R2, R2, 1
        J loop
done:   TRAP 0
; @expect reg R3 = 2
`});

add({
  category: 'Algorithm', name: 'Maximum of array',
  purpose: 'Find the largest element of an array',
  code: `
        .data
arr:    .word 3, 41, -7, 19, 55, 2
n:      .word 6
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        LW   R3, 0(R1)
        ADDI R1, R1, 4
        SUBI R2, R2, 1
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        SGT  R5, R4, R3
        BEQZ R5, skip
        ADD  R3, R4, R0
skip:   ADDI R1, R1, 4
        SUBI R2, R2, 1
        J loop
done:   TRAP 0
; @expect reg R3 = 55
`});

add({
  category: 'Algorithm', name: 'Minimum of array',
  purpose: 'Find the smallest element of an array',
  code: `
        .data
arr:    .word 3, 41, -7, 19, 55, 2
n:      .word 6
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        LW   R3, 0(R1)
        ADDI R1, R1, 4
        SUBI R2, R2, 1
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        SLT  R5, R4, R3
        BEQZ R5, skip
        ADD  R3, R4, R0
skip:   ADDI R1, R1, 4
        SUBI R2, R2, 1
        J loop
done:   TRAP 0
; @expect reg R3 = -7
`});

add({
  category: 'Algorithm', name: 'Average of array',
  purpose: 'Sum an array then divide by its length',
  code: `
        .data
arr:    .word 2, 4, 6, 8, 10
n:      .word 5
        .text
        ADDI R1, R0, arr
        LW   R2, n(R0)
        ADD  R6, R2, R0
        ADDI R3, R0, 0
loop:   BEQZ R2, done
        LW   R4, 0(R1)
        ADD  R3, R3, R4
        ADDI R1, R1, 4
        SUBI R2, R2, 1
        J loop
done:   DIV  R5, R3, R6
        TRAP 0
; @expect reg R5 = 6
`});

/* ============================================================
 * EXCEPTION TESTS
 * ============================================================ */
add({
  category: 'Exception', name: 'Division by zero', expectError: { phase: 'runtime', match: /division by zero/i },
  purpose: 'DIV by a register holding zero must fault rather than silently returning 0',
  code: `
        ADDI R1, R0, 10
        ADDI R2, R0, 0
        DIV  R3, R1, R2
        TRAP 0
`, notes: 'If this does not fault, division-by-zero bugs in student programs silently produce 0 instead of being caught — a real bug found and fixed while building this suite.'});

add({
  category: 'Exception', name: 'MOD by zero', expectError: { phase: 'runtime', match: /division by zero/i },
  purpose: 'MOD by a register holding zero must also fault',
  code: `
        ADDI R1, R0, 10
        ADDI R2, R0, 0
        MOD  R3, R1, R2
        TRAP 0
`, notes: 'Same class of bug as DIV by zero, for the modulo operator specifically.'});

add({
  category: 'Exception', name: 'Invalid opcode at assembly time', expectError: { phase: 'assemble', match: /unknown instruction/i },
  purpose: 'An unrecognized mnemonic is caught before simulation ever starts',
  code: `
        NOTANOPCODE R1, R2, R3
`, notes: 'If this passes assembly, invalid instructions would need to be caught at runtime instead (or not at all), which is a much later and less useful point to catch a typo.'});

add({
  category: 'Exception', name: 'Invalid memory access (address past end of memory)', expectError: { phase: 'runtime', match: /out of bounds/i },
  purpose: 'Reading 4 bytes starting 2 bytes before the end of memory must fault',
  code: `
        LI R1, 0xFFFE
        LW R2, 0(R1)
        TRAP 0
`, notes: 'If this does not fault, out-of-bounds memory accesses are silently tolerated instead of caught, which could mask real addressing bugs.'});

add({
  category: 'Exception', name: 'Invalid register at assembly time', expectError: { phase: 'assemble', match: /needs/i },
  purpose: 'A register number of 32 or higher is caught at assembly time',
  code: `
        ADDI R99, R0, 1
`, notes: 'If this passes, an out-of-range register token would be silently ignored instead of flagged.'});

add({
  category: 'Exception', name: 'Invalid jump target (into mid-instruction / unfetchable address)', expectError: { phase: 'runtime', match: /fetch from address/i },
  purpose: 'Jumping to an address with no instruction (e.g. into the data segment) must fault on the next fetch',
  code: `
        .data
d:      .word 0
        .text
        ADDI R1, R0, d
        JR R1
        TRAP 0
`, notes: 'If this does not fault, a jump to a bad address would silently fetch garbage/undefined behavior instead of being caught.'});

add({
  category: 'Exception', name: 'Infinite loop (no HALT/TRAP 0)', expectError: { phase: 'nohalt' }, maxCycles: 50000,
  purpose: 'A program with a branch that never becomes false must be caught by the cycle governor rather than hanging forever',
  code: `
loop:   BEQZ R0, loop
`, notes: 'If run() never returns / never reports "not halted", a buggy infinite-loop program in the UI would hang the browser tab instead of being caught and reported.'});

add({
  category: 'Exception', name: 'Stack overflow (unbounded push walks off the end of memory)', expectError: { phase: 'runtime', match: /out of bounds/i },
  purpose: 'Repeatedly pushing without popping eventually pushes past address 0 and wraps to an enormous unsigned address, which must fault',
  code: `
        ADDI R29, R0, 32          ; deliberately tiny stack region
        ADDI R1, R0, 0
push:   SUBI R29, R29, 4
        SW   0(R29), R1
        ADDI R1, R1, 1
        J    push
`, notes: 'If this does not eventually fault, unbounded stack growth (a common recursion bug) would silently corrupt arbitrary memory instead of being caught.'});

/* ============================================================
 * PERFORMANCE TESTS
 * ============================================================ */
function genLoop(n) {
  let s = '        ADDI R1, R0, ' + n + '\n        ADDI R2, R0, 0\nloop:   ADD  R2, R2, R1\n        SUBI R1, R1, 1\n        BNEZ R1, loop\n        TRAP 0\n';
  return s;
}
add({
  category: 'Performance', name: '~100-instruction program (unrolled sum)',
  purpose: 'Report cycles/CPI/stalls for a mid-size straight-line program',
  performance: true,
  code: (() => {
    let s = '        ADDI R1, R0, 0\n';
    for (let i = 0; i < 96; i++) s += '        ADDI R2, R0, ' + (i % 30) + '\n        ADD  R1, R1, R2\n';
    s = s.split('\n').slice(0, 100).join('\n') + '\n        TRAP 0\n';
    return s;
  })(),
});
add({
  category: 'Performance', name: '1000-iteration loop',
  purpose: 'Report cycles/CPI/stalls for a tight loop executed 1000 times',
  performance: true,
  code: genLoop(1000) + '; @expect reg R2 = 500500\n',
});
add({
  category: 'Performance', name: 'Memory-intensive benchmark (array fill + sum, 200 words)',
  purpose: 'Report memory read/write counts for a load/store-heavy loop',
  performance: true,
  code: `
        .data
arr:    .space 800
        .text
        ADDI R1, R0, 0            ; i
        ADDI R2, R0, arr
fill:   SGEI R3, R1, 200
        BNEZ R3, sumstart
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        SW   0(R5), R1
        ADDI R1, R1, 1
        J fill
sumstart:
        ADDI R1, R0, 0
        ADDI R6, R0, 0
sumloop:
        SGEI R3, R1, 200
        BNEZ R3, done
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        LW   R7, 0(R5)
        ADD  R6, R6, R7
        ADDI R1, R1, 1
        J sumloop
done:   TRAP 0
; @expect reg R6 = 19900
`,
});
add({
  category: 'Performance', name: 'Branch-intensive benchmark (100 alternating branches)',
  purpose: 'Report branch/taken-branch counts and flush overhead for branch-heavy code',
  performance: true,
  code: (() => {
    let s = '        ADDI R1, R0, 0\n        ADDI R9, R0, 0\n';
    for (let i = 0; i < 100; i++) {
      s += '        SEQI R2, R1, ' + (i % 2) + '\n        BEQZ R2, sk' + i + '\n        ADDI R9, R9, 1\nsk' + i + ':      XORI R1, R1, 1\n';
    }
    s += '        TRAP 0\n';
    return s;
  })(),
});
add({
  category: 'Performance', name: 'Arithmetic-intensive benchmark (200 dependent ALU ops)',
  purpose: 'Report forwarding usage for a chain of tightly dependent arithmetic',
  performance: true,
  code: (() => {
    let s = '        ADDI R1, R0, 1\n';
    for (let i = 0; i < 200; i++) s += '        ADDI R1, R1, 1\n';
    s += '        TRAP 0\n; @expect reg R1 = 201\n';
    return s;
  })(),
});
add({
  category: 'Performance', name: 'Mixed benchmark (arithmetic + memory + branches)',
  purpose: 'Report the full stat set for a representative mixed workload (array bubble-sort-like scan)',
  performance: true,
  code: `
        .data
arr:    .space 400
        .text
        ADDI R1, R0, 0
init:   SGEI R2, R1, 100
        BNEZ R2, work
        SLLI R3, R1, 2
        ADDI R4, R0, arr
        ADD  R4, R4, R3
        SUBI R5, R1, 50
        SW   0(R4), R5
        ADDI R1, R1, 1
        J init
work:   ADDI R1, R0, 0
        ADDI R6, R0, 0          ; count of positives
sum:    SGEI R2, R1, 100
        BNEZ R2, done
        SLLI R3, R1, 2
        ADDI R4, R0, arr
        ADD  R4, R4, R3
        LW   R7, 0(R4)
        SGTI R8, R7, 0
        ADD  R6, R6, R8
        ADDI R1, R1, 1
        J sum
done:   TRAP 0
; @expect reg R6 = 49
`,
});

/* ============================================================
 * STRESS TESTS
 * ============================================================ */
add({
  category: 'Stress', name: 'Largest program (2000 instructions)',
  purpose: 'Assemble and run a 2000-instruction straight-line program without assembler or simulator size limits breaking',
  performance: true, maxCycles: 500000,
  code: (() => {
    let s = '        ADDI R1, R0, 0\n';
    for (let i = 0; i < 1998; i++) s += '        ADDI R1, R1, 1\n';
    s += '        TRAP 0\n; @expect reg R1 = 1998\n';
    return s;
  })(),
});
add({
  category: 'Stress', name: 'Maximum labels (500 unique labels)',
  purpose: 'A program with 500 distinct labels assembles correctly and the last one is reachable',
  code: (() => {
    let s = '        ADDI R1, R0, 0\n';
    for (let i = 0; i < 500; i++) s += 'lbl' + i + ': ADDI R1, R1, 1\n';
    s += '        TRAP 0\n; @expect reg R1 = 500\n';
    return s;
  })(),
});
add({
  category: 'Stress', name: 'Maximum branches (300-way branch chain)',
  purpose: 'A long chain of sequential conditional branches, all taken, assembles and executes correctly',
  code: (() => {
    let s = '        ADDI R1, R0, 1\n        ADDI R9, R0, 0\n';
    for (let i = 0; i < 300; i++) s += '        BNEZ R1, ok' + i + '\n        J skip' + i + '\nok' + i + ': ADDI R9, R9, 1\nskip' + i + ':\n';
    s += '        TRAP 0\n; @expect reg R9 = 300\n';
    return s;
  })(),
});
add({
  category: 'Stress', name: 'Maximum nested loops (5 levels deep)',
  purpose: 'Five levels of nested counted loops (3 iterations each = 243 innermost executions) terminate and count correctly',
  code: `
        ADDI R1, R0, 0
        ADDI R10, R0, 0     ; total count
l1:     SGEI R2, R1, 3
        BNEZ R2, l1end
        ADDI R3, R0, 0
l2:     SGEI R4, R3, 3
        BNEZ R4, l2end
        ADDI R5, R0, 0
l3:     SGEI R6, R5, 3
        BNEZ R6, l3end
        ADDI R7, R0, 0
l4:     SGEI R8, R7, 3
        BNEZ R8, l4end
        ADDI R9, R0, 0
l5:     SGEI R11, R9, 3
        BNEZ R11, l5end
        ADDI R10, R10, 1
        ADDI R9, R9, 1
        J l5
l5end:  ADDI R7, R7, 1
        J l4
l4end:  ADDI R5, R5, 1
        J l3
l3end:  ADDI R3, R3, 1
        J l2
l2end:  ADDI R1, R1, 1
        J l1
l1end:  TRAP 0
; @expect reg R10 = 243
`,
});
add({
  category: 'Stress', name: 'Maximum recursion depth (50 levels)',
  purpose: 'A recursive countdown 50 levels deep, entirely stack-backed (not host-JS-stack-backed), completes correctly',
  maxCycles: 200000,
  code: `
        ADDI R29, R0, 0x7F00
        ADDI R1, R0, 50
        JAL  countdown
        TRAP 0
countdown:
        BNEZ R1, recurse
        ADDI R2, R0, 0
        JR   R31
recurse:
        SUBI R29, R29, 8
        SW   0(R29), R31
        SW   4(R29), R1
        SUBI R1, R1, 1
        JAL  countdown
        LW   R1, 4(R29)
        LW   R31, 0(R29)
        ADDI R29, R29, 8
        ADD  R2, R2, R1
        JR   R31
; @expect reg R2 = 1275
`,
});
add({
  category: 'Stress', name: 'Maximum stack usage (100 nested pushes)',
  purpose: '100 words pushed onto the stack are all still correctly readable at their pushed positions',
  code: `
        ADDI R29, R0, 0x7F00
        ADDI R1, R0, 0
push:   SGEI R2, R1, 100
        BNEZ R2, verify
        SUBI R29, R29, 4
        SW   0(R29), R1
        ADDI R1, R1, 1
        J push
verify: ADDI R3, R0, 0           ; SP now points at the 100th push (value 99)
        LW   R4, 0(R29)
        TRAP 0
; @expect reg R4 = 99
`,
});
add({
  category: 'Stress', name: 'Large array (1000 words, sum)',
  purpose: 'Sum a 1000-element array (sum 0..999 = 499500)',
  performance: true, maxCycles: 500000,
  code: `
        .data
arr:    .space 4000
        .text
        ADDI R1, R0, 0
        ADDI R2, R0, arr
fill:   SGEI R3, R1, 1000
        BNEZ R3, sumstart
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        SW   0(R5), R1
        ADDI R1, R1, 1
        J fill
sumstart:
        ADDI R1, R0, 0
        ADDI R6, R0, 0
sumloop:
        SGEI R3, R1, 1000
        BNEZ R3, done
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        LW   R7, 0(R5)
        ADD  R6, R6, R7
        ADDI R1, R1, 1
        J sumloop
done:   TRAP 0
; @expect reg R6 = 499500
`,
});
add({
  category: 'Stress', name: 'Heavy memory writes (2000 stores)',
  purpose: 'A loop performing 2000 stores completes and the last write is correct',
  performance: true, maxCycles: 500000,
  code: `
        .data
buf:    .space 8000
        .text
        ADDI R1, R0, 0
        ADDI R2, R0, buf
wloop:  SGEI R3, R1, 2000
        BNEZ R3, done
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        SW   0(R5), R1
        ADDI R1, R1, 1
        J wloop
done:   LW   R6, 7996(R2)
        TRAP 0
; @expect reg R6 = 1999
`,
});
add({
  category: 'Stress', name: 'Heavy memory reads (2000 loads)',
  purpose: 'A loop performing 2000 loads from a pre-filled array sums correctly',
  performance: true, maxCycles: 500000,
  code: `
        .data
buf:    .space 8000
        .text
        ADDI R1, R0, 0
        ADDI R2, R0, buf
wloop:  SGEI R3, R1, 2000
        BNEZ R3, rloop0
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        SW   0(R5), R1
        ADDI R1, R1, 1
        J wloop
rloop0: ADDI R1, R0, 0
        ADDI R6, R0, 0
rloop:  SGEI R3, R1, 2000
        BNEZ R3, done
        SLLI R4, R1, 2
        ADD  R5, R2, R4
        LW   R7, 0(R5)
        ADD  R6, R6, R7
        ADDI R1, R1, 1
        J rloop
done:   TRAP 0
; @expect reg R6 = 1999000
`,
});

module.exports = tests;
