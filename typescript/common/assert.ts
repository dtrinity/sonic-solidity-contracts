/**
 * Assert that the value is not empty
 *
 * @param value - The value to assert
 * @returns The input value if it is not empty
 */
export function assertNotEmpty(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Value is undefined");
  }

  if (value.trim() === "") {
    throw new Error("Trimmed value is empty");
  }

  if (value.length === 0) {
    throw new Error("Value is empty");
  }
  return value;
}
