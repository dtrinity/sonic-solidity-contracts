import { getDecimals } from "./utils";

describe("Test getDecimals()", () => {
  it("should return the number of decimals of a price unit", () => {
    expect(getDecimals(1000000000000000000n)).toBe(18);
    expect(getDecimals(1000000n)).toBe(6);
    expect(getDecimals(100n)).toBe(2);
  });
});
