import fs from "fs";
import path from "path";

interface DeploymentFile {
  address: string;
  // other fields...
}

async function generateWatchlistCSVs() {
  try {
    // Read the contract categories file
    const categoriesPath = path.join(
      __dirname,
      "../scripts/hypernative/contract-categories.md"
    );
    const categoriesContent = fs.readFileSync(categoriesPath, "utf8");

    // Parse core and periphery contracts
    const lines = categoriesContent.split("\n");
    let currentSection = "";
    const coreContracts: string[] = [];
    const peripheryContracts: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine === "### Core Deployments:") {
        currentSection = "core";
        continue;
      }

      if (trimmedLine === "### Periphery Deployments:") {
        currentSection = "periphery";
        continue;
      }

      // Check for contract lines (starting with -)
      if (trimmedLine.startsWith("- ") && trimmedLine.endsWith(".json")) {
        const contractName = trimmedLine.substring(2); // Remove "- "

        if (currentSection === "core") {
          coreContracts.push(contractName);
        } else if (currentSection === "periphery") {
          peripheryContracts.push(contractName);
        }
      }
    }

    console.log(
      `Found ${coreContracts.length} core contracts and ${peripheryContracts.length} periphery contracts`
    );

    // Function to get address from deployment file
    const getContractAddress = (contractFileName: string): string | null => {
      try {
        const deploymentPath = path.join(
          __dirname,
          "../deployments/sonic_mainnet",
          contractFileName
        );

        if (!fs.existsSync(deploymentPath)) {
          console.warn(`Warning: File not found: ${contractFileName}`);
          return null;
        }

        const deploymentContent = fs.readFileSync(deploymentPath, "utf8");
        const deploymentData: DeploymentFile = JSON.parse(deploymentContent);

        return deploymentData.address;
      } catch (error) {
        console.error(`Error reading ${contractFileName}:`, error);
        return null;
      }
    };

    // Generate CSV content for core contracts
    let coreCSV = "Chain,Address\n";
    for (const contractFile of coreContracts) {
      const address = getContractAddress(contractFile);
      if (address) {
        coreCSV += `sonic,${address}\n`;
      }
    }

    // Generate CSV content for periphery contracts
    let peripheryCSV = "Chain,Address\n";
    for (const contractFile of peripheryContracts) {
      const address = getContractAddress(contractFile);
      if (address) {
        peripheryCSV += `sonic,${address}\n`;
      }
    }

    // Write CSV files
    const outputDir = path.join(__dirname, "../");
    fs.writeFileSync(path.join(outputDir, "watchlist_core.csv"), coreCSV);
    fs.writeFileSync(
      path.join(outputDir, "watchlist_periphery.csv"),
      peripheryCSV
    );

    console.log(
      "Generated watchlist_core.csv and watchlist_periphery.csv successfully!"
    );
    console.log(`Core contracts: ${coreContracts.length} entries`);
    console.log(`Periphery contracts: ${peripheryContracts.length} entries`);
  } catch (error) {
    console.error("Error generating watchlist CSVs:", error);
    process.exit(1);
  }
}

// Run the script
generateWatchlistCSVs();
