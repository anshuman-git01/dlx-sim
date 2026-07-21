# 🖥️ DLX-Sim

**A complete DLX (RISC) assembler + cycle-accurate 5-stage pipeline simulator that runs entirely in your browser.**

Write any DLX assembly program in a VS Code-style editor, run it cycle by cycle, and *see* the pipeline work — every stall, forward and flush, explained. Zero dependencies, zero build step: one folder of plain HTML/CSS/JS.

```
ADDI R1, R0, 5      IF → ID → EX → MEM → WB
ADD  R2, R1, R1          IF → ID → EX  → MEM → WB        ← forwarded, no stall
LW   R3, x(R0)                IF → ID → EX  → MEM → WB
ADD  R4, R3, R1                    IF → ⏸ → ID → EX → …  ← load-use: 1 stall
```

---

##  Features

| | |
|---|---|
|  **IDE workspace** | File explorer, editor tabs, DLX syntax highlighting, terminal — your files persist in the browser |
|  **Breakpoints** | Click a line number, press Run, and the machine pauses when that instruction is decoded |
|  **Pipeline diagram** | Live per-cycle chart of IF / ID / EX / MEM / WB, with STALL and FLUSH bubbles |
|  **Forwarding toggle** | Flip EX/MEM & MEM/WB forwarding on/off and watch the CPI change |
| 🔍 **Hazard logs** | Every stall names its cause and the instruction that blocked it |
|  **Registers & memory** | Live register file and hex memory dump with symbol navigation |
|  **Self-checking programs** | Declare expected results as `; @expect` comments — the Tests tab verifies them |
|  **Performance analysis** | Cycles, CPI, stall breakdown, and a one-click forwarding on/off comparison |
|  **20 example programs** | Classic assignments (string ops, matrix multiply, recursive Fibonacci, bubble sort, BCD…) ready to load |

##  Quick start

```bash
git clone <this-repo>
cd dlx-simulator
python3 -m http.server 8734
```

Open **http://localhost:8734** — that's it. (Any static file server works; you can even just double-click `index.html`.)

You'll land in `welcome.s`, a small self-checking program. Press **Assemble**, then **Step** a few times and open the **Pipeline** tab.

##  Using the IDE

- **＋** new file · **⇪** import `.s` files from disk · **☰** add an example program (P1–P20)
- Double-click a file to **rename**, ✕ to delete, `Ctrl/Cmd+S` to **download** the active file
- Click a **line number** to toggle a breakpoint; the highlighted line is the instruction currently in decode
- **Step / +10** single-step the clock · **Run** animates at the chosen speed · **Run to End** finishes instantly
- The **Forwarding** checkbox rebuilds the datapath with or without forwarding paths

##  Self-checking programs

Add expectations as plain comments anywhere in a program, then open the **Tests** tab:

```asm
; @expect reg R2 = 55              ; register value after halt
; @expect word result = 55         ; 32-bit word at label (also: half, byte)
; @expect word C[4] = 69           ; indexed — scaled by element size
; @expect string rev = "ENILEPIP"  ; NUL-terminated string at label
; @expect output "55"              ; program output contains this text
```

**Run current file** checks the file you're editing; **Run all workspace files** regression-tests every file that has `@expect` directives.

## 📖 A taste of DLX

```asm
        .data
result: .word 0

        .text
main:   ADDI R1, R0, 10         ; n = 10
        ADDI R2, R0, 0          ; sum = 0
loop:   ADD  R2, R2, R1         ; sum += n
        SUBI R1, R1, 1
        BNEZ R1, loop
        SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1                  ; print 55
        TRAP 0                  ; halt
```

### Instruction set

| Group | Instructions |
|---|---|
| ALU (R-type) | `ADD ADDU SUB SUBU AND OR XOR NOR SLL SRL SRA SLT SGT SLE SGE SEQ SNE SLTU SGTU MULT MUL MULTU DIV DIVU MOD` |
| ALU (immediate) | `ADDI ADDUI SUBI SUBUI ANDI ORI XORI SLLI SRLI SRAI SLTI SGTI SLEI SGEI SEQI SNEI LHI` |
| Load / store | `LW LH LHU LB LBU` · `SW SH SB` — e.g. `LW R1, 8(R2)`, `SW label(R0), R3` |
| Control | `BEQZ BNEZ BEQ BNE J JAL JR JALR` |
| Other | `NOP HALT TRAP` |
| Pseudo | `MOV rd,rs` · `LI rd,imm32` · `LA rd,label` · `RET` |

### Directives & conventions

`.text` `.data` `.org` `.word` `.half` `.byte` `.ascii` `.asciiz` `.space` `.align` — code starts at `0x0000`, data at `0x1000`, 64 KiB big-endian memory, 32 registers with **R0 hardwired to 0**. Comments with `;`, `#` or `//`. Labels can be used wherever an immediate is expected.

### I/O traps

| Call | Effect |
|---|---|
| `TRAP 0` / `HALT` | stop the program |
| `TRAP 1` | print R1 as signed decimal |
| `TRAP 2` | print NUL-terminated string at address in R1 |
| `TRAP 3` | print R1 as a single character |
| `TRAP 4` | print R1 as hexadecimal |

##  The pipeline model

Classic Hennessy & Patterson DLX:

- 5 stages **IF → ID → EX → MEM → WB**, in-order, single issue
- Branches resolve in **ID** — a taken branch/jump flushes the one wrongly fetched instruction (1 bubble)
- Register file is written in the first half of WB and read in the second half of ID
- **Forwarding ON** — EX/MEM and MEM/WB feed EX (and ID, for branch operands):
  load-use = 1 stall · ALU→branch = 1 stall · load→branch = 2 stalls
- **Forwarding OFF** — every RAW dependence waits for writeback (up to 2 stalls)

Typical result (example P1, a 256-element vector loop):

| | forwarding ON | forwarding OFF |
|---|---|---|
| cycles | **9,481** | 17,419 |
| CPI | **1.23** | 2.27 |
| stalls | 1,280 | 9,218 |

## 📁 Project structure

```
dlx-simulator/
├── index.html            # the app shell
├── style.css             # dark theme UI
├── app.js                # IDE: workspace, editor, views
├── dlx.js                # assembler + pipeline engine + @expect parser
│                         #   (plain JS — also loads in Node, no dependencies)
├── examples.js           # 20 classic example programs with checks
└── test/
    ├── run-tests.js      # Node harness for the 20 examples
    └── comprehensive/
        ├── spec.js       # ~130 tests: assembler, every instruction, memory,
        │                 #   pipeline/hazards, control flow, algorithms,
        │                 #   exceptions, performance, stress
        ├── run.js        # runs them all against the real simulator and
        │                 #   writes REPORT.md — nothing hand-computed
        └── REPORT.md     # generated: full pipeline diagrams, stall causes,
                           #   forwards, cycle counts for every test
```

##  Testing

```bash
node test/run-tests.js               # 20 examples × 2 forwarding modes = 44 checks
node test/comprehensive/run.js       # ~130 tests across every category below
```

The comprehensive suite covers: assembler edge cases (labels, duplicate/undefined
labels, invalid registers/opcodes/operands/immediates, comments, whitespace, case,
number literals, every directive) · every instruction in the ISA · memory
(alignment, offsets, boundaries, stack) · every named hazard and forwarding path
(RAW, load-use, store-data forwarding, branch/load-to-branch, WAR-shape false
positives, flushes) with real per-cycle pipeline diagrams · control flow ·
16 classic algorithms · exception handling (divide-by-zero, out-of-bounds,
infinite loops, stack overflow) · performance benchmarking · stress tests
(2000-instruction programs, 500 labels, 50-deep recursion). Every value in
`REPORT.md` — registers, memory, cycle counts, stall causes, forwards, flushes,
pipeline timelines — is captured live from the simulator, not hand-typed.

## ❓ FAQ

**Where are my files saved?** In your browser's localStorage, per machine. Use `Ctrl/Cmd+S` to download a file, and ⇪ to import it elsewhere.

**My program never halts.** End it with `TRAP 0` (or `HALT`). Runaway programs stop automatically at 2,000,000 cycles.

**Why does my branch stall?** Branches read their register in ID. If the value is produced by the instruction right before, even forwarding can't get it there in time — the Logs tab tells you exactly which instruction is being waited on.

**Is `MULT` really 1 cycle?** Yes — integer multiply/divide execute in a single EX cycle in this model (real DLX FP units are not modelled).
