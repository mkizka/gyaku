import { describe, expect, it } from "vitest";

import { createContainer } from "../src/index.ts";

describe("createContainer", () => {
  it("builds services eagerly and passes only declared dependencies", async () => {
    const calls: string[] = [];

    const container = createContainer()
      .service("logger", () => {
        calls.push("logger");
        return {
          log: (message: string) => message,
        };
      })
      .service("db", () => {
        calls.push("db");
        return Promise.resolve({
          query: (sql: string) => [sql],
        });
      })
      .service("repo", ["db", "logger"], ({ db, logger }) => {
        calls.push("repo");
        return {
          find: () => logger.log(db.query("select 1")[0] ?? ""),
        };
      });

    await using services = await container.build();

    expect(calls).toEqual(["logger", "db", "repo"]);
    expect(services.repo.find()).toBe("select 1");
  });

  it("creates new instances for each build", async () => {
    let nextId = 0;

    const container = createContainer().service("service", () => ({
      id: nextId++,
    }));

    await using first = await container.build();
    await using second = await container.build();

    expect(first.service).not.toBe(second.service);
    expect(first.service.id).toBe(0);
    expect(second.service.id).toBe(1);
  });

  it("disposes services in reverse creation order", async () => {
    const disposed: string[] = [];

    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          disposed.push("first");
        },
      }))
      .service("second", ["first"], () => ({
        [Symbol.asyncDispose]: () =>
          Promise.resolve().then(() => {
            disposed.push("second");
          }),
      }));

    {
      await using _services = await container.build();
    }

    expect(disposed).toEqual(["second", "first"]);
  });

  it("calls dispose methods with the service as this", async () => {
    const container = createContainer().service("service", () => ({
      disposed: false,
      [Symbol.dispose]() {
        this.disposed = true;
      },
    }));

    const services = await container.build();

    await services[Symbol.asyncDispose]();

    expect(services.service.disposed).toBe(true);
  });

  it("disposes function services", async () => {
    let disposed = false;

    const container = createContainer().service("service", () => {
      return Object.assign(() => "value", {
        [Symbol.dispose]: () => {
          disposed = true;
        },
      });
    });

    const services = await container.build();

    expect(services.service()).toBe("value");
    expect(disposed).toBe(false);

    await services[Symbol.asyncDispose]();

    expect(disposed).toBe(true);
  });

  it("ignores repeated dispose calls", async () => {
    let disposeCount = 0;

    const container = createContainer().service("service", () => ({
      [Symbol.dispose]: () => {
        disposeCount++;
      },
    }));

    const services = await container.build();

    await services[Symbol.asyncDispose]();
    await services[Symbol.asyncDispose]();

    expect(disposeCount).toBe(1);
  });

  it("keeps disposing after dispose errors and throws an AggregateError", async () => {
    const disposed: string[] = [];

    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          disposed.push("first");
          throw new Error("first dispose failed");
        },
      }))
      .service("second", () => ({
        [Symbol.dispose]: () => {
          disposed.push("second");
          throw new Error("second dispose failed");
        },
      }));

    const services = await container.build();

    await expect(services[Symbol.asyncDispose]()).rejects.toThrow(
      AggregateError,
    );
    expect(disposed).toEqual(["second", "first"]);
  });

  it("cleans up created services when a later factory fails", async () => {
    const disposed: string[] = [];

    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          disposed.push("first");
        },
      }))
      .service("second", () => {
        throw new Error("build failed");
      });

    await expect(container.build()).rejects.toThrow(
      'Service "second" factory failed',
    );
    expect(disposed).toEqual(["first"]);
  });

  it("skips dependents when their dependency fails", async () => {
    const events: string[] = [];

    const container = createContainer()
      .service("dep", () => {
        events.push("dep");
        throw new Error("dep failed");
      })
      .service("dependent", ["dep"], () => {
        events.push("dependent");
        return {
          [Symbol.dispose]: () => {
            events.push("dependent-dispose");
          },
        };
      });

    await expect(container.build()).rejects.toThrow(
      'Service "dep" factory failed',
    );
    expect(events).toEqual(["dep"]);
  });

  it("aggregates build and cleanup errors", async () => {
    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          throw new Error("cleanup failed");
        },
      }))
      .service("second", () => {
        throw new Error("build failed");
      });

    await expect(container.build()).rejects.toThrow(
      "Failed to build services and cleanup created services",
    );
  });

  it("attaches the first factory error as the aggregate cause", async () => {
    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          throw new Error("cleanup failed");
        },
      }))
      .service("second", () => {
        throw new Error("build failed");
      });

    await expect(container.build()).rejects.toMatchObject({
      cause: {
        message: 'Service "second" factory failed',
        cause: { message: "build failed" },
      },
    });
  });

  it("rejects invalid service definitions at runtime", () => {
    expect(() => {
      createContainer()
        // @ts-expect-error "then" is reserved at the type level too.
        .service("then", () => undefined);
    }).toThrow('Service key "then" is reserved');

    expect(() => {
      createContainer()
        .service("logger", () => undefined)
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .service("logger", () => undefined);
    }).toThrow('Service "logger" is already registered');

    expect(() => {
      // @ts-expect-error "db" is not registered at the type level either.
      createContainer().service("repo", ["db"], () => undefined);
    }).toThrow('Service "repo" depends on unregistered service "db"');

    expect(() => {
      createContainer()
        .service("db", () => undefined)
        // @ts-expect-error missing factory is rejected at the type level too.
        .service("repo", ["db"]);
    }).toThrow('Service "repo" factory is required');
  });

  it("treats __proto__ as a regular key without polluting the prototype", async () => {
    const polluted = { polluted: true };

    await using services = await createContainer()
      .value("__proto__", polluted)
      .build();

    expect(services["__proto__"]).toBe(polluted);
    expect("polluted" in {}).toBe(false);
  });

  it("does not attempt to dispose primitive or null services", async () => {
    const container = createContainer()
      .service("num", () => 42)
      .service("str", () => "hello")
      .service("nil", () => null);

    const services = await container.build();

    expect(services.num).toBe(42);
    expect(services.str).toBe("hello");
    expect(services.nil).toBe(null);

    await expect(services[Symbol.asyncDispose]()).resolves.toBeUndefined();
  });

  it("registers an existing value with .value", async () => {
    const config = { port: 3000 };

    const container = createContainer()
      .value("config", config)
      .service("server", ["config"], ({ config }) => ({
        port: config.port,
      }));

    await using services = await container.build();

    expect(services.config).toBe(config);
    expect(services.server.port).toBe(3000);
  });

  it("applies the same key validation to .value as .service", () => {
    expect(() => {
      createContainer()
        // @ts-expect-error "then" is reserved at the type level too.
        .value("then", 1);
    }).toThrow('Service key "then" is reserved');

    expect(() => {
      createContainer()
        .value("config", { port: 3000 })
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .value("config", { port: 4000 });
    }).toThrow('Service "config" is already registered');

    expect(() => {
      createContainer()
        .service("logger", () => undefined)
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .value("logger", { log: () => undefined });
    }).toThrow('Service "logger" is already registered');
  });

  it("replaces a registered factory with .override", async () => {
    const container = createContainer()
      .service("logger", () => ({
        log: (message: string) => `prod:${message}`,
      }))
      .service("db", ["logger"], ({ logger }) => ({
        query: (sql: string) => logger.log(sql),
      }));

    const testContainer = container.override("db", () => ({
      query: (sql: string) => `stub:${sql}`,
    }));

    await using services = await testContainer.build();

    expect(services.db.query("select 1")).toBe("stub:select 1");
  });

  it("preserves creation order when overriding", async () => {
    const calls: string[] = [];

    const container = createContainer()
      .service("first", () => {
        calls.push("first");
        return { tag: "first" as const };
      })
      .service("second", ["first"], ({ first }) => {
        calls.push("second");
        return { tag: "second" as const, first };
      });

    const overridden = container.override("first", () => {
      calls.push("first-override");
      return { tag: "first" as const };
    });

    await using services = await overridden.build();

    expect(calls).toEqual(["first-override", "second"]);
    expect(services.second.first.tag).toBe("first");
  });

  it("inherits the original service's dependencies in .override", async () => {
    const container = createContainer()
      .service("logger", () => ({
        log: (message: string) => `log:${message}`,
      }))
      .service("db", ["logger"], ({ logger }) => ({
        query: (sql: string) => logger.log(`real:${sql}`),
      }));

    const overridden = container.override("db", ({ logger }) => ({
      query: (sql: string) => logger.log(`override:${sql}`),
    }));

    await using services = await overridden.build();

    expect(services.db.query("select 1")).toBe("log:override:select 1");
  });

  it("applies the latest override when called multiple times", async () => {
    const container = createContainer().service("greeting", () => "original");

    const overridden = container
      .override("greeting", () => "first")
      .override("greeting", () => "second");

    await using services = await overridden.build();

    expect(services.greeting).toBe("second");
  });

  it("rejects overriding an unregistered key at runtime", () => {
    const container = createContainer().service("logger", () => ({
      log: (message: string) => message,
    }));

    expect(() => {
      // @ts-expect-error overriding an unregistered key is rejected at the type level too.
      container.override("missing", () => undefined);
    }).toThrow('Service "missing" is not registered');
  });

  it("runs independent factories in parallel", async () => {
    const events: string[] = [];
    let resolveSlow!: () => void;
    const slowReady = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });

    const container = createContainer()
      .service("slow", async () => {
        events.push("slow-start");
        await slowReady;
        events.push("slow-end");
        return { tag: "slow" as const };
      })
      .service("fast", () => {
        events.push("fast");
        return { tag: "fast" as const };
      });

    const buildPromise = container.build();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(["slow-start", "fast"]);

    resolveSlow();
    await using services = await buildPromise;

    expect(events).toEqual(["slow-start", "fast", "slow-end"]);
    expect(services.slow.tag).toBe("slow");
    expect(services.fast.tag).toBe("fast");
  });

  it("disposes in reverse completion order, not registration order", async () => {
    const disposed: string[] = [];
    let resolveSlow!: () => void;
    const slowReady = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });

    const container = createContainer()
      .service("slow", async () => {
        await slowReady;
        return {
          [Symbol.dispose]: () => {
            disposed.push("slow");
          },
        };
      })
      .service("fast", () => ({
        [Symbol.dispose]: () => {
          disposed.push("fast");
        },
      }));

    const buildPromise = container.build();
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolveSlow();
    const services = await buildPromise;

    await services[Symbol.asyncDispose]();

    expect(disposed).toEqual(["slow", "fast"]);
  });

  it("disposes independent services in parallel", async () => {
    const events: string[] = [];
    let resolveSlowBuild!: () => void;
    const slowBuilt = new Promise<void>((resolve) => {
      resolveSlowBuild = resolve;
    });
    let resolveSlowDispose!: () => void;
    const slowDisposed = new Promise<void>((resolve) => {
      resolveSlowDispose = resolve;
    });

    const container = createContainer()
      .service("fast", () => ({
        [Symbol.dispose]: () => {
          events.push("fast-dispose");
        },
      }))
      .service("slow", async () => {
        await slowBuilt;
        return {
          [Symbol.asyncDispose]: async () => {
            events.push("slow-dispose-start");
            await slowDisposed;
            events.push("slow-dispose-end");
          },
        };
      });

    const buildPromise = container.build();
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolveSlowBuild();
    const services = await buildPromise;

    const disposePromise = services[Symbol.asyncDispose]();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(["slow-dispose-start", "fast-dispose"]);

    resolveSlowDispose();
    await disposePromise;

    expect(events).toEqual([
      "slow-dispose-start",
      "fast-dispose",
      "slow-dispose-end",
    ]);
  });

  it("waits for all dependents in parallel before disposing a shared dep", async () => {
    const events: string[] = [];
    let resolveRepoA!: () => void;
    const repoAReleased = new Promise<void>((resolve) => {
      resolveRepoA = resolve;
    });

    const container = createContainer()
      .service("db", () => ({
        [Symbol.dispose]: () => {
          events.push("db");
        },
      }))
      .service("repoA", ["db"], () => ({
        [Symbol.asyncDispose]: async () => {
          events.push("repoA-start");
          await repoAReleased;
          events.push("repoA-end");
        },
      }))
      .service("repoB", ["db"], () => ({
        [Symbol.dispose]: () => {
          events.push("repoB");
        },
      }));

    const services = await container.build();
    const disposePromise = services[Symbol.asyncDispose]();

    await new Promise<void>((resolve) => setImmediate(resolve));
    // repoB disposed synchronously; repoA is mid-async; db is blocked on both.
    expect(events).toEqual(["repoB", "repoA-start"]);

    resolveRepoA();
    await disposePromise;
    expect(events).toEqual(["repoB", "repoA-start", "repoA-end", "db"]);
  });

  it("waits for direct dependents before disposing a service", async () => {
    const events: string[] = [];
    let releaseChild!: () => void;
    const childDone = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });

    const container = createContainer()
      .service("parent", () => ({
        [Symbol.dispose]: () => {
          events.push("parent");
        },
      }))
      .service("child", ["parent"], () => ({
        [Symbol.asyncDispose]: async () => {
          events.push("child-start");
          await childDone;
          events.push("child-end");
        },
      }));

    const services = await container.build();
    const disposePromise = services[Symbol.asyncDispose]();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["child-start"]);

    releaseChild();
    await disposePromise;
    expect(events).toEqual(["child-start", "child-end", "parent"]);
  });

  it("reports dispose failures with the documented message", async () => {
    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          throw new Error("first dispose failed");
        },
      }))
      .service("second", () => ({
        [Symbol.dispose]: () => {
          throw new Error("second dispose failed");
        },
      }));

    const services = await container.build();

    await expect(services[Symbol.asyncDispose]()).rejects.toThrow(
      "Failed to dispose services",
    );
  });

  it("wraps factory errors with the service name and preserves the cause", async () => {
    const original = new Error("connect ECONNREFUSED");

    const container = createContainer().service("db", () => {
      throw original;
    });

    await expect(container.build()).rejects.toMatchObject({
      message: 'Service "db" factory failed',
      cause: original,
    });
  });

  it("wraps dispose errors with the service name and preserves the cause", async () => {
    const original = new Error("close timed out");

    const container = createContainer().service("db", () => ({
      [Symbol.dispose]: () => {
        throw original;
      },
    }));

    const services = await container.build();

    await expect(services[Symbol.asyncDispose]()).rejects.toMatchObject({
      message: 'Service "db" dispose failed',
      cause: original,
    });
  });

  it("includes wrapped dispose errors in the aggregate", async () => {
    const container = createContainer()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          throw new Error("first dispose failed");
        },
      }))
      .service("second", () => ({
        [Symbol.dispose]: () => {
          throw new Error("second dispose failed");
        },
      }));

    const services = await container.build();

    await expect(services[Symbol.asyncDispose]()).rejects.toMatchObject({
      errors: [
        {
          message: 'Service "second" dispose failed',
          cause: { message: "second dispose failed" },
        },
        {
          message: 'Service "first" dispose failed',
          cause: { message: "first dispose failed" },
        },
      ],
    });
  });
});
