# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

Personal learning system based on Amos Blomqvist's video, [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU).

## Layout

- `packages/core/` contains shared schemas, file helpers, and skills.
- `packages/pi/` contains pi extensions, agents, settings, and its skill symlink.

## Install

Clone this repo, install dependencies, then link its pi config into your learning project:

```bash
git clone https://github.com/wxiaoyun/learn
cd learn
mise install
bun install
cd /path/to/your-learning-project
ln -s /path/to/learn/packages/pi .pi
```

Start pi in the learning project. The optional visual makers still require a compatible subagent implementation and their system rendering tools.

