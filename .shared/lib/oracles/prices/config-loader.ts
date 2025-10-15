import fs from 'fs';
import path from 'path';

import type { HardhatRuntimeEnvironment } from 'hardhat/types';

import { findProjectRoot } from '../../utils';

type NetworkConfigModule = { getConfig: (hre: HardhatRuntimeEnvironment) => Promise<any> | any };

export async function loadNetworkOracleConfig(hre: HardhatRuntimeEnvironment): Promise<any | undefined> {
  const networkName = hre.network.name;
  const projectRoot = findProjectRoot();
  const candidates = [
    path.join(projectRoot, 'config', 'networks', `${networkName}.ts`),
    path.join(projectRoot, 'config', 'networks', `${networkName}.mts`),
    path.join(projectRoot, 'config', 'networks', networkName, 'index.ts'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = (await import(candidate)) as NetworkConfigModule;
    if (typeof module.getConfig === 'function') {
      return module.getConfig(hre);
    }
  }

  return undefined;
}
