/**
 * Timing and table formatting for the benches.
 *
 * The headline is the median rather than the mean: one run that lands during a garbage
 * collection or a background compile drags a mean somewhere the code never actually goes, and
 * the question these benches answer is what a path costs *usually*. The spread is printed
 * beside it so a suspiciously wide one is visible rather than hidden behind a single number.
 */

export type Sample = { median: number; min: number; max: number; runs: number }

/**
 * `between` runs after every sample and is not timed, for paths that have to undo themselves
 * before they can be repeated: mounting a pane a second time means tearing down the first, and
 * that teardown is not what is being asked about.
 */
export function measure(runs: number, body: () => void, between?: () => void): Sample {
  const samples: number[] = []
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    body()
    samples.push(performance.now() - started)
    between?.()
  }
  samples.sort((a, b) => a - b)
  return {
    median: samples[samples.length >> 1]!,
    min: samples[0]!,
    max: samples[samples.length - 1]!,
    runs,
  }
}

/** Milliseconds, at a precision that doesn't imply more than the clock can tell you. */
export const ms = (value: number): string => `${value.toFixed(value < 10 ? 2 : 1)}ms`

/** A sample as one cell: the median, with the spread it came from. */
export const spread = (sample: Sample): string =>
  `${ms(sample.median)}  (${ms(sample.min)}–${ms(sample.max)}, n=${sample.runs})`

export function table(title: string, headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  // First column labels, the rest are numbers — which only line up read down when right-aligned.
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column]!) : (cell ?? '').padStart(widths[column]!),
      )
      .join('   ')
  const rule = widths.map((width) => '─'.repeat(width)).join('───')

  return ['', title, rule, line(headers), rule, ...rows.map(line), rule, ''].join('\n')
}
