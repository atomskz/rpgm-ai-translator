import { describe, expect, it } from "vitest";
import { DeepSeekProvider } from "../src/providers/deepseek/index.js";
import type { TranslationUnit } from "../src/core/types.js";

type FetchInit = {
  body: string;
  headers: Record<string, string>;
};

describe("DeepSeekProvider", () => {
  it("sends OpenAI-compatible JSON chat completions requests and parses JSON responses", async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return response(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ id: "Actors.1.name", translation: "Ария" }]
                })
              }
            }
          ],
          usage: { total_tokens: 42 }
        });
      }
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: 0.3,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      stream: false
    });
    expect(results).toEqual([
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "translated",
        metadata: { usage: { total_tokens: 42 } }
      }
    ]);
  });

  it("retries temporary API failures", async () => {
    let calls = 0;
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      retryDelayMs: 0,
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) {
          return response(500, { error: "temporary" }, false, "Internal Server Error");
        }
        return response(200, {
          choices: [{ message: { content: JSON.stringify({ translations: [{ id: "Actors.1.name", translation: "Ария" }] }) } }]
        });
      }
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(calls).toBe(2);
    expect(results[0].status).toBe("translated");
  });

  it("maps HTTP auth failures to provider issue codes and messages", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "bad-key",
      fetchFn: async () =>
        response(
          401,
          {
            error: {
              message: "Authentication failed",
              type: "invalid_request_error",
              code: "invalid_api_key"
            }
          },
          false,
          "Unauthorized"
        )
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(results[0].status).toBe("failed");
    expect(results[0].issues?.[0]).toMatchObject({
      code: "PROVIDER_AUTH_ERROR",
      message: "DeepSeek API error 401: Authentication failed invalid_request_error invalid_api_key"
    });
  });

  it("maps final rate limit failures to provider issue codes after retries", async () => {
    let calls = 0;
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      retryDelayMs: 0,
      maxRetries: 1,
      fetchFn: async () => {
        calls += 1;
        return response(429, { message: "Rate limit reached" }, false, "Too Many Requests");
      }
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(calls).toBe(2);
    expect(results[0].issues?.[0]).toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      message: "DeepSeek API error 429: Rate limit reached"
    });
  });

  it("returns per-unit failures when the API key is missing", async () => {
    const provider = new DeepSeekProvider({ apiKey: "" });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(results[0]).toMatchObject({
      id: "Actors.1.name",
      translation: "",
      provider: "deepseek",
      status: "failed"
    });
    expect(results[0].issues?.[0].code).toBe("PROVIDER_AUTH_ERROR");
    expect(results[0].issues?.[0].message).toContain("DEEPSEEK_API_KEY");
  });

  it("returns per-unit failures for invalid model JSON", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchFn: async () =>
        response(200, {
          choices: [{ message: { content: "not json" } }]
        })
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(results[0].status).toBe("failed");
    expect(results[0].issues?.[0].code).toBe("PROVIDER_RESPONSE_ERROR");
    expect(results[0].issues?.[0].message).toContain("invalid JSON content");
  });

  it("maps unexpected API response shapes to schema provider issues", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchFn: async () => response(200, { nope: true })
    });

    const results = await provider.translateBatch([unit()], { targetLanguage: "ru" });

    expect(results[0].status).toBe("failed");
    expect(results[0].issues?.[0]).toMatchObject({
      code: "PROVIDER_RESPONSE_SCHEMA_ERROR",
      message: "DeepSeek API returned an unexpected response shape"
    });
  });

  it("sends review prompts and parses revised translations", async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return response(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ id: "Map001.events.1.pages.0.list.1.parameters.0", translation: "Я готова." }]
                })
              }
            }
          ]
        });
      }
    });

    const results = await provider.reviewBatch(
      [
        {
          id: "Map001.events.1.pages.0.list.1.parameters.0",
          source: "I am ready.",
          currentTranslation: "Я готов.",
          category: "dialogue",
          context: { speaker: "Aria" }
        }
      ],
      {
        targetLanguage: "ru",
        characterGlossary: { Aria: { gender: "female" } },
        temperature: 0.7,
        maxTokens: 2048
      }
    );

    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content).toContain("Review and revise");
    expect(body.messages[1].content).toContain("currentTranslation");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
    expect(results[0]).toMatchObject({
      translation: "Я готова.",
      metadata: { reviewed: true }
    });
  });

  it("sends character inference prompts and parses character glossary", async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return response(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  characters: {
                    Aria: {
                      translation: "Ария",
                      gender: "female",
                      type: "person",
                      confidence: 0.9,
                      review: false
                    }
                  }
                })
              }
            }
          ]
        });
      }
    });

    const result = await provider.inferCharacters(
      [
        {
          name: "Aria",
          suggestedTranslation: "Ария",
          sources: ["actor"],
          occurrences: 1,
          evidence: []
        }
      ],
      { targetLanguage: "ru" }
    );

    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content).toContain("character glossary");
    expect(body.messages[1].content).toContain("candidates");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(result).toEqual({
      Aria: {
        translation: "Ария",
        gender: "female",
        type: "person",
        confidence: 0.9,
        review: false
      }
    });
  });
});

function unit(): TranslationUnit {
  return {
    id: "Actors.1.name",
    source: "Aria",
    normalizedSource: "Aria",
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: "hash"
  };
}

function response(status: number, body: unknown, ok = status >= 200 && status < 300, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: async () => body
  };
}
