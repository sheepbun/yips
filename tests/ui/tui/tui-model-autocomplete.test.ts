import { describe, expect, it } from "vitest";

import { createDefaultRegistry } from "#agent/commands/commands";
import { PromptComposer } from "#ui/prompt/prompt-composer";
import { buildAutocompleteOverlayLines, buildModelAutocompleteCandidates } from "#ui/tui/start-tui";
import { stripMarkup } from "#ui/title-box";

function typeText(composer: PromptComposer, text: string): void {
  for (const char of Array.from(text)) {
    composer.handleKey(char, { isCharacter: true });
  }
}

describe("buildModelAutocompleteCandidates", () => {
  it("builds aliases for repo, parent path, filename, and filename stem", () => {
    const candidates = buildModelAutocompleteCandidates(["org/repo/path/model-q4.gguf"]);
    expect(candidates).toEqual([
      {
        value: "org/repo/path/model-q4.gguf",
        aliases: ["org/repo/path", "org/repo", "model-q4.gguf", "model-q4"]
      }
    ]);
  });
});

describe("buildAutocompleteOverlayLines", () => {
  it("shows local model label for model-argument suggestions", () => {
    const registry = createDefaultRegistry();
    const composer = new PromptComposer({
      interiorWidth: 60,
      history: [],
      commandAutoComplete: registry.getAutocompleteCommands(),
      modelAutoComplete: [
        {
          value: "org/repo/model-q4.gguf",
          aliases: ["org/repo", "model-q4.gguf", "model-q4"]
        }
      ]
    });

    typeText(composer, "/model ");
    const plain = buildAutocompleteOverlayLines(composer, registry).map(stripMarkup);
    expect(plain.some((line) => line.includes("org/repo/model-q4.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("Local model"))).toBe(true);
  });
});
