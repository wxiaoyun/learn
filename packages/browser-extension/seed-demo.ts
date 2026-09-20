export {}

const server = process.env.LEARNING_SERVER?.replace(/\/$/, "") ?? "http://127.0.0.1:4517"
const courseId = "demo-youtube-arithmetic"
const unitId = "me-at-zoo-arithmetic"
const videoId = "jNQXAC9IVRw"
const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
const at = (seconds: number) => ({ unitId, anchor: { kind: "video-timestamp", seconds } })

const roadmap = {
  courseId,
  title: "DEMO: YouTube arithmetic",
  goal: "Practice small addition and multiplication facts while testing the YouTube surface.",
  sourceMaterials: [{ title: "Me at the zoo", reference: videoUrl }],
  units: [{
    id: unitId,
    title: "Short arithmetic demo",
    order: 0,
    topics: ["addition", "multiplication"],
    dependsOn: [],
    kind: "youtube-video",
    source: { videoId, url: videoUrl },
  }],
}

const nodes = [
  {
    id: "small-addition",
    title: "Small addition",
    summary: "Add two small nonnegative integers.",
    dependsOn: [],
    taughtAt: [at(1)],
  },
  {
    id: "small-multiplication",
    title: "Small multiplication",
    summary: "Treat multiplication as equal groups.",
    dependsOn: ["small-addition"],
    taughtAt: [at(12)],
  },
]

const choice = (
  id: string,
  nodeId: string,
  tier: "recall" | "application",
  prompt: string,
  options: string[],
  correctIndex: number,
  explanation: string,
) => ({ id, nodeId, tier, kind: "choice", prompt, options, correctIndex, explanation })

const plan = {
  courseId,
  unitId,
  nodeIds: ["small-addition", "small-multiplication"],
  questionPool: [
    choice("add-pre", "small-addition", "recall", "What is $1 + 1$?", ["1", "2", "3"], 1, "$1 + 1 = 2$."),
    choice("add-pause", "small-addition", "application", "You have 2 stones and find 3 more. How many stones do you have?", ["5", "4", "6"], 0, "$2 + 3 = 5$."),
    choice("multiply-pause", "small-multiplication", "recall", "What is $3 \\times 2$?", ["5", "8", "6"], 2, "Three groups of two contain $6$ items."),
    choice("add-recap-one", "small-addition", "application", "What is $4 + 3$?", ["6", "7", "8"], 1, "$4 + 3 = 7$."),
    choice("multiply-recap-one", "small-multiplication", "application", "Two bags hold 4 apples each. How many apples are there?", ["6", "10", "8"], 2, "$2 \\times 4 = 8$."),
    choice("add-recap-two", "small-addition", "recall", "What is $5 + 2$?", ["7", "6", "9"], 0, "$5 + 2 = 7$."),
    choice("multiply-recap-two", "small-multiplication", "recall", "What is $2 \\times 5$?", ["7", "10", "12"], 1, "$2 \\times 5 = 10$."),
    choice("multiply-recap-three", "small-multiplication", "application", "There are 3 rows of 3 dots. How many dots are there?", ["6", "12", "9"], 2, "$3 \\times 3 = 9$."),
    {
      id: "explain-groups",
      nodeId: "small-multiplication",
      tier: "application",
      kind: "explain-back",
      prompt: "Explain why $3 \\times 2 = 6$ in your own words.",
      rubric: "The answer describes three groups of two or two groups of three totaling six.",
    },
  ],
  placements: [
    { kind: "pre-question", questionId: "add-pre", location: at(1) },
    { kind: "pause", location: at(6), nodeIds: ["small-addition"], questionIds: ["add-pause"] },
    { kind: "pause", location: at(12), nodeIds: ["small-multiplication"], questionIds: ["multiply-pause"] },
    {
      kind: "recap",
      questionIds: ["add-recap-one", "multiply-recap-one", "add-recap-two", "multiply-recap-two", "multiply-recap-three"],
      explainBackQuestionId: "explain-groups",
    },
  ],
}

async function put(name: string, body: unknown): Promise<void> {
  const target = `${server}/tools/${name}`
  console.log(JSON.stringify({ level: "info", stage: "seed_demo", target, status: "start" }))
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}: ${text}`)
    console.log(JSON.stringify({ level: "info", stage: "seed_demo", target, status: "ok" }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ level: "error", stage: "seed_demo", target, status: "failed", error: message }))
    throw error
  }
}

await put("put_roadmap", { roadmap })
await put("put_nodes", { courseId, nodes })
await put("put_quiz_plan", { courseId, unitId, plan })
console.log(`Demo ready: ${videoUrl}`)
