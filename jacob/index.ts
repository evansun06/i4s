import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { CredentialManager } from "./auth/credentials";
import { AGENTS, type AgentId } from "./agents/agents";

const COLORS: Record<AgentId, string> = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
};

const RESET = "\x1b[0m";

async function main() {
  const MODEL = "gemini-3.8-flash";

  const credentials = new CredentialManager();
  //await credentials.removeApiKey();
  const apiKey = await credentials.getApiKey();

  const client = new GoogleGenAI({ apiKey });
  const terminal = createInterface({
    input: stdin,
    output: stdout,
  });

  // Each agent remembers its own conversation during this session.
  const histories: Record<
    AgentId,
    Array<{ role: "user" | "assistant"; content: string }>
  > = {
    red: [],
    yellow: [],
    green: [],
    blue: [],
  };

  console.log("\nWelcome to The Idiots!");
  console.log("Talk to all four agents at once.");
  console.log('Type "exit" to quit.\n');

  try {
    while (true) {
      const input = (await terminal.question("You: ")).trim();

      if (!input) {
        continue;
      }

      if (input.toLowerCase() === "exit") {
        break;
      }

      console.log("\nThinking...\n");

      // Ask all four agents the same question.
      await Promise.all(
        (Object.keys(AGENTS) as AgentId[]).map(async (id) => {
            const agent = AGENTS[id];

            try {
            const completion = await client.models.generateContent({
                model: MODEL,
                contents: [
                ...histories[id].map((message) => ({
                    role: message.role === "assistant" ? "model" : "user",
                    parts: [{ text: message.content }],
                })),
                {
                    role: "user",
                    parts: [{ text: input }],
                },
                ],
                config: {
                systemInstruction: agent.systemPrompt,
                maxOutputTokens: 350,
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                },
                },
            });

            const reply =
                completion.text?.trim() ||
                "I have nothing to add right now.";

            // Update this agent's conversation history.
            histories[id].push(
                { role: "user", content: input },
                { role: "assistant", content: reply }
            );

            // Print immediately when this agent finishes.
            console.log(
                `\n${COLORS[id]}${agent.name}:${RESET} ${reply}\n`
            );
            } catch (error) {
            console.error(
                `\n${COLORS[id]}${agent.name}:${RESET} API request failed:`,
                error instanceof Error ? error.message : error
            );
            }
        })
        );      
    }
  } finally {
    terminal.close();
  }

  console.log("Goodbye!");
}

main().catch(() => {
  console.error(
    "The Idiots couldn't start. Check your credentials and configuration."
  );
  process.exitCode = 1;
});