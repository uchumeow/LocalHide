import { readFile, writeFile, readdir } from "fs/promises";
import { createHash } from "crypto";

import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import swc from "@swc/core";

const watch = process.argv.includes("-w");

const extensions = [".js", ".jsx", ".mjs", ".ts", ".tsx"];

/** @type import("rollup").InputPluginOption */
const plugins = [
    nodeResolve(),
    commonjs(),
    {
        name: "swc",
        async transform(code, id) {
            const ext = id.slice(id.lastIndexOf("."));
            if (!extensions.includes(ext)) return null;

            const ts = ext === ".ts" || ext === ".tsx" || ext.endsWith(".cts") || ext.endsWith(".mts");
            const tsx = ts ? ext.endsWith("x") : undefined;
            const jsx = !ts ? ext.endsWith("x") : undefined;

            const result = await swc.transform(code, {
                filename: id,
                jsc: {
                    externalHelpers: true,
                    parser: {
                        syntax: ts ? "typescript" : "ecmascript",
                        tsx,
                        jsx
                    }
                },
                env: {
                    targets: "defaults",
                    include: [
                        "transform-classes",
                        "transform-arrow-functions"
                    ]
                }
            });
            return result.code;
        }
    },
    esbuild({ minify: true })
];

async function build() {
    const manifest = JSON.parse(await readFile("./manifest.json", "utf8"));
    const outPath = "./dist/LocalHide/index.js";

    try {
        const bundle = await rollup({
            input: `./${manifest.main}`,
            onwarn: () => {},
            external: id => ["react", "react-native"].includes(id) || id.startsWith("@vendetta"),
            plugins
        });

        await bundle.write({
            file: outPath,
            globals(id) {
                if (id.startsWith("@vendetta")) return id.slice(1).replace(/\//g, ".");
                const map = {
                    react: "window.React",
                    "react-native": "vendetta.metro.common.ReactNative"
                };
                return map[id] || null;
            },
            format: "iife",
            compact: true,
            exports: "named",
            inlineDynamicImports: true
        });
        await bundle.close();

        const js = await readFile(outPath);
        manifest.hash = createHash("sha256").update(js).digest("hex");
        manifest.main = "index.js";
        await writeFile("./dist/LocalHide/manifest.json", JSON.stringify(manifest));

        console.log(`Built LocalHide (${(js.length / 1024).toFixed(1)} KiB) -> dist/LocalHide`);
    } catch (e) {
        console.error("Build failed:", e);
        process.exit(1);
    }
}

await build();
if (watch) {
    console.log("Watch mode is not implemented in this minimal script; rerun npm run build.");
}
