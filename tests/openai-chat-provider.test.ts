import { describe, expect, it } from "vitest";
import { OpenAiChatProvider } from "../src/providers/openai-chat/public-api.js";
import type { ChatCompletionClient, ChatCompletionResponse } from "../src/providers/openai-chat/public-api.js";
import type { CharacterCandidate, ReviewUnit, TranslationUnit } from "../src/core/types/public-api.js";

// A stand-in for "add a new OpenAI-compatible provider": the whole adapter is a
// tiny subclass plus a client. The degradation skeleton (empty batch, missing
// key, thrown error -> failed results) is inherited from the base, so these tests
// exercise that shared contract rather than any one dialect.
class FakeProvider extends OpenAiChatProvider {
  readonly name = "fake";
  protected readonly client: ChatCompletionClient;
  protected readonly defaultModel = "fake-model";
  protected readonly apiKeyName = "FAKE_API_KEY";

  constructor(client: ChatCompletionClient) {
    super();
    this.client = client;
  }
}

function okClient(response: ChatCompletionResponse, calls?: { count: number }): ChatCompletionClient {
  return {
    hasApiKey: true,
    host: "Fake",
    requestChatCompletion: async () => {
      if (calls) {
        calls.count += 1;
      }
      return response;
    }
  };
}

function translationsResponse(items: Array<{ id: string; translation: string }>): ChatCompletionResponse {
  return { choices: [{ message: { content: JSON.stringify({ translations: items }) } }], usage: { total_tokens: 7 } };
}

const UNIT: TranslationUnit = {
  id: "Actors.1.name",
  source: "Aria",
  normalizedSource: "Aria",
  filePath: "data/Actors.json",
  jsonPath: "1.name",
  engine: "rpgmaker-mv",
  category: "name",
  hash: "hash"
};

const REVIEW_UNIT: ReviewUnit = {
  id: "Actors.1.name",
  source: "Aria",
  currentTranslation: "Ариа",
  category: "name"
};

const CANDIDATE: CharacterCandidate = {
  name: "Aria",
  sources: ["actor"],
  occurrences: 1,
  evidence: []
};

describe("OpenAiChatProvider degradation contract", () => {
  it("skips an empty batch without calling the client", async () => {
    const calls = { count: 0 };
    const provider = new FakeProvider(okClient(translationsResponse([]), calls));

    expect(await provider.translateBatch([], { targetLanguage: "ru" })).toEqual([]);
    expect(await provider.inferCharacters([], { targetLanguage: "ru" })).toEqual({});
    expect(calls.count).toBe(0);
  });

  it("degrades to per-unit auth failures when the API key is missing", async () => {
    const provider = new FakeProvider({
      hasApiKey: false,
      host: "Fake",
      requestChatCompletion: async () => {
        throw new Error("should not be called");
      }
    });

    const results = await provider.translateBatch([UNIT], { targetLanguage: "ru" });
    expect(results[0]).toMatchObject({ status: "failed", translation: "" });
    expect(results[0].issues?.[0].code).toBe("PROVIDER_AUTH_ERROR");
    expect(results[0].issues?.[0].message).toContain("FAKE_API_KEY");
  });

  it("returns a degraded character glossary when the API key is missing", async () => {
    const provider = new FakeProvider({
      hasApiKey: false,
      host: "Fake",
      requestChatCompletion: async () => {
        throw new Error("should not be called");
      }
    });

    const glossary = await provider.inferCharacters([CANDIDATE], { targetLanguage: "ru" });
    expect(glossary.Aria).toMatchObject({ review: true, confidence: 0 });
    expect(glossary.Aria.description).toContain("FAKE_API_KEY");
  });

  it("turns a thrown request error into failed results instead of throwing", async () => {
    const provider = new FakeProvider({
      hasApiKey: true,
      host: "Fake",
      requestChatCompletion: async () => {
        throw new Error("network is down");
      }
    });

    const results = await provider.translateBatch([UNIT], { targetLanguage: "ru" });
    expect(results[0].status).toBe("failed");
    expect(results[0].issues?.[0].message).toContain("network is down");

    const reviewed = await provider.reviewBatch([REVIEW_UNIT], { targetLanguage: "ru" });
    expect(reviewed[0]).toMatchObject({ status: "failed", translation: "Ариа" });

    const glossary = await provider.inferCharacters([CANDIDATE], { targetLanguage: "ru" });
    expect(glossary.Aria.description).toContain("Character inference failed");
  });

  it("maps a valid response and stamps batch usage exactly once", async () => {
    const provider = new FakeProvider(
      okClient(
        translationsResponse([
          { id: "Actors.1.name", translation: "Ария" },
          { id: "Actors.2.name", translation: "Луна" }
        ])
      )
    );

    const second: TranslationUnit = { ...UNIT, id: "Actors.2.name", source: "Luna", jsonPath: "2.name" };
    const results = await provider.translateBatch([UNIT, second], { targetLanguage: "ru" });

    expect(results.map((result) => result.translation)).toEqual(["Ария", "Луна"]);
    expect(results.filter((result) => result.metadata?.tokenUsage != null)).toHaveLength(1);
  });

  it("labels a malformed response with the provider host, not a hardcoded dialect", async () => {
    const provider = new FakeProvider(okClient({ choices: [{ message: { content: "" } }] }));

    const results = await provider.translateBatch([UNIT], { targetLanguage: "ru" });
    expect(results[0].status).toBe("failed");
    expect(results[0].issues?.[0].message).toContain("Fake API response did not include message content");
  });
});
