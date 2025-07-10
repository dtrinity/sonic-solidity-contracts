declare module "hardhat-deploy" {
  export = any;
}

declare module "hardhat-deploy/dist/types" {
  export = any;
}

declare module "hardhat-deploy/types" {
  export interface DeployFunction {
    (hre: any): Promise<any>;
    tags?: string[];
    dependencies?: string[];
  }
}