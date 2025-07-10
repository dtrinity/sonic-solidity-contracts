declare module "hardhat" {
  export = any;
}

declare module "hardhat/config" {
  export interface HardhatUserConfig {
    [key: string]: any;
  }
}

declare module "hardhat/types" {
  export interface HardhatRuntimeEnvironment {
    [key: string]: any;
  }
}