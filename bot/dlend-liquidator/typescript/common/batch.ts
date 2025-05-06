/**
 * Process the inputs in batches
 *
 * @param inputs - Array of inputs
 * @param batchSize - Batch size
 * @param processor - The processor function
 * @param printProgress - Whether to print progress
 * @returns Array of results
 */
export async function batchProcessing<T, R>(
  inputs: T[],
  batchSize: number,
  processor: (input: T) => Promise<R>,
  printProgress: boolean = false,
): Promise<R[]> {
  const result: R[] = [];

  for (let i = 0; i < inputs.length; i += batchSize) {
    if (printProgress) {
      console.log(
        `Processing batch ${i / batchSize + 1} of ${Math.ceil(inputs.length / batchSize)}`,
      );
    }
    const batch = inputs.slice(i, i + batchSize);
    const batchResult = await Promise.all(batch.map(processor));
    result.push(...batchResult);
  }

  if (printProgress) {
    console.log(`Processed ${inputs.length} inputs`);
  }
  return result;
}

/**
 * Split the input array into batches with the given batch size
 *
 * @param array - Input array
 * @param batchSize - Batch size
 * @returns - Array of batches
 */
export function splitToBatches<T>(array: T[], batchSize: number): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < array.length; i += batchSize) {
    result.push(array.slice(i, i + batchSize));
  }
  return result;
}
