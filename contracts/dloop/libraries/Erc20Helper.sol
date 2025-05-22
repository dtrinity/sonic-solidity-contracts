library Erc20Helper {
    function isERC20(address token) internal view returns (bool) {
        try ERC20(token).totalSupply() returns (uint256) {
            try ERC20(token).balanceOf(address(this)) returns (uint256) {
                return true;
            } catch {
                return false;
            }
        }
    }
}