import type { DeploymentsExtension } from 'hardhat-deploy/types';

export interface DeploymentLike {
  address: string;
  abi: any[];
  name?: string;
}

export interface ClassifiedDeployments {
  aggregators: DeploymentLike[];
  wrappers: DeploymentLike[];
  others: DeploymentLike[];
}

function hasFn(abi: any[], name: string): boolean {
  return Array.isArray(abi) && abi.some((item: any) => item?.type === 'function' && item?.name === name);
}

export async function classifyDeployments(deployments: DeploymentsExtension): Promise<ClassifiedDeployments> {
  const allDeployments = await deployments.all();
  const aggregators: DeploymentLike[] = [];
  const wrappers: DeploymentLike[] = [];
  const others: DeploymentLike[] = [];

  for (const [name, deployment] of Object.entries(allDeployments)) {
    const abi = (deployment as any).abi ?? [];
    const item: DeploymentLike = {
      name,
      address: (deployment as any).address,
      abi,
    };

    const isAggregator = hasFn(abi, 'setOracle') || hasFn(abi, 'assetOracles');
    const isWrapper = hasFn(abi, 'getPriceInfo') || hasFn(abi, 'getAssetPrice');

    if (isAggregator) {
      aggregators.push(item);
    } else if (isWrapper) {
      wrappers.push(item);
    } else {
      others.push(item);
    }
  }

  return { aggregators, wrappers, others };
}
