import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, compiled test output under dist/ (created by `tsc -b`,
    // which `npm run build` runs before every acceptance script) gets
    // picked up alongside the real src/ tests and fails as CommonJS.
    exclude: ["**/node_modules/**", "**/dist/**", "**/acceptance-output/**"]
  }
});
