/**
 * Save the data to a file
 * - Create the immediate parent directories if they do not exist
 *
 * @param filePath - The file path
 * @param data - The data to save in string format
 */
export function saveToFile(filePath: string, data: string): void {
  // Create the immediate parent directories if they do not exist
  const path = require("path");
  const fs = require("fs");

  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, data);
}
