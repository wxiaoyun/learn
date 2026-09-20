import { configFromEnv, startServer } from "./server"

const config = configFromEnv()
const running = await startServer(config)
console.log(JSON.stringify({ status: "listening", host: "127.0.0.1", port: running.port, root: config.root }))

await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve)
  process.once("SIGTERM", resolve)
})
await running.close()
