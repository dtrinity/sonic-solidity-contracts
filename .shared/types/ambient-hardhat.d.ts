declare module "hardhat-deploy/types" {
  export type Address = string;
  export type DeploymentsExtension = {
    readonly all: () => Promise<Record<string, { address?: string }>>;
    readonly getOrNull: (name: string) => Promise<{ address?: string } | undefined>;
  };
  export type RecordExtendedDeployment = Record<string, unknown>;
}

declare module "hardhat/types" {
  import type { DeploymentsExtension } from "hardhat-deploy/types";

  export interface HardhatRuntimeEnvironment {
    readonly network: {
      readonly name: string;
      readonly chainId?: number;
      readonly config?: Record<string, unknown>;
      readonly provider?: any;
      [key: string]: unknown;
    };
    readonly config: Record<string, unknown>;
    readonly deployments: DeploymentsExtension;
    readonly ethers: {
      readonly formatUnits: (value: unknown, decimals?: number) => string;
      readonly ZeroAddress: string;
      readonly getContractAt: (abi: unknown, address: string) => Promise<{
        readonly getFunction: (name: string) => {
          readonly staticCall: (...args: unknown[]) => Promise<unknown>;
        };
      }>;
    } & Record<string, unknown>;
    [key: string]: unknown;
  }

  export type Artifact = Record<string, unknown>;
  export type LinkReferences = Record<string, unknown>;
}

declare module "hardhat" {
  import type { HardhatRuntimeEnvironment } from "hardhat/types";
  const hre: HardhatRuntimeEnvironment;
  export default hre;
}
