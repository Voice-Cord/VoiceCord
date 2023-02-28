module.exports = {
  root: true,
  parserOptions: { tsconfigRootDir: __dirname },
  overrides: [
    {
      files: ["*.ts"],
      plugins: ["@typescript-eslint"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: ["tsconfig.json"],
        emitDecoratorMetadata: true,
        createDefaultProgram: true,
      },
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/strict",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
      ],
      rules: {
        // Eslint possible problems rules
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-dynamic-delete": "off",
        "@typescript-eslint/non-nullable-type-assertion-style": "off",
        "array-callback-return": ["warn", { checkForEach: true }],
        "no-await-in-loop": "warn",
        "no-constant-binary-expression": "warn",
        "no-constructor-return": "warn",
        "no-duplicate-imports": ["warn", { includeExports: true }],
        "no-promise-executor-return": "warn",
        "no-self-compare": "warn",
        "no-template-curly-in-string": "warn",
        "no-unmodified-loop-condition": "warn",
        "no-unreachable-loop": "warn",
        "no-unused-private-class-members": "warn",
        "require-atomic-updates": "warn",

        // Eslint suggestion rules
        "capitalized-comments": [
          "warn",
          "always",
          { ignoreConsecutiveComments: true },
        ],
        complexity: ["warn", { max: 5 }],
        curly: "warn",
        "default-case": "warn",
        "default-case-last": "warn",
        "func-name-matching": "warn",
        "func-style": ["warn", "declaration"],
        "grouped-accessor-pairs": ["warn", "setBeforeGet"],
        "max-depth": ["warn", { max: 2 }],
        "max-lines": ["warn", 2000],
        "max-lines-per-function": ["warn", { max: 100 }],
        "max-nested-callbacks": ["warn", { max: 5 }],
        "max-params": ["warn", { max: 5 }],
        "max-statements": ["warn", { max: 17 }],
        "no-empty-static-block": "warn",
        "no-eval": "warn",
        "no-extend-native": "warn",
        "no-extra-bind": "warn",
        "no-extra-label": "warn",
        "no-floating-decimal": "warn",
        "no-implicit-coercion": "warn",
        "no-implicit-globals": "warn",
        "no-implied-eval": "warn",
        "no-iterator": "warn",
        "no-label-var": "warn",
        "no-lone-blocks": "warn",
        "no-lonely-if": "warn",
        "no-multi-assign": "warn",
        "no-new-func": "warn",
        "no-new-native-nonconstructor": "warn",
        "no-new-object": "warn",
        "no-new-wrappers": "warn",
        "no-octal-escape": "warn",
        "no-proto": "warn",
        "no-return-assign": "warn",
        "no-script-url": "warn",
        "no-sequences": "warn",
        "no-throw-literal": "warn",
        "no-undefined": "warn",
        "no-unneeded-ternary": "warn",
        "no-useless-call": "warn",
        "no-useless-computed-key": "warn",
        "no-useless-concat": "warn",
        "no-useless-rename": "warn",
        "no-useless-return": "warn",
        "object-shorthand": "warn",
        "operator-assignment": "warn",
        "prefer-arrow-callback": "warn",
        "prefer-exponentiation-operator": "warn",
        "prefer-named-capture-group": "warn",
        "prefer-object-has-own": "warn",
        "prefer-object-spread": "warn",
        "prefer-promise-reject-errors": "warn",
        "prefer-regex-literals": "warn",
        "prefer-rest-params": "warn",
        "prefer-spread": "warn",
        "prefer-template": "warn",
        radix: "warn",
        "require-await": "warn",
        "require-unicode-regexp": "warn",
        "spaced-comment": "warn",
        "symbol-description": "warn",
        yoda: "warn",

        // Eslint new typescript rules
        "@typescript-eslint/consistent-type-assertions": [
          "warn",
          {
            assertionStyle: "as",
            objectLiteralTypeAssertions: "never",
          },
        ],
        "@typescript-eslint/consistent-type-definitions": "off", // typescripts strict plugin had turned this on
        "@typescript-eslint/consistent-type-exports": [
          "warn",
          { fixMixedExportsWithInlineTypeSpecifier: true },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "warn",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/explicit-function-return-type": [
          "warn",
          { allowConciseArrowFunctionExpressionsStartingWithVoid: true },
        ],
        "@typescript-eslint/explicit-member-accessibility": "warn",
        "@typescript-eslint/explicit-module-boundary-types": "warn",
        "@typescript-eslint/member-ordering": "warn",
        "@typescript-eslint/method-signature-style": "warn",
        "@typescript-eslint/naming-convention": [
          "warn",
          {
            selector: "typeLike",
            format: ["StrictPascalCase"],
          },
          {
            selector: "interface",
            format: ["StrictPascalCase"],
            prefix: ["I"],
          },
          {
            selector: "class",
            modifiers: ["abstract"],
            format: ["StrictPascalCase"],
            prefix: ["A"],
          },
          {
            selector: "typeParameter",
            format: ["StrictPascalCase"],
            suffix: ["Type"],
          },
          {
            selector: "default",
            format: ["strictCamelCase"],
            leadingUnderscore: "allow",
            trailingUnderscore: "forbid",
          },
        ],
        "@typescript-eslint/no-confusing-void-expression": [
          "warn",
          { ignoreArrowShorthand: true },
        ],
        "@typescript-eslint/no-extraneous-class": [
          "warn",
          { allowWithDecorator: true },
        ],
        "@typescript-eslint/no-redundant-type-constituents": "warn",
        "@typescript-eslint/no-require-imports": "warn",
        "@typescript-eslint/no-unnecessary-qualifier": "warn",
        "@typescript-eslint/no-useless-empty-export": "warn",
        "@typescript-eslint/parameter-properties": [
          "warn",
          { prefer: "parameter-property" },
        ],
        "@typescript-eslint/prefer-readonly": "warn",
        "@typescript-eslint/prefer-regexp-exec": "warn",
        "@typescript-eslint/require-array-sort-compare": "warn",
        "@typescript-eslint/sort-type-constituents": "warn",
        "@typescript-eslint/strict-boolean-expressions": "warn",
        "@typescript-eslint/switch-exhaustiveness-check": "warn",

        // Eslint typescript extension rules
        "@typescript-eslint/default-param-last": "warn",
        "@typescript-eslint/no-invalid-this": "warn",
        "@typescript-eslint/no-loop-func": "warn",
        "@typescript-eslint/no-redeclare": "warn",
        "@typescript-eslint/no-restricted-imports": [
          "warn",
          {
            patterns: ["../*"],
            message:
              "Please use absolute imports when referencing parent directories.",
          },
        ],
        "@typescript-eslint/no-shadow": "warn",
        "@typescript-eslint/no-unused-expressions": "warn",
        "@typescript-eslint/return-await": "warn",
      },
    },
    {
      // For all test files
      files: ["cypress/**/*.ts", "src/**/*.spec.ts"],
      rules: {
        // Allows the test function to have multiple tests in them.
        // Because the describe function function might get above the limit
        "max-lines": ["warn", 300],
        "max-lines-per-function": ["warn", { max: 300 }],
        "max-statements": ["warn", { max: 20 }],

        // Null exceptions are okay in tests, this indicates that the test fails
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
    {
      files: ["src/**/*.spec.ts"],
      parserOptions: { project: ["tsconfig.spec.json"] },
      plugins: ["jest"],
      extends: ["plugin:jest/all"],
      rules: {
        "jest/prefer-lowercase-title": "off",
        "jest/prefer-expect-assertions": "off",
        "jest/prefer-to-be": "off",
        "jest/prefer-expect-resolves": "off",

        // You should turn the original rule off ONLY for test files
        "@typescript-eslint/unbound-method": "off",
        "jest/unbound-method": "error",

        // Methods that count as assertions (avoids the "no assertion in test"
        // warning)
        "jest/expect-expect": [
          "warn",
          {
            assertFunctionNames: [
              "expect",
              "expectToBeVisible",
              "expectToBeHidden",
            ],
          },
        ],

        // In certain test functions, allow returning tuple objects without
        // specifying the return type of the function. Allows methods like
        // "renderComponent" to return objects with multiple properties, and
        // then on the call side to use object destructering to only select the
        // needed properties
        "@typescript-eslint/explicit-function-return-type": [
          "warn",
          {
            allowConciseArrowFunctionExpressionsStartingWithVoid: true,
            allowedNames: [
              "renderComponent",
              "renderComponentWithMocks",
              "createService",
              "createServiceWithMocks",
              "createMocks",
            ],
          },
        ],
      },
    },
    {
      files: ["cypress/**/*.ts"],
      parserOptions: { project: ["cypress/tsconfig.json"] },
      extends: [
        "plugin:cypress/recommended",
        "plugin:chai-friendly/recommended",
      ],
      rules: {
        "cypress/assertion-before-screenshot": "warn",
        "cypress/no-force": "warn",
        "cypress/no-pause": "warn",
      },
    },
  ],
};
