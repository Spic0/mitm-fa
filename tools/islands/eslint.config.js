import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Vendored sources are kept byte-close to upstream; they are type-checked but not restyled.
  { ignores: ["src/components/ui/react-bits/**", "src/components/ui/testimonial-globe.tsx"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { "react-hooks": hooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } }
);
