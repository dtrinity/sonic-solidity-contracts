// Type stubs to satisfy the TypeScript compiler during CI where node_modules may not be installed.
// These can be removed once the respective @types packages are installed in the environment.

declare module "hardhat" {
  const value: any;
  export = value;
}

declare module "hardhat-deploy" {
  const value: any;
  export = value;
}

declare module "hardhat-deploy/dist/types" {
  const value: any;
  export = value;
}