/* ============================================================
 * DLX-Sim — 30 micro-projects (the 20 UEC 610 assignments plus 10
 * classic algorithms) as runnable examples, shown in a shuffled order.
 * Each example carries `checks` so it can be verified automatically
 * (Tests tab in the UI, or `node test/run-tests.js`).
 * Conventions: TRAP 0 halt · TRAP 1 print int R1 · TRAP 2 print
 * string at R1 · TRAP 3 print char R1 · TRAP 4 print hex R1.
 * ============================================================ */
(function (root) {
  'use strict';

  const EXAMPLES = [

  /* ------------------------------------------------------------ P1 */
  {
    id: 'P1', name: 'P1 — a[i] = a[i]+b[i]-c[i]+d[i] (256 words)',
    brief: 'Vector update over four 256-word arrays. Arrays are initialised to a[i]=i, b[i]=2i, c[i]=i, d[i]=3i, so afterwards a[i] = 5i. Try Performance ▸ compare forwarding, and unroll the loop to cut stalls.',
    code: `; P1: for (i = 0; i < 256; i++)  a[i] = a[i] + b[i] - c[i] + d[i]
; arrays initialised in a first loop: a[i]=i, b[i]=2i, c[i]=i, d[i]=3i
; expected afterwards: a[i] = i + 2i - i + 3i = 5i

        .data
a:      .space 1024
b:      .space 1024
c:      .space 1024
d:      .space 1024

        .text
main:   ADDI R1, R0, 0          ; i = 0
        ADDI R10, R0, a
        ADDI R11, R0, b
        ADDI R12, R0, c
        ADDI R13, R0, d
init:   SLLI R2, R1, 2          ; byte offset = 4*i
        ADD  R3, R10, R2
        SW   0(R3), R1          ; a[i] = i
        SLLI R4, R1, 1          ; 2*i
        ADD  R3, R11, R2
        SW   0(R3), R4          ; b[i] = 2i
        ADD  R3, R12, R2
        SW   0(R3), R1          ; c[i] = i
        ADD  R4, R4, R1         ; 3*i
        ADD  R3, R13, R2
        SW   0(R3), R4          ; d[i] = 3i
        ADDI R1, R1, 1
        SLTI R5, R1, 256
        BNEZ R5, init

        ADDI R1, R0, 0          ; i = 0
loop:   SLLI R2, R1, 2
        ADD  R3, R10, R2
        LW   R4, 0(R3)          ; a[i]
        ADD  R5, R11, R2
        LW   R6, 0(R5)          ; b[i]
        ADD  R4, R4, R6         ; a+b
        ADD  R5, R12, R2
        LW   R6, 0(R5)          ; c[i]
        SUB  R4, R4, R6         ; a+b-c
        ADD  R5, R13, R2
        LW   R6, 0(R5)          ; d[i]
        ADD  R4, R4, R6         ; a+b-c+d
        SW   0(R3), R4          ; a[i] = result
        ADDI R1, R1, 1
        SLTI R5, R1, 256
        BNEZ R5, loop
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'a', index: 0,   value: 0 },
      { kind: 'memw', label: 'a', index: 10,  value: 50 },
      { kind: 'memw', label: 'a', index: 255, value: 1275 },
    ],
  },

  /* ------------------------------------------------------------ P2 */
  {
    id: 'P2', name: 'P2 — 32-bit hex to ASCII string',
    brief: 'Converts 0xDEADBEEF to the string "DEADBEEF" nibble by nibble and prints it with TRAP 2.',
    code: `; P2: convert the 32-bit value in R1 to an 8-char hex ASCII string
        .data
buf:    .space 12               ; output string buffer

        .text
main:   LHI  R1, 0xDEAD
        ORI  R1, R1, 0xBEEF     ; value to convert
        ADDI R2, R0, buf        ; write pointer
        ADDI R3, R0, 28         ; shift amount: 28,24,...,0
loop:   SRL  R4, R1, R3         ; current nibble to low bits
        ANDI R4, R4, 0xF
        SLTI R5, R4, 10
        BEQZ R5, alpha
        ADDI R4, R4, 48         ; '0'..'9'
        J    store
alpha:  ADDI R4, R4, 55         ; 'A'..'F'  (55 = 'A' - 10)
store:  SB   0(R2), R4
        ADDI R2, R2, 1
        SUBI R3, R3, 4
        SGEI R5, R3, 0
        BNEZ R5, loop
        SB   0(R2), R0          ; NUL terminator
        ADDI R1, R0, buf
        TRAP 2                  ; print the string
        TRAP 0
`,
    checks: [
      { kind: 'mems', label: 'buf', value: 'DEADBEEF' },
      { kind: 'out', includes: 'DEADBEEF' },
    ],
  },

  /* ------------------------------------------------------------ P3 */
  {
    id: 'P3', name: 'P3 — compare null-terminated strings',
    brief: 'Byte-wise comparison of two NUL-terminated strings; result 1 (equal) is stored and printed.',
    code: `; P3: compare two NUL-terminated strings for equality
;     result = 1 if equal, 0 otherwise
        .data
s1:     .asciiz "HELLO"
s2:     .asciiz "HELLO"
result: .word 0

        .text
main:   ADDI R1, R0, s1
        ADDI R2, R0, s2
loop:   LBU  R3, 0(R1)
        LBU  R4, 0(R2)
        SEQ  R5, R3, R4
        BEQZ R5, noteq          ; bytes differ -> not equal
        BEQZ R3, equal          ; both NUL -> equal
        ADDI R1, R1, 1
        ADDI R2, R2, 1
        J    loop
equal:  ADDI R6, R0, 1
        J    done
noteq:  ADDI R6, R0, 0
done:   SW   result(R0), R6
        ADD  R1, R0, R6
        TRAP 1                  ; print 1 / 0
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 1 },
      { kind: 'out', includes: '1' },
    ],
  },

  /* ------------------------------------------------------------ P4 */
  {
    id: 'P4', name: 'P4 — length of a null-terminated string',
    brief: 'Classic strlen loop; "ARCHITECTURE" has 12 characters.',
    code: `; P4: length of a NUL-terminated string
        .data
str:    .asciiz "ARCHITECTURE"
result: .word 0

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; length
loop:   LBU  R3, 0(R1)
        BEQZ R3, done
        ADDI R2, R2, 1
        ADDI R1, R1, 1
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 12 },
      { kind: 'out', includes: '12' },
    ],
  },

  /* ------------------------------------------------------------ P5 */
  {
    id: 'P5', name: 'P5 — largest of a series of 16-bit numbers',
    brief: 'Scans 8 signed halfwords (including negatives); the maximum 999 is stored and printed.',
    code: `; P5: find the largest in a series of 16-bit numbers
        .data
nums:   .half 12, -7, 300, 45, -100, 27, 999, 3
n:      .word 8
result: .word 0

        .text
main:   ADDI R1, R0, nums
        LW   R2, n(R0)
        LH   R3, 0(R1)          ; max = nums[0]
        ADDI R1, R1, 2
        SUBI R2, R2, 1
loop:   BEQZ R2, done
        LH   R4, 0(R1)
        SGT  R5, R4, R3         ; nums[i] > max ?
        BEQZ R5, skip
        ADD  R3, R0, R4         ; new max
skip:   ADDI R1, R1, 2
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 999 },
      { kind: 'out', includes: '999' },
    ],
  },

  /* ------------------------------------------------------------ P6 */
  {
    id: 'P6', name: 'P6 — count negative 16-bit numbers',
    brief: 'Counts sign-extended halfwords below zero; the series holds 3 negatives.',
    code: `; P6: count how many 16-bit numbers in a series are negative
        .data
nums:   .half 5, -3, 7, -8, -9, 2
n:      .word 6
result: .word 0

        .text
main:   ADDI R1, R0, nums
        LW   R2, n(R0)
        ADDI R3, R0, 0          ; count
loop:   BEQZ R2, done
        LH   R4, 0(R1)          ; sign-extended
        SLTI R5, R4, 0
        ADD  R3, R3, R5         ; count += (num < 0)
        ADDI R1, R1, 2
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 3 },
      { kind: 'out', includes: '3' },
    ],
  },

  /* ------------------------------------------------------------ P7 */
  {
    id: 'P7', name: 'P7 — add 16-bit numbers via an address table',
    brief: 'Indirect addressing: a table of word pointers is walked, each pointing at a halfword. Sum = 655.',
    code: `; P7: add a series of 16-bit numbers using a table of addresses
        .data
v0:     .half 100
v1:     .half 200
v2:     .half 300
v3:     .half 55
tbl:    .word v0, v1, v2, v3    ; table of addresses
n:      .word 4
result: .word 0

        .text
main:   ADDI R1, R0, tbl
        LW   R2, n(R0)
        ADDI R3, R0, 0          ; sum
loop:   BEQZ R2, done
        LW   R4, 0(R1)          ; fetch address from table
        LH   R5, 0(R4)          ; fetch value via that address
        ADD  R3, R3, R5
        ADDI R1, R1, 4
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 655 },
      { kind: 'out', includes: '655' },
    ],
  },

  /* ------------------------------------------------------------ P8 */
  {
    id: 'P8', name: 'P8 — packed BCD addition',
    brief: 'Adds two packed-BCD 32-bit numbers digit by digit with decimal carry: 19995678 + 00005432 = 20001110.',
    code: `; P8: add two packed BCD numbers -> packed BCD result
;     0x19995678 + 0x00005432 = 0x20001110 (decimal 19995678 + 5432)
        .data
result: .word 0

        .text
main:   LHI  R1, 0x1999
        ORI  R1, R1, 0x5678     ; x
        LHI  R2, 0x0000
        ORI  R2, R2, 0x5432     ; y
        ADDI R3, R0, 0          ; result
        ADDI R4, R0, 0          ; carry
        ADDI R5, R0, 0          ; shift = 0,4,...,28
digit:  SRL  R6, R1, R5
        ANDI R6, R6, 0xF        ; digit of x
        SRL  R7, R2, R5
        ANDI R7, R7, 0xF        ; digit of y
        ADD  R8, R6, R7
        ADD  R8, R8, R4         ; + carry
        SLTI R9, R8, 10
        BNEZ R9, nocarry
        SUBI R8, R8, 10
        ADDI R4, R0, 1
        J    put
nocarry: ADDI R4, R0, 0
put:    SLL  R9, R8, R5
        OR   R3, R3, R9
        ADDI R5, R5, 4
        SLTI R9, R5, 32
        BNEZ R9, digit
        SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 4                  ; print result as hex
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 0x20001110 },
      { kind: 'out', includes: '0x20001110' },
    ],
  },

  /* ------------------------------------------------------------ P9 */
  {
    id: 'P9', name: 'P9 — N×N matrix multiply (N = 3)',
    brief: 'Triple-nested loop computing C = A×B for 3×3 word matrices. Schedule the inner loop to hide load and multiply hazards.',
    code: `; P9: C = A * B for square N x N matrices (N = 3, row-major words)
; A = 1 2 3 / 4 5 6 / 7 8 9      B = 9 8 7 / 6 5 4 / 3 2 1
; C = 30 24 18 / 84 69 54 / 138 114 90
        .data
A:      .word 1, 2, 3, 4, 5, 6, 7, 8, 9
B:      .word 9, 8, 7, 6, 5, 4, 3, 2, 1
C:      .space 36
N:      .word 3

        .text
main:   LW   R10, N(R0)         ; N
        ADDI R1, R0, 0          ; i
iloop:  ADDI R2, R0, 0          ; j
jloop:  ADDI R3, R0, 0          ; k
        ADDI R4, R0, 0          ; acc
kloop:  MULT R5, R1, R10        ; i*N
        ADD  R5, R5, R3         ; i*N + k
        SLLI R5, R5, 2
        LW   R6, A(R5)          ; A[i][k]
        MULT R7, R3, R10        ; k*N
        ADD  R7, R7, R2         ; k*N + j
        SLLI R7, R7, 2
        LW   R8, B(R7)          ; B[k][j]
        MULT R9, R6, R8
        ADD  R4, R4, R9         ; acc += A[i][k]*B[k][j]
        ADDI R3, R3, 1
        SLT  R5, R3, R10
        BNEZ R5, kloop
        MULT R5, R1, R10        ; store C[i][j]
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
`,
    checks: [
      { kind: 'memw', label: 'C', index: 0, value: 30 },
      { kind: 'memw', label: 'C', index: 1, value: 24 },
      { kind: 'memw', label: 'C', index: 4, value: 69 },
      { kind: 'memw', label: 'C', index: 6, value: 138 },
      { kind: 'memw', label: 'C', index: 8, value: 90 },
    ],
  },

  /* ----------------------------------------------------------- P10 */
  {
    id: 'P10', name: 'P10 — recursive Fibonacci',
    brief: 'True recursion with a stack (R29), JAL/JR and caller-saved slots. fib(10) = 55.',
    code: `; P10: fib(n) = fib(n-1) + fib(n-2), fib(0)=0, fib(1)=1  — recursive
        .data
result: .word 0

        .text
main:   ADDI R29, R0, 0x7F00    ; stack pointer
        ADDI R1, R0, 10         ; n = 10
        JAL  fib
        SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1                  ; print 55
        TRAP 0

; ---- int fib(int n)  arg: R1, ret: R2, clobbers R3 ----
fib:    SLTI R3, R1, 2
        BEQZ R3, rec
        ADD  R2, R0, R1         ; fib(0)=0, fib(1)=1
        JR   R31
rec:    SUBI R29, R29, 12
        SW   0(R29), R31        ; save return address
        SW   4(R29), R1         ; save n
        SUBI R1, R1, 1
        JAL  fib                ; fib(n-1)
        SW   8(R29), R2         ; save fib(n-1)
        LW   R1, 4(R29)
        SUBI R1, R1, 2
        JAL  fib                ; fib(n-2)
        LW   R3, 8(R29)
        ADD  R2, R2, R3         ; fib(n-1) + fib(n-2)
        LW   R31, 0(R29)
        ADDI R29, R29, 12
        JR   R31
`,
    checks: [
      { kind: 'memw', label: 'result', value: 55 },
      { kind: 'out', includes: '55' },
    ],
  },

  /* ----------------------------------------------------------- P11 */
  {
    id: 'P11', name: 'P11 — count vowels in a string',
    brief: 'Folds case with AND 0xDF then compares against A/E/I/O/U. "Computer Architecture" has 8 vowels.',
    code: `; P11: count vowels (A E I O U, either case) in a string
        .data
str:    .asciiz "Computer Architecture"
result: .word 0

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; count
loop:   LBU  R3, 0(R1)
        BEQZ R3, done
        ANDI R4, R3, 0xDF       ; fold lowercase -> uppercase
        SEQI R5, R4, 'A'
        BNEZ R5, vowel
        SEQI R5, R4, 'E'
        BNEZ R5, vowel
        SEQI R5, R4, 'I'
        BNEZ R5, vowel
        SEQI R5, R4, 'O'
        BNEZ R5, vowel
        SEQI R5, R4, 'U'
        BEQZ R5, next
vowel:  ADDI R2, R2, 1
next:   ADDI R1, R1, 1
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 8 },
      { kind: 'out', includes: '8' },
    ],
  },

  /* ----------------------------------------------------------- P12 */
  {
    id: 'P12', name: 'P12 — reverse a string',
    brief: 'Finds the length, then copies backwards into a second buffer: "PIPELINE" → "ENILEPIP".',
    code: `; P12: store the reversed string in another memory region
        .data
str:    .asciiz "PIPELINE"
rev:    .space 16

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; length
len:    LBU  R3, 0(R1)
        BEQZ R3, copy
        ADDI R1, R1, 1
        ADDI R2, R2, 1
        J    len
copy:   ADDI R4, R0, rev        ; dst
        SUBI R1, R1, 1          ; src = last char
rloop:  BEQZ R2, done
        LBU  R3, 0(R1)
        SB   0(R4), R3
        SUBI R1, R1, 1
        ADDI R4, R4, 1
        SUBI R2, R2, 1
        J    rloop
done:   SB   0(R4), R0          ; NUL
        ADDI R1, R0, rev
        TRAP 2
        TRAP 0
`,
    checks: [
      { kind: 'mems', label: 'rev', value: 'ENILEPIP' },
      { kind: 'out', includes: 'ENILEPIP' },
    ],
  },

  /* ----------------------------------------------------------- P13 */
  {
    id: 'P13', name: 'P13 — count words in a string',
    brief: 'State machine over separators (space / newline); handles leading and repeated spaces. Result: 4 words.',
    code: `; P13: count words separated by spaces or newlines
        .data
str:    .asciiz "  THE QUICK  BROWN\\nFOX"
result: .word 0

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; word count
        ADDI R3, R0, 0          ; in-word flag
loop:   LBU  R4, 0(R1)
        BEQZ R4, done
        SEQI R5, R4, ' '        ; separator?
        BNEZ R5, sep
        SEQI R5, R4, 10         ; newline?
        BNEZ R5, sep
        BNEZ R3, next           ; already inside a word
        ADDI R2, R2, 1          ; new word begins
        ADDI R3, R0, 1
        J    next
sep:    ADDI R3, R0, 0
next:   ADDI R1, R1, 1
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 4 },
      { kind: 'out', includes: '4' },
    ],
  },

  /* ----------------------------------------------------------- P14 */
  {
    id: 'P14', name: 'P14 — count 16-bit numbers divisible by 4',
    brief: 'Tests the two low bits with ANDI (works for negatives in two\'s complement). 5 of the 8 values qualify.',
    code: `; P14: how many 16-bit integers are divisible by 4
        .data
nums:   .half 4, 7, 8, 12, -16, 3, 20, 5
n:      .word 8
result: .word 0

        .text
main:   ADDI R1, R0, nums
        LW   R2, n(R0)
        ADDI R3, R0, 0          ; count
loop:   BEQZ R2, done
        LH   R4, 0(R1)
        ANDI R5, R4, 3          ; low two bits
        BNEZ R5, skip
        ADDI R3, R3, 1
skip:   ADDI R1, R1, 2
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 5 },
      { kind: 'out', includes: '5' },
    ],
  },

  /* ----------------------------------------------------------- P15 */
  {
    id: 'P15', name: 'P15 — sum of even 16-bit numbers',
    brief: 'Adds every value whose bit 0 is clear: 2 + 4 + 6 + (-8) = 4.',
    code: `; P15: sum of all even 16-bit numbers in an array
        .data
nums:   .half 1, 2, 3, 4, 5, 6, -8
n:      .word 7
result: .word 0

        .text
main:   ADDI R1, R0, nums
        LW   R2, n(R0)
        ADDI R3, R0, 0          ; sum
loop:   BEQZ R2, done
        LH   R4, 0(R1)
        ANDI R5, R4, 1
        BNEZ R5, skip           ; odd -> skip
        ADD  R3, R3, R4
skip:   ADDI R1, R1, 2
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 4 },
      { kind: 'out', includes: '4' },
    ],
  },

  /* ----------------------------------------------------------- P16 */
  {
    id: 'P16', name: 'P16 — bubble sort of 16-bit integers',
    brief: 'Classic nested-loop bubble sort on halfwords with LH/SH swaps: 5 2 9 1 7 3 → 1 2 3 5 7 9.',
    code: `; P16: bubble sort an array of 16-bit integers (ascending)
        .data
arr:    .half 5, 2, 9, 1, 7, 3
n:      .word 6

        .text
main:   LW   R1, n(R0)
        SUBI R1, R1, 1          ; outer passes = n-1
outer:  BEQZ R1, done
        ADDI R2, R0, arr        ; p = &arr[0]
        ADD  R3, R0, R1         ; inner counter
inner:  LH   R4, 0(R2)
        LH   R5, 2(R2)
        SLE  R6, R4, R5         ; already ordered?
        BNEZ R6, noswap
        SH   0(R2), R5          ; swap
        SH   2(R2), R4
noswap: ADDI R2, R2, 2
        SUBI R3, R3, 1
        BNEZ R3, inner
        SUBI R1, R1, 1
        J    outer
done:   TRAP 0
`,
    checks: [
      { kind: 'memh', label: 'arr', index: 0, value: 1 },
      { kind: 'memh', label: 'arr', index: 1, value: 2 },
      { kind: 'memh', label: 'arr', index: 2, value: 3 },
      { kind: 'memh', label: 'arr', index: 3, value: 5 },
      { kind: 'memh', label: 'arr', index: 4, value: 7 },
      { kind: 'memh', label: 'arr', index: 5, value: 9 },
    ],
  },

  /* ----------------------------------------------------------- P17 */
  {
    id: 'P17', name: 'P17 — sum of odd 16-bit numbers',
    brief: 'Adds values whose bit 0 is set: 1 + 3 + 5 + (-7) = 2.',
    code: `; P17: sum of all odd 16-bit numbers in an array
        .data
nums:   .half 1, 2, 3, 4, 5, -7
n:      .word 6
result: .word 0

        .text
main:   ADDI R1, R0, nums
        LW   R2, n(R0)
        ADDI R3, R0, 0          ; sum
loop:   BEQZ R2, done
        LH   R4, 0(R1)
        ANDI R5, R4, 1
        BEQZ R5, skip           ; even -> skip
        ADD  R3, R3, R4
skip:   ADDI R1, R1, 2
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 2 },
      { kind: 'out', includes: '2' },
    ],
  },

  /* ----------------------------------------------------------- P18 */
  {
    id: 'P18', name: 'P18 — count uppercase letters',
    brief: 'Range check \'A\' ≤ c ≤ \'Z\'. "Hello World DLX" has 5 uppercase letters.',
    code: `; P18: count uppercase letters in a NUL-terminated string
        .data
str:    .asciiz "Hello World DLX"
result: .word 0

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; count
loop:   LBU  R3, 0(R1)
        BEQZ R3, done
        SGEI R4, R3, 'A'
        BEQZ R4, next
        SLEI R4, R3, 'Z'
        BEQZ R4, next
        ADDI R2, R2, 1
next:   ADDI R1, R1, 1
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 5 },
      { kind: 'out', includes: '5' },
    ],
  },

  /* ----------------------------------------------------------- P19 */
  {
    id: 'P19', name: 'P19 — remove spaces from a string',
    brief: 'Two-pointer in-place compaction: "A B  C D" becomes "ABCD".',
    code: `; P19: remove all spaces from a NUL-terminated string (in place)
        .data
str:    .asciiz "A B  C D"

        .text
main:   ADDI R1, R0, str        ; read pointer
        ADDI R2, R0, str        ; write pointer
loop:   LBU  R3, 0(R1)
        BEQZ R3, done
        SEQI R4, R3, ' '
        BNEZ R4, skip           ; drop spaces
        SB   0(R2), R3
        ADDI R2, R2, 1
skip:   ADDI R1, R1, 1
        J    loop
done:   SB   0(R2), R0          ; terminate compacted string
        ADDI R1, R0, str
        TRAP 2
        TRAP 0
`,
    checks: [
      { kind: 'mems', label: 'str', value: 'ABCD' },
      { kind: 'out', includes: 'ABCD' },
    ],
  },

  /* ----------------------------------------------------------- P20 */
  {
    id: 'P20', name: 'P20 — append a character to a string',
    brief: 'Walks to the terminator and appends \'!\' inside the buffer\'s capacity: "DLX" → "DLX!".',
    code: `; P20: insert a character at the end of a NUL-terminated string
        .data
str:    .ascii "DLX"
        .byte 0
        .space 12               ; spare capacity
cap:    .word 16                ; total buffer size
ch:     .byte '!'

        .text
main:   ADDI R1, R0, str
        ADDI R2, R0, 0          ; length walked
find:   LBU  R3, 0(R1)
        BEQZ R3, at_end
        ADDI R1, R1, 1
        ADDI R2, R2, 1
        J    find
at_end: LW   R4, cap(R0)
        SUBI R4, R4, 2          ; need room for char + NUL
        SGT  R5, R2, R4
        BNEZ R5, full           ; no room -> leave unchanged
        LBU  R6, ch(R0)
        SB   0(R1), R6          ; append character
        SB   1(R1), R0          ; new terminator
full:   ADDI R1, R0, str
        TRAP 2
        TRAP 0
`,
    checks: [
      { kind: 'mems', label: 'str', value: 'DLX!' },
      { kind: 'out', includes: 'DLX!' },
    ],
  },

  /* ----------------------------------------------------------- P21 */
  {
    id: 'P21', name: 'P21 — factorial (iterative)',
    brief: 'Multiplies n down to 1 in a counted loop: 5! = 120. Watch the MULT feed straight back into itself via forwarding.',
    code: `; P21: factorial (iterative)  5! = 120
        .data
n:      .word 5
result: .word 0
        .text
main:   LW   R1, n(R0)
        ADDI R2, R0, 1
loop:   BEQZ R1, done
        MULT R2, R2, R1
        SUBI R1, R1, 1
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 120 },
      { kind: 'out', includes: '120' },
    ],
  },

  /* ----------------------------------------------------------- P22 */
  {
    id: 'P22', name: 'P22 — GCD (Euclidean algorithm)',
    brief: 'Repeated remainder (a mod b via DIV/MULT/SUB) until b hits zero: gcd(48, 18) = 6.',
    code: `; P22: greatest common divisor via Euclid's algorithm  gcd(48,18)=6
        .data
a:      .word 48
b:      .word 18
result: .word 0
        .text
main:   LW   R1, a(R0)
        LW   R2, b(R0)
loop:   BEQZ R2, done           ; while (b != 0)
        DIV  R3, R1, R2
        MULT R3, R3, R2
        SUB  R4, R1, R3         ; r = a - (a/b)*b = a mod b
        ADD  R1, R2, R0         ; a = b
        ADD  R2, R4, R0         ; b = r
        J    loop
done:   SW   result(R0), R1
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 6 },
      { kind: 'out', includes: '6' },
    ],
  },

  /* ----------------------------------------------------------- P23 */
  {
    id: 'P23', name: 'P23 — linear search',
    brief: 'Scans a word array for a target, returning its index (or -1). Here 16 is found at index 3.',
    code: `; P23: linear search — return the index of the target (=> 3)
        .data
arr:    .word 4, 8, 15, 16, 23, 42
n:      .word 6
target: .word 16
result: .word 0
        .text
main:   LW   R1, n(R0)
        LW   R2, target(R0)
        ADDI R3, R0, arr
        ADDI R4, R0, 0          ; index
loop:   BEQZ R1, notfound
        LW   R5, 0(R3)
        SEQ  R6, R5, R2
        BNEZ R6, found
        ADDI R3, R3, 4
        ADDI R4, R4, 1
        SUBI R1, R1, 1
        J    loop
notfound: ADDI R4, R0, -1
found:  SW   result(R0), R4
        ADD  R1, R0, R4
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 3 },
      { kind: 'out', includes: '3' },
    ],
  },

  /* ----------------------------------------------------------- P24 */
  {
    id: 'P24', name: 'P24 — binary search',
    brief: 'Halves the search window each step on a sorted array: 42 is located at index 5 in far fewer comparisons than a linear scan.',
    code: `; P24: binary search over a sorted array — index of 42 (=> 5)
        .data
arr:    .word 2, 4, 8, 16, 23, 42, 50, 71
n:      .word 8
target: .word 42
result: .word 0
        .text
main:   LW   R1, target(R0)
        ADDI R2, R0, 0          ; lo
        LW   R3, n(R0)
        SUBI R3, R3, 1          ; hi
        ADDI R7, R0, -1         ; result
loop:   SGT  R8, R2, R3         ; while (lo <= hi)
        BNEZ R8, done
        ADD  R4, R2, R3
        SRLI R4, R4, 1          ; mid = (lo+hi)/2
        SLLI R5, R4, 2
        ADDI R6, R0, arr
        ADD  R6, R6, R5
        LW   R9, 0(R6)          ; arr[mid]
        SEQ  R10, R9, R1
        BNEZ R10, foundmid
        SLT  R10, R9, R1
        BEQZ R10, goleft
        ADDI R2, R4, 1          ; arr[mid] < target -> lo = mid+1
        J    loop
goleft: SUBI R3, R4, 1          ; arr[mid] > target -> hi = mid-1
        J    loop
foundmid: ADD R7, R4, R0
done:   SW   result(R0), R7
        ADD  R1, R0, R7
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 5 },
      { kind: 'out', includes: '5' },
    ],
  },

  /* ----------------------------------------------------------- P25 */
  {
    id: 'P25', name: 'P25 — selection sort',
    brief: 'Repeatedly selects the minimum of the unsorted tail and swaps it into place. Sorts {29,10,14,37,13} ascending.',
    code: `; P25: selection sort (ascending)
        .data
arr:    .word 29, 10, 14, 37, 13
n:      .word 5
        .text
main:   LW   R1, n(R0)
        ADDI R2, R0, 0          ; i
outer:  SUBI R7, R1, 1
        SGE  R7, R2, R7         ; i >= n-1 ?
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
        J    inner
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
        J    outer
done:   TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'arr', index: 0, value: 10 },
      { kind: 'memw', label: 'arr', index: 1, value: 13 },
      { kind: 'memw', label: 'arr', index: 2, value: 14 },
      { kind: 'memw', label: 'arr', index: 3, value: 29 },
      { kind: 'memw', label: 'arr', index: 4, value: 37 },
    ],
  },

  /* ----------------------------------------------------------- P26 */
  {
    id: 'P26', name: 'P26 — count primes up to N',
    brief: 'Trial-division primality test inside a counting loop: there are 8 primes in 2..20 (2,3,5,7,11,13,17,19).',
    code: `; P26: count how many primes are in the range 2..20 (=> 8)
        .data
limit:  .word 20
result: .word 0
        .text
main:   LW   R10, limit(R0)
        ADDI R1, R0, 2          ; candidate
        ADDI R11, R0, 0         ; prime count
outer:  SGT  R2, R1, R10
        BNEZ R2, done
        ADDI R3, R0, 2          ; divisor
        ADDI R12, R0, 1         ; assume prime
chk:    MULT R4, R3, R3
        SGT  R5, R4, R1         ; divisor*divisor > candidate ?
        BNEZ R5, tally
        DIV  R6, R1, R3
        MULT R6, R6, R3
        SEQ  R7, R6, R1         ; divides evenly ?
        BEQZ R7, nextd
        ADDI R12, R0, 0         ; not prime
        J    tally
nextd:  ADDI R3, R3, 1
        J    chk
tally:  ADD  R11, R11, R12
        ADDI R1, R1, 1
        J    outer
done:   SW   result(R0), R11
        ADD  R1, R0, R11
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 8 },
      { kind: 'out', includes: '8' },
    ],
  },

  /* ----------------------------------------------------------- P27 */
  {
    id: 'P27', name: 'P27 — palindrome check',
    brief: 'Two pointers walk inward from both ends of a string; "RACECAR" reads the same both ways, so the result is 1.',
    code: `; P27: is the string a palindrome?  ("RACECAR" => 1)
        .data
s:      .asciiz "RACECAR"
result: .word 0
        .text
main:   ADDI R1, R0, s          ; left
        ADD  R2, R1, R0
len:    LBU  R3, 0(R2)          ; find the terminator
        BEQZ R3, gotlen
        ADDI R2, R2, 1
        J    len
gotlen: SUBI R2, R2, 1          ; right = last char
        ADDI R4, R0, 1          ; assume palindrome
cmp:    SGE  R5, R1, R2         ; pointers crossed ?
        BNEZ R5, done
        LBU  R6, 0(R1)
        LBU  R7, 0(R2)
        SEQ  R8, R6, R7
        BNEZ R8, cont
        ADDI R4, R0, 0          ; mismatch -> not a palindrome
        J    done
cont:   ADDI R1, R1, 1
        SUBI R2, R2, 1
        J    cmp
done:   SW   result(R0), R4
        ADD  R1, R0, R4
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 1 },
      { kind: 'out', includes: '1' },
    ],
  },

  /* ----------------------------------------------------------- P28 */
  {
    id: 'P28', name: 'P28 — reverse an array in place',
    brief: 'Swaps elements from both ends toward the middle with no extra buffer: {1,2,3,4,5} becomes {5,4,3,2,1}.',
    code: `; P28: reverse a word array in place
        .data
arr:    .word 1, 2, 3, 4, 5
n:      .word 5
        .text
main:   ADDI R1, R0, arr        ; left pointer
        LW   R2, n(R0)
        SUBI R2, R2, 1
        SLLI R2, R2, 2
        ADD  R2, R1, R2         ; right = &arr[n-1]
loop:   SGE  R5, R1, R2         ; pointers met/crossed ?
        BNEZ R5, done
        LW   R3, 0(R1)
        LW   R4, 0(R2)
        SW   0(R1), R4
        SW   0(R2), R3
        ADDI R1, R1, 4
        SUBI R2, R2, 4
        J    loop
done:   TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'arr', index: 0, value: 5 },
      { kind: 'memw', label: 'arr', index: 1, value: 4 },
      { kind: 'memw', label: 'arr', index: 2, value: 3 },
      { kind: 'memw', label: 'arr', index: 3, value: 2 },
      { kind: 'memw', label: 'arr', index: 4, value: 1 },
    ],
  },

  /* ----------------------------------------------------------- P29 */
  {
    id: 'P29', name: 'P29 — sum of decimal digits',
    brief: 'Peels off digits with divide-by-10 and remainder: the digits of 12345 sum to 15.',
    code: `; P29: sum of the decimal digits of a number  (12345 => 15)
        .data
num:    .word 12345
result: .word 0
        .text
main:   LW   R1, num(R0)
        ADDI R2, R0, 0          ; sum
        ADDI R3, R0, 10
loop:   BEQZ R1, done
        DIV  R4, R1, R3         ; n / 10
        MULT R5, R4, R3
        SUB  R6, R1, R5         ; digit = n - (n/10)*10
        ADD  R2, R2, R6
        ADD  R1, R4, R0         ; n = n / 10
        J    loop
done:   SW   result(R0), R2
        ADD  R1, R0, R2
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 15 },
      { kind: 'out', includes: '15' },
    ],
  },

  /* ----------------------------------------------------------- P30 */
  {
    id: 'P30', name: 'P30 — integer power (x^n)',
    brief: 'Repeated multiplication computes 3^5 = 243. A tight MULT-dependent loop — a good forwarding-on/off comparison.',
    code: `; P30: integer exponentiation  base^exp  (3^5 = 243)
        .data
base:   .word 3
exp:    .word 5
result: .word 0
        .text
main:   LW   R1, base(R0)
        LW   R2, exp(R0)
        ADDI R3, R0, 1          ; acc = 1
loop:   BEQZ R2, done
        MULT R3, R3, R1         ; acc *= base
        SUBI R2, R2, 1
        J    loop
done:   SW   result(R0), R3
        ADD  R1, R0, R3
        TRAP 1
        TRAP 0
`,
    checks: [
      { kind: 'memw', label: 'result', value: 243 },
      { kind: 'out', includes: '243' },
    ],
  },
  ];

  /* Present the examples in a fixed, non-sequential order so the menu
   * reads as a varied collection rather than a rigid P1..P30 list. The
   * shuffle is deterministic (fixed seed) so the order is stable across
   * loads, and it is order-independent for the test harness. */
  (function shuffle(a) {
    let seed = 0x9e3779b9 >>> 0;
    const rnd = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;  seed >>>= 0;
      return seed / 4294967296;
    };
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
  })(EXAMPLES);

  root.DLX_EXAMPLES = EXAMPLES;
  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
})(typeof self !== 'undefined' ? self : globalThis);
