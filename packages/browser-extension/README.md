# Learning YouTube surface

Chrome Manifest V3 browser extension for playing Quiz plans on YouTube.

## Build

```sh
mise exec -- bun install
mise exec -- bun run --cwd packages/browser-extension build
```

Load `packages/browser-extension/dist` with `chrome://extensions`, Developer mode, Load unpacked.

## Stable extension ID

The manifest contains a fixed RSA public key. The private key was discarded. The resulting extension ID is:

```text
ikiokbkockjjgcogfnggafjclojofmbj
```

Start the learning server with this exact allowlist:

```sh
LEARNING_ALLOWED_ORIGINS=chrome-extension://ikiokbkockjjgcogfnggafjclojofmbj mise exec -- bun run server
```

## Demo

With the server running, seed the demo Course:

```sh
mise exec -- bun run --cwd packages/browser-extension seed-demo
```

Open <https://www.youtube.com/watch?v=jNQXAC9IVRw>. Normal playback shows the Pre-question near `0:01`, Pause quizzes near `0:06` and `0:12`, then the Recap quiz when the video ends. Seeking across quiz locations shows one toast and defers those Questions to the Recap quiz.

Use number keys to select an option. Press Enter to confirm or continue. Press Escape or choose Skip to skip. The toolbar popup checks server status and copies the latest 400 structured log lines.
