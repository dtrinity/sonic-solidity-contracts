import { saveToFile } from "./file";

export class ShortTermIgnoreMemory {
  private memory: Map<string, number>;
  private ignoreDuration: number;
  private stateDirPath: string | undefined;
  private isInitialized: boolean;
  private memoryFilePath: string;

  constructor(ignoreDurationInSeconds: number, stateDirPath?: string) {
    this.memory = new Map<string, number>();
    this.ignoreDuration = ignoreDurationInSeconds * 1000; // Convert to milliseconds

    // If the state directory is not set, then we do not need to save to file
    this.stateDirPath = stateDirPath;
    this.isInitialized = false;
    this.memoryFilePath = `${this.stateDirPath}/ignoreMemory.json`;
  }

  put(value: string): void {
    this.initializeIfNeeded();

    const expiryTime = Date.now() + this.ignoreDuration;
    this.memory.set(value, expiryTime);

    // As the value is added, we need to dump to file
    this.dumpToFileIfNeeded();
  }

  isIgnored(value: string): boolean {
    this.initializeIfNeeded();

    const expiryTime = this.memory.get(value);

    if (!expiryTime) {
      return false;
    }

    if (Date.now() < expiryTime) {
      return true;
    }
    this.memory.delete(value);

    // As the value is removed, we need to dump to file
    this.dumpToFileIfNeeded();

    return false;
  }

  initializeIfNeeded(): void {
    if (this.isInitialized) {
      return;
    }

    if (!this.stateDirPath) {
      this.isInitialized = true;
      return;
    }

    console.log(`Loading ignore memory from ${this.memoryFilePath}`);

    // Create the state directory if it does not exist
    const fs = require("fs");

    if (!fs.existsSync(this.stateDirPath)) {
      fs.mkdirSync(this.stateDirPath, { recursive: true });
    }

    // Load the ignore memory from file
    if (fs.existsSync(this.memoryFilePath)) {
      const data = fs.readFileSync(this.memoryFilePath, "utf8");
      const jsonData = JSON.parse(data);

      if (!jsonData) {
        throw new Error(`Invalid JSON data at ${this.memoryFilePath}`);
      }

      if (jsonData.ignoreDuration !== this.ignoreDuration) {
        throw new Error(
          `The ignore duration in the file ${this.memoryFilePath} does not match the current duration`,
        );
      }

      if (!jsonData.memory) {
        throw new Error(`Invalid memory data at ${this.memoryFilePath}`);
      }

      this.ignoreDuration = jsonData.ignoreDuration;

      // Convert the memory data to Map
      this.memory = new Map<string, number>(Object.entries(jsonData.memory));
    }

    console.log(`Loaded ignore memory with ${this.memory.size} entries`);

    this.isInitialized = true;
  }

  dumpToFileIfNeeded(): void {
    this.initializeIfNeeded();

    // Only dump to file if the state directory is set
    if (!this.stateDirPath) {
      return;
    }

    const data = {
      ignoreDuration: this.ignoreDuration,
      memory: Object.fromEntries(this.memory),
    };

    // Save to JSON file with pretty print
    saveToFile(this.memoryFilePath, JSON.stringify(data, null, 2));
  }

  getStateDirPath(): string {
    if (!this.stateDirPath) {
      throw new Error("State directory path is not set");
    }
    return this.stateDirPath;
  }
}
