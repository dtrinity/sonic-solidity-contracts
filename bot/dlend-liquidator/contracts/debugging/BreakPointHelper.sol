// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

library BreakPointHelper {
    struct DebugInfo {
        uint256 number;
        string message;
        bytes data;
    }

    event DebugBreakpoint(uint256 breakpoint, string message, bytes data);

    /**
     * @dev Simple breakpoint check with just a number
     * @param currentBreakpoint The current breakpoint value to check against
     * @param breakpointNumber The breakpoint number to trigger the break
     */
    function checkBreakpoint(uint256 currentBreakpoint, uint256 breakpointNumber) internal pure {
        require(currentBreakpoint != breakpointNumber, string.concat("Breakpoint triggered: ", _uint2str(breakpointNumber)));
    }

    /**
     * @dev Breakpoint check with a custom message
     * @param currentBreakpoint The current breakpoint value to check against
     * @param breakpointNumber The breakpoint number to trigger the break
     * @param message Custom message to display when breakpoint is triggered
     */
    function checkBreakpointWithMessage(
        uint256 currentBreakpoint,
        uint256 breakpointNumber,
        string memory message
    ) internal pure {
        require(
            currentBreakpoint != breakpointNumber,
            string.concat("Breakpoint triggered: ", _uint2str(breakpointNumber), " - ", message)
        );
    }

    /**
     * @dev Breakpoint check with debug info struct
     * @param currentBreakpoint The current breakpoint value to check against
     * @param breakpointNumber The breakpoint number to trigger the break
     * @param debugInfo Debug information to log
     */
    function checkBreakpointWithDebugInfo(
        uint256 currentBreakpoint,
        uint256 breakpointNumber,
        DebugInfo memory debugInfo
    ) internal {
        if (currentBreakpoint == breakpointNumber) {
            emit DebugBreakpoint(
                breakpointNumber,
                string.concat(
                    "Breakpoint triggered: ",
                    _uint2str(breakpointNumber),
                    " - ",
                    debugInfo.message
                ),
                debugInfo.data
            );
            revert(string.concat("Breakpoint triggered: ", _uint2str(breakpointNumber)));
        }
    }

    /**
     * @dev Internal helper to convert uint to string
     * @param _i The uint to convert
     * @return The string representation of the uint
     */
    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + j % 10));
            j /= 10;
        }
        return string(bstr);
    }
}
