export {}

const serverStatus = document.querySelector<HTMLParagraphElement>("#status")!
const copy = document.querySelector<HTMLButtonElement>("#copy")!

chrome.runtime.sendMessage({ type: "health" }).then((response) => {
  serverStatus.textContent = response?.ok ? "Learning server connected" : "Learning server unreachable"
}).catch(() => {
  serverStatus.textContent = "Learning server unreachable"
})

copy.addEventListener("click", async () => {
  try {
    const logs = await chrome.runtime.sendMessage({ type: "logs" })
    await navigator.clipboard.writeText((Array.isArray(logs) ? logs : [])
      .map((line) => JSON.stringify(line))
      .join("\n"))
    copy.textContent = "Copied"
  } catch {
    copy.textContent = "Copy failed"
  }
})
