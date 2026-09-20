import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

const root = import.meta.dir
const dist = join(root, "dist")

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const result = await Bun.build({
  entrypoints: [
    join(root, "src/background.ts"),
    join(root, "src/content.ts"),
    join(root, "src/popup.ts"),
    join(root, "src/review.ts"),
  ],
  outdir: dist,
  target: "browser",
  format: "iife",
  minify: true,
  naming: "[dir]/[name].[ext]",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await Promise.all([
  cp(join(root, "manifest.json"), join(dist, "manifest.json")),
  cp(join(root, "popup.html"), join(dist, "popup.html")),
  cp(join(root, "review.html"), join(dist, "review.html")),
  cp(join(root, "node_modules/katex/dist/katex.min.css"), join(dist, "katex.min.css")),
  cp(join(root, "node_modules/katex/dist/fonts"), join(dist, "fonts"), { recursive: true }),
])

for (const output of result.outputs) {
  console.log(`${output.path.slice(dist.length + 1)} ${output.size} bytes`)
}
