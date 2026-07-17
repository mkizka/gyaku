import { describe, expect, it } from "vitest";

import { asFunctionArgs, createRegistry } from "../src/index.ts";

describe("asFunctionArgs", () => {
  it("spreads resolved dependencies into positional factory args in deps order", async () => {
    const createPair = (first: string, second: string) => ({ first, second });

    await using services = await createRegistry()
      .value("a", "value-a")
      .value("b", "value-b")
      // deps order ["b", "a"] maps to createPair(first = b, second = a).
      .service("pair", ["b", "a"], asFunctionArgs(createPair))
      .resolve();

    expect(services.pair.first).toBe("value-b");
    expect(services.pair.second).toBe("value-a");
  });

  it("builds a dependency-free factory registered without a deps array", async () => {
    const createCounter = () => ({ count: 0 });

    await using services = await createRegistry()
      .service("counter", asFunctionArgs(createCounter))
      .resolve();

    expect(services.counter).toEqual({ count: 0 });
  });

  it("replaces a service with a positional stub via .replaceService", async () => {
    const createDb = (prefix: string) => ({
      query: (sql: string) => `${prefix}:${sql}`,
    });

    await using services = await createRegistry()
      .value("prefix", "stub")
      .service("db", () => ({ query: (sql: string) => `real:${sql}` }))
      .replaceService("db", ["prefix"], asFunctionArgs(createDb))
      .resolve();

    expect(services.db.query("select 1")).toBe("stub:select 1");
  });
});
