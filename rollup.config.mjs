import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
export default {
    input: "main.ts",
    output: {
        dir: ".",
        sourcemap: false,
        format: "cjs"
    },
    external: ["obsidian"],
    plugins: [
        typescript({
            // Preserve native class inheritance for Obsidian's plugin and view classes.
            target: "ES2017",
            include: ["*.ts"]
        }),
        nodeResolve({ browser: true }),
        commonjs()
    ]
};
