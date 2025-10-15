declare module "ethers" {
  export interface ProviderLike {
    call(transaction: unknown): Promise<unknown>;
  }

  export interface Signer {
    readonly provider?: ProviderLike;
    getAddress(): Promise<string>;
  }
}
