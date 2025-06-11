'npx hardhat clean' running (wd: /Users/dazheng/workspace/dtrinity/sonic-solidity-contracts)
'npx hardhat clean --global' running (wd: /Users/dazheng/workspace/dtrinity/sonic-solidity-contracts)
'npx hardhat compile --force' running (wd: /Users/dazheng/workspace/dtrinity/sonic-solidity-contracts)

Compiled with Builder
Total number of contracts in source files: 253
Number of contracts in dependencies: 58
Number of contracts in tests       : 12
Source lines of code (SLOC) in source files: 24109
Source lines of code (SLOC) in dependencies: 4114
Source lines of code (SLOC) in tests       : 821
Number of  assembly lines: 0
Number of optimization issues: 10
Number of informational issues: 42
Number of low issues: 116
Number of medium issues: 36
Number of high issues: 20

Use: Openzeppelin-Ownable, Openzeppelin-ERC20, Openzeppelin-ERC721
ERCs: ERC20, ERC2612, ERC1363, ERC165, ERC721, ERC4626

+---------------------------------------------------+-------------+-----------------------+--------------------+--------------+--------------------+
| Name                                              | # functions | ERCS                  | ERC20 info         | Complex code | Features           |
+---------------------------------------------------+-------------+-----------------------+--------------------+--------------+--------------------+
| BasisPointConstants                               | 1           |                       |                    | No           |                    |
| Erc20Helper                                       | 1           |                       |                    | No           | Tokens interaction |
| IPriceOracleGetter                                | 3           |                       |                    | No           |                    |
| PriceGetter                                       | 1           |                       |                    | No           |                    |
| SwapHelper                                        | 3           |                       |                    | No           | Tokens interaction |
| AggregatorInterface                               | 5           |                       |                    | No           |                    |
| GPv2SafeERC20                                     | 4           |                       |                    | No           | Assembly           |
| Address                                           | 11          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Delegatecall       |
|                                                   |             |                       |                    |              | Assembly           |
| ERC20                                             | 26          | ERC20                 | No Minting         | No           |                    |
|                                                   |             |                       | Approve Race Cond. |              |                    |
|                                                   |             |                       |                    |              |                    |
| SafeCast                                          | 14          |                       |                    | No           |                    |
| SafeERC20                                         | 6           |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| SafeMath                                          | 5           |                       |                    | No           |                    |
| Strings                                           | 4           |                       |                    | No           |                    |
| AdminUpgradeabilityProxy                          | 20          |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Delegatecall       |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Proxy              |
| Initializable                                     | 1           |                       |                    | No           | Assembly           |
| InitializableAdminUpgradeabilityProxy             | 20          |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Delegatecall       |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
|                                                   |             |                       |                    |              | Proxy              |
| ReservesSetupHelper                               | 7           |                       |                    | No           |                    |
| FlashLoanReceiverBase                             | 4           |                       |                    | No           |                    |
| FlashLoanSimpleReceiverBase                       | 4           |                       |                    | No           |                    |
| IAaveIncentivesController                         | 1           |                       |                    | No           |                    |
| IDelegationToken                                  | 1           |                       |                    | No           |                    |
| IERC20WithPermit                                  | 7           | ERC20                 | No Minting         | No           |                    |
|                                                   |             |                       | Approve Race Cond. |              |                    |
|                                                   |             |                       |                    |              |                    |
| IPriceOracle                                      | 2           |                       |                    | No           |                    |
| ISequencerOracle                                  | 1           |                       |                    | No           |                    |
| AaveOracle                                        | 17          |                       |                    | No           |                    |
| AaveProtocolDataProvider                          | 39          |                       |                    | No           | Tokens interaction |
| L2Encoder                                         | 12          |                       |                    | No           | Assembly           |
| ZeroReserveInterestRateStrategy                   | 25          |                       |                    | No           |                    |
| IWETH                                             | 4           |                       |                    | No           | Receive ETH        |
| ACLManager                                        | 67          | ERC165                |                    | No           |                    |
| PoolAddressesProvider                             | 49          |                       |                    | No           |                    |
| PoolAddressesProviderRegistry                     | 19          |                       |                    | No           |                    |
| PriceOracleSentinel                               | 15          |                       |                    | No           |                    |
| InitializableImmutableAdminUpgradeabilityProxy    | 18          |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Delegatecall       |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
|                                                   |             |                       |                    |              | Proxy              |
| ReserveConfiguration                              | 42          |                       |                    | No           |                    |
| UserConfiguration                                 | 14          |                       |                    | No           |                    |
| Errors                                            | 1           |                       |                    | No           |                    |
| Helpers                                           | 1           |                       |                    | No           | Tokens interaction |
| BorrowLogic                                       | 4           |                       |                    | Yes          | Tokens interaction |
| BridgeLogic                                       | 2           |                       |                    | No           | Tokens interaction |
| CalldataLogic                                     | 10          |                       |                    | No           | Assembly           |
| ConfiguratorLogic                                 | 6           |                       |                    | No           |                    |
| EModeLogic                                        | 3           |                       |                    | No           | Tokens interaction |
| FlashLoanLogic                                    | 3           |                       |                    | No           | Tokens interaction |
| GenericLogic                                      | 4           |                       |                    | Yes          | Tokens interaction |
| IsolationModeLogic                                | 1           |                       |                    | No           |                    |
| LiquidationLogic                                  | 8           |                       |                    | No           | Tokens interaction |
| PoolLogic                                         | 6           |                       |                    | No           | Tokens interaction |
| ReserveLogic                                      | 9           |                       |                    | No           |                    |
| SupplyLogic                                       | 4           |                       |                    | No           | Tokens interaction |
| ValidationLogic                                   | 18          |                       |                    | Yes          | Tokens interaction |
| MathUtils                                         | 4           |                       |                    | No           |                    |
| PercentageMath                                    | 3           |                       |                    | No           | Assembly           |
| WadRayMath                                        | 7           |                       |                    | No           | Assembly           |
| ConfiguratorInputTypes                            | 0           |                       |                    | No           |                    |
| DataTypes                                         | 0           |                       |                    | No           |                    |
| DefaultReserveInterestRateStrategy                | 25          |                       |                    | No           | Tokens interaction |
| L2Pool                                            | 119         |                       |                    | No           | Tokens interaction |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| PoolConfigurator                                  | 66          |                       |                    | No           | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| DelegationAwareAToken                             | 88          | ERC20,ERC2612         | ∞ Minting          | No           | Ecrecover          |
|                                                   |             |                       | Approve Race Cond. |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| StableDebtToken                                   | 84          | ERC20                 | ∞ Minting          | No           | Ecrecover          |
|                                                   |             |                       | Approve Race Cond. |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| VariableDebtToken                                 | 81          | ERC20                 | ∞ Minting          | No           | Ecrecover          |
|                                                   |             |                       | Approve Race Cond. |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| CurveDebtSwapAdapter                              | 26          |                       |                    | Yes          | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| CurveLiquiditySwapAdapter                         | 26          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| CurveRepayAdapter                                 | 27          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| CurveWithdrawSwapAdapter                          | 21          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| IBaseCurveAdapter                                 | 1           |                       |                    | No           |                    |
| ICurveRouterNgPoolsOnlyV1                         | 5           |                       |                    | No           | Receive ETH        |
| IERC3156FlashBorrower                             | 1           |                       |                    | No           |                    |
| IERC3156FlashLender                               | 3           |                       |                    | No           |                    |
| OdosDebtSwapAdapter                               | 25          |                       |                    | Yes          | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| OdosLiquiditySwapAdapter                          | 25          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| OdosRepayAdapter                                  | 19          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| OdosWithdrawSwapAdapter                           | 20          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| DataTypesHelper                                   | 1           |                       |                    | No           | Tokens interaction |
| UiIncentiveDataProviderV3                         | 9           |                       |                    | Yes          | Tokens interaction |
| UiPoolDataProviderV3                              | 9           |                       |                    | Yes          | Tokens interaction |
| WalletBalanceProvider                             | 5           |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Tokens interaction |
| WrappedTokenGatewayV3                             | 23          |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| IEACAggregatorProxy                               | 6           |                       |                    | No           | Proxy              |
| IERC20DetailedBytes                               | 9           | ERC20                 | No Minting         | No           |                    |
|                                                   |             |                       | Approve Race Cond. |              |                    |
|                                                   |             |                       |                    |              |                    |
| IWETH                                             | 4           |                       |                    | No           | Receive ETH        |
| EmissionManager                                   | 29          |                       |                    | No           |                    |
| RewardsController                                 | 82          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| IStakedToken                                      | 5           |                       |                    | No           |                    |
| RewardsDataTypes                                  | 0           |                       |                    | No           |                    |
| PullRewardsTransferStrategy                       | 13          |                       |                    | No           |                    |
| StakedTokenTransferStrategy                       | 19          |                       |                    | No           | Tokens interaction |
| AaveEcosystemReserveController                    | 17          |                       |                    | No           |                    |
| AaveEcosystemReserveV2                            | 28          |                       |                    | No           | Receive ETH        |
|                                                   |             |                       |                    |              | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
|                                                   |             |                       |                    |              | Upgradeable        |
| Collector                                         | 15          |                       |                    | No           | Tokens interaction |
|                                                   |             |                       |                    |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| CollectorController                               | 9           |                       |                    | No           |                    |
| Address                                           | 11          |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Delegatecall       |
|                                                   |             |                       |                    |              | Assembly           |
| SafeERC20                                         | 6           |                       |                    | No           | Send ETH           |
|                                                   |             |                       |                    |              | Tokens interaction |
| AmoManager                                        | 44          | ERC165                |                    | No           | Tokens interaction |
| ICollateralSum                                    | 1           |                       |                    | No           |                    |
| CollateralHolderVault                             | 43          | ERC165                |                    | No           | Tokens interaction |
| ERC20StablecoinUpgradeable                        | 124         | ERC20,ERC165,ERC2612  | Pausable           | No           | Ecrecover          |
|                                                   |             |                       | ∞ Minting          |              | Assembly           |
|                                                   |             |                       | Approve Race Cond. |              | Upgradeable        |
|                                                   |             |                       |                    |              |                    |
| Issuer                                            | 34          | ERC165                |                    | No           | Tokens interaction |
| Redeemer                                          | 29          | ERC165                |                    | No           | Tokens interaction |
| RedeemerWithFees                                  | 34          | ERC165                |                    | No           | Tokens interaction |
| OdosSwapUtils                                     | 1           |                       |                    | No           | Tokens interaction |
|                                                   |             |                       |                    |              | Assembly           |
| OdosSwapper                                       | 2           |                       |                    | No           | Tokens interaction |
| IOdosRouterV2                                     | 20          |                       |                    | No           | Receive ETH        |
| OracleAggregator                                  | 33          | ERC165                |                    | No           |                    |
| ChainlinkDecimalConverter                         | 10          |                       |                    | No           |                    |
| API3CompositeWrapperWithThresholding              | 40          | ERC165                |                    | No           |                    |
| API3WrapperWithThresholding                       | 41          | ERC165                |                    | No           |                    |
| HardPegOracleWrapper                              | 7           |                       |                    | No           |                    |
| RedstoneChainlinkCompositeWrapperWithThresholding | 40          | ERC165                |                    | No           |                    |
| RedstoneChainlinkWrapperWithThresholding          | 41          | ERC165                |                    | No           |                    |
| ECDSA                                             | 7           |                       |                    | No           | Ecrecover          |
|                                                   |             |                       |                    |              | Assembly           |
| RayMathExplicitRounding                           | 6           |                       |                    | No           |                    |
| StaticATokenErrors                                | 1           |                       |                    | No           |                    |
| StaticATokenFactory                               | 8           |                       |                    | No           | Tokens interaction |
| StaticATokenLM                                    | 89          | ERC20,ERC2612,ERC4626 | ∞ Minting          | No           | Ecrecover          |
|                                                   |             |                       | Approve Race Cond. |              | Tokens interaction |
|                                                   |             |                       |                    |              |                    |
| IAToken                                           | 4           |                       |                    | No           |                    |
| DLoopCoreDLend                                    | 168         | ERC20,ERC165,ERC4626  | ∞ Minting          | No           | Tokens interaction |
|                                                   |             |                       | Approve Race Cond. |              |                    |
|                                                   |             |                       |                    |              |                    |
| IPool                                             | 44          |                       |                    | No           |                    |
| IPoolAddressesProvider                            | 19          |                       |                    | No           |                    |
| IPriceOracleGetter                                | 3           |                       |                    | No           |                    |
| IRewardsController                                | 6           |                       |                    | No           |                    |
| DataTypes                                         | 0           |                       |                    | No           |                    |
| IERC3156FlashLender                               | 3           |                       |                    | No           |                    |
| DLoopDecreaseLeverageOdos                         | 28          |                       |                    | Yes          | Tokens interaction |
| DLoopDepositorOdos                                | 29          |                       |                    | No           | Tokens interaction |
| DLoopIncreaseLeverageOdos                         | 28          |                       |                    | Yes          | Tokens interaction |
| DLoopRedeemerOdos                                 | 28          |                       |                    | No           | Tokens interaction |
| OdosSwapLogic                                     | 1           |                       |                    | No           | Tokens interaction |
| DPoolVaultCurveLP                                 | 127         | ERC20,ERC165,ERC4626  | ∞ Minting          | No           | Tokens interaction |
|                                                   |             |                       | Approve Race Cond. |              |                    |
|                                                   |             |                       |                    |              |                    |
| DPoolCurvePeriphery                               | 53          | ERC165                |                    | No           | Tokens interaction |
| DStakeCollateralVault                             | 38          | ERC165                |                    | No           | Tokens interaction |
| DStakeRouterDLend                                 | 32          | ERC165                |                    | Yes          | Tokens interaction |
| DStakeToken                                       | 126         | ERC20,ERC165,ERC4626  | ∞ Minting          | No           | Tokens interaction |
|                                                   |             |                       | Approve Race Cond. |              | Assembly           |
|                                                   |             |                       |                    |              | Upgradeable        |
| WrappedDLendConversionAdapter                     | 13          |                       |                    | No           | Tokens interaction |
| IDLendRewardsController                           | 2           |                       |                    | No           |                    |
| DStakeRewardManagerDLend                          | 39          | ERC165                |                    | No           | Tokens interaction |
| ERC20VestingNFT                                   | 86          | ERC165,ERC721         |                    | No           |                    |
+---------------------------------------------------+-------------+-----------------------+--------------------+--------------+--------------------+
. analyzed (323 contracts)
INFO:Slither:slither-report.json exists already, the overwrite is prevented
