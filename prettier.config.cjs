module.exports = {
  // Keep consistent with ESLint max-len (140)
  printWidth: 140,
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
        printWidth: 140,
      },
    },
  ],
};
