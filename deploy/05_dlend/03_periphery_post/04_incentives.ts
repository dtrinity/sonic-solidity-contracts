import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZeroAddress } from "ethers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, save, getExtendedArtifact, log } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get AddressesProvider address
  const addressesProvider = await deployments.get("AddressesProvider");
  const addressesProviderInstance = await ethers.getContractAt(
    "AddressesProvider",
    addressesProvider.address,
    await ethers.getSigner(deployer)
  );

  // Deploy EmissionManager
  console.log("Deploying EmissionManager...");
  const emissionManager = await deploy("EmissionManager", {
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: 1,
  });

  // Deploy Incentives Implementation (RewardsController)
  console.log("Deploying Incentives Implementation...");
  const incentivesImpl = await deploy("RewardsController", {
    from: deployer,
    args: [emissionManager.address],
    log: true,
    waitConfirmations: 1,
  });

  const incentivesImplContract = await ethers.getContractAt(
    "RewardsController",
    incentivesImpl.address
  );

  // Initialize the implementation
  try {
    await incentivesImplContract.initialize(ZeroAddress);
    console.log("Incentives implementation initialized");
  } catch (error: any) {
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log("Incentives implementation already initialized");
    } else {
      throw Error(`Failed to initialize Incentives implementation: ${error}`);
    }
  }

  // The Rewards Controller must be set at AddressesProvider with id keccak256("INCENTIVES_CONTROLLER")
  const incentivesControllerId = ethers.keccak256(
    ethers.toUtf8Bytes("INCENTIVES_CONTROLLER")
  );

  const isRewardsProxyPending =
    (await addressesProviderInstance.getAddressFromID(
      incentivesControllerId
    )) === ZeroAddress;

  if (isRewardsProxyPending) {
    console.log("Setting rewards controller in AddressesProvider...");
    const proxyArtifact = await getExtendedArtifact(
      "InitializableImmutableAdminUpgradeabilityProxy"
    );

    const setRewardsAsProxyTx =
      await addressesProviderInstance.setAddressAsProxy(
        incentivesControllerId,
        incentivesImpl.address
      );

    const proxyAddress = await addressesProviderInstance.getAddressFromID(
      incentivesControllerId
    );

    await save("IncentivesProxy", {
      ...proxyArtifact,
      address: proxyAddress,
    });

    log(`Attached Rewards implementation and deployed proxy contract`);
    log(`- Tx hash: ${setRewardsAsProxyTx.hash}`);
  }

  const incentivesProxyAddress = (
    await deployments.getOrNull("IncentivesProxy")
  )?.address;
  console.log(`IncentivesProxy deployed at: ${incentivesProxyAddress}`);

  // Initialize EmissionManager with the rewards controller address
  const emissionManagerContract = await ethers.getContractAt(
    "EmissionManager",
    emissionManager.address
  );

  if (incentivesProxyAddress) {
    await emissionManagerContract.setRewardsController(incentivesProxyAddress);
  } else {
    console.log(
      "Warning: IncentivesProxy address is undefined, skipping setRewardsController"
    );
  }

  // Deploy Rewards Strategies
  console.log("Deploying PullRewardsTransferStrategy...");
  const pullRewardsStrategy = await deploy("PullRewardsTransferStrategy", {
    from: deployer,
    args: [
      incentivesProxyAddress,
      deployer, // This should be replaced with the actual emission manager address from config
      deployer, // This should be replaced with the actual incentives vault address from config
    ],
    log: true,
    waitConfirmations: 1,
  });

  // Transfer emission manager ownership if needed
  // This should be uncommented when there's an actual address to transfer to
  // await emissionManagerContract.transferOwnership(
  //  configEmissionManagerAddress
  // );

  return true;
};

func.id = `Incentives`;
func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "dlend-market",
  "AddressesProvider",
];

export default func;
