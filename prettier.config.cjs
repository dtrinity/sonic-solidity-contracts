module.exports = {
  printWidth: 140, // Align with shared ESLint config to avoid guardrail conflicts
  // TS/JS style
  tabWidth: 2,
  useTabs: false,
  singleQuote: false,
  semi: true,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  plugins: ["prettier-plugin-solidity"],
  overrides: [
    {
      files: "*.sol",
      options: {
        // Solidity code in this repo uses 4-space indentation
        tabWidth: 4,
        printWidth: 120, // https://docs.soliditylang.org/en/latest/style-guide.html#maximum-line-length
      },
    },
  ],
};
