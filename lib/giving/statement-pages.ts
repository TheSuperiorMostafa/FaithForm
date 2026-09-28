/** Keep each PDF page within its measured row capacity so headers never split. */
export function statementPageSizes(rowCount: number, linesPerRow = 1): number[] {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error("Statement row count must be a nonnegative integer.");
  }
  if (!Number.isSafeInteger(linesPerRow) || linesPerRow < 1 || linesPerRow > 14) {
    throw new Error("A fund name is too long to fit safely on a statement page.");
  }
  const firstCapacity = Math.floor(18 / linesPerRow);
  const middleCapacity = Math.floor(24 / linesPerRow);
  const lastCapacity = Math.floor(14 / linesPerRow);
  if (rowCount <= lastCapacity) return [rowCount];

  const pageCount = rowCount <= firstCapacity + lastCapacity
    ? 2
    : Math.ceil((rowCount - firstCapacity - lastCapacity) / middleCapacity) + 2;
  const last = Math.min(lastCapacity, Math.ceil(rowCount / pageCount));
  const first = Math.min(firstCapacity, Math.ceil((rowCount - last) / (pageCount - 1)));
  const middlePages = pageCount - 2;
  const middleRows = rowCount - first - last;
  const middle = Array.from({ length: middlePages }, (_, index) =>
    Math.floor(middleRows / middlePages) + (index < middleRows % middlePages ? 1 : 0),
  );
  return [first, ...middle, last];
}
