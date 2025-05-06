/**
 * Prints a log message with a timestamp and session index
 *
 * @param index - Index of the session
 * @param message - Message to print
 */
export function printLog(index: number, message: string): void {
  console.log(`${new Date().toISOString()} [${index}] ${message}`);
}
