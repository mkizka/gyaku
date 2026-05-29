import { describe, expect, it } from "vitest";

import {
  createRegistry,
  DisposeError,
  GyakuError,
  RegistryError,
  ResolveError,
  ServiceDisposeError,
  ServiceFactoryError,
} from "../src/index.ts";

const capture = (fn: () => unknown): unknown => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
};

const captureAsync = async (
  fn: () => PromiseLike<unknown>,
): Promise<unknown> => {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
};

function assertInstance<T>(
  value: unknown,
  cls: new (...args: never[]) => T,
): asserts value is T {
  expect(value).toBeInstanceOf(cls);
}

describe("createRegistry", () => {
  it("resolves services eagerly and passes only declared dependencies", async () => {
    const calls: string[] = [];

    const registry = createRegistry()
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

    await using services = await registry.resolve();

    expect(calls).toEqual(["logger", "db", "repo"]);
    expect(services.repo.find()).toBe("select 1");
  });

  it("creates new instances for each resolve", async () => {
    let nextId = 0;

    const registry = createRegistry().service("service", () => ({
      id: nextId++,
    }));

    await using first = await registry.resolve();
    await using second = await registry.resolve();

    expect(first.service).not.toBe(second.service);
    expect(first.service.id).toBe(0);
    expect(second.service.id).toBe(1);
  });

  it("disposes services in reverse creation order", async () => {
    const disposed: string[] = [];

    const registry = createRegistry()
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
      await using _services = await registry.resolve();
    }

    expect(disposed).toEqual(["second", "first"]);
  });

  it("calls dispose methods with the service as this", async () => {
    const registry = createRegistry().service("service", () => ({
      disposed: false,
      [Symbol.dispose]() {
        this.disposed = true;
      },
    }));

    const services = await registry.resolve();

    await services[Symbol.asyncDispose]();

    expect(services.service.disposed).toBe(true);
  });

  it("disposes function services", async () => {
    let disposed = false;

    const registry = createRegistry().service("service", () => {
      return Object.assign(() => "value", {
        [Symbol.dispose]: () => {
          disposed = true;
        },
      });
    });

    const services = await registry.resolve();

    expect(services.service()).toBe("value");
    expect(disposed).toBe(false);

    await services[Symbol.asyncDispose]();

    expect(disposed).toBe(true);
  });

  it("ignores repeated dispose calls", async () => {
    let disposeCount = 0;

    const registry = createRegistry().service("service", () => ({
      [Symbol.dispose]: () => {
        disposeCount++;
      },
    }));

    const services = await registry.resolve();

    await services[Symbol.asyncDispose]();
    await services[Symbol.asyncDispose]();

    expect(disposeCount).toBe(1);
  });

  it("keeps disposing after dispose errors and throws a DisposeError", async () => {
    const disposed: string[] = [];

    const registry = createRegistry()
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

    const services = await registry.resolve();
    const error = await captureAsync(() => services[Symbol.asyncDispose]());

    assertInstance(error, DisposeError);
    expect(error).toBeInstanceOf(GyakuError);
    expect(error).toMatchObject({
      name: "DisposeError",
      message: "Failed to dispose services: second, first",
      errors: [
        {
          name: "ServiceDisposeError",
          message: 'Service "second" dispose failed',
          key: "second",
          cause: { message: "second dispose failed" },
        },
        {
          name: "ServiceDisposeError",
          message: 'Service "first" dispose failed',
          key: "first",
          cause: { message: "first dispose failed" },
        },
      ],
    });
    expect(error.cause).toBe(error.errors[0]);
    expect(disposed).toEqual(["second", "first"]);
  });

  it("cleans up created services when a later factory fails", async () => {
    const disposed: string[] = [];

    const registry = createRegistry()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          disposed.push("first");
        },
      }))
      .service("second", () => {
        throw new Error("factory failed");
      });

    await expect(registry.resolve()).rejects.toBeInstanceOf(ResolveError);
    expect(disposed).toEqual(["first"]);
  });

  it("skips dependents when their dependency fails", async () => {
    const events: string[] = [];

    const registry = createRegistry()
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

    const error = await captureAsync(() => registry.resolve());
    assertInstance(error, ResolveError);
    expect(error).toMatchObject({
      errors: [{ key: "dep" }],
    });
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0]).toBeInstanceOf(ServiceFactoryError);
    expect(events).toEqual(["dep"]);
  });

  it("aggregates resolve and cleanup errors into a single ResolveError", async () => {
    const original = new Error("factory failed");
    const registry = createRegistry()
      .service("first", () => ({
        [Symbol.dispose]: () => {
          throw new Error("cleanup failed");
        },
      }))
      .service("second", () => {
        throw original;
      });

    const error = await captureAsync(() => registry.resolve());
    assertInstance(error, ResolveError);
    expect(error).toMatchObject({
      name: "ResolveError",
      message: "Failed to resolve services: second, first",
      cause: {
        key: "second",
        message: 'Service "second" factory failed',
        cause: original,
      },
      errors: [
        { key: "second", message: 'Service "second" factory failed' },
        { key: "first", message: 'Service "first" dispose failed' },
      ],
    });
    expect(error.cause).toBe(error.errors[0]);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBeInstanceOf(ServiceFactoryError);
    expect(error.errors[1]).toBeInstanceOf(ServiceDisposeError);
  });

  it(".service rejects the reserved key 'then'", () => {
    const error = capture(() =>
      createRegistry()
        // @ts-expect-error "then" is reserved at the type level too.
        .service("then", () => undefined),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      name: "RegistryError",
      message: 'Service key "then" is reserved',
    });
  });

  it(".service rejects duplicate keys", () => {
    const error = capture(() =>
      createRegistry()
        .service("logger", () => undefined)
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .service("logger", () => undefined),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "logger" is already registered',
    });
  });

  it(".service rejects unregistered dependencies", () => {
    const error = capture(() =>
      // @ts-expect-error "db" is not registered at the type level either.
      createRegistry().service("repo", ["db"], () => undefined),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "repo" depends on unregistered service "db"',
    });
  });

  it(".service rejects a missing factory", () => {
    const error = capture(() =>
      createRegistry()
        .service("db", () => undefined)
        // @ts-expect-error missing factory is rejected at the type level too.
        .service("repo", ["db"]),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "repo" factory is required',
    });
  });

  it("treats __proto__ as a regular key without polluting the prototype", async () => {
    const polluted = { polluted: true };

    await using services = await createRegistry()
      .value("__proto__", polluted)
      .resolve();

    expect(services["__proto__"]).toBe(polluted);
    expect("polluted" in {}).toBe(false);
  });

  it("does not attempt to dispose primitive or null services", async () => {
    const registry = createRegistry()
      .service("num", () => 42)
      .service("str", () => "hello")
      .service("nil", () => null);

    const services = await registry.resolve();

    expect(services.num).toBe(42);
    expect(services.str).toBe("hello");
    expect(services.nil).toBe(null);

    await expect(services[Symbol.asyncDispose]()).resolves.toBeUndefined();
  });

  it("registers an existing value with .value", async () => {
    const config = { port: 3000 };

    const registry = createRegistry()
      .value("config", config)
      .service("server", ["config"], ({ config }) => ({
        port: config.port,
      }));

    await using services = await registry.resolve();

    expect(services.config).toBe(config);
    expect(services.server.port).toBe(3000);
  });

  it(".value rejects the reserved key 'then'", () => {
    const error = capture(() =>
      createRegistry()
        // @ts-expect-error "then" is reserved at the type level too.
        .value("then", 1),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service key "then" is reserved',
    });
  });

  it(".value rejects duplicate keys", () => {
    const error = capture(() =>
      createRegistry()
        .value("config", { port: 3000 })
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .value("config", { port: 4000 }),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "config" is already registered',
    });
  });

  it(".value rejects keys already registered by .service", () => {
    const error = capture(() =>
      createRegistry()
        .service("logger", () => undefined)
        // @ts-expect-error duplicate keys are rejected at the type level too.
        .value("logger", { log: () => undefined }),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "logger" is already registered',
    });
  });

  it("replaces a registered factory with .override", async () => {
    const registry = createRegistry()
      .service("logger", () => ({
        log: (message: string) => `prod:${message}`,
      }))
      .service("db", ["logger"], ({ logger }) => ({
        query: (sql: string) => logger.log(sql),
      }));

    const testRegistry = registry.override("db", () => ({
      query: (sql: string) => `stub:${sql}`,
    }));

    await using services = await testRegistry.resolve();

    expect(services.db.query("select 1")).toBe("stub:select 1");
  });

  it("preserves creation order when overriding", async () => {
    const calls: string[] = [];

    const registry = createRegistry()
      .service("first", () => {
        calls.push("first");
        return { tag: "first" as const };
      })
      .service("second", ["first"], ({ first }) => {
        calls.push("second");
        return { tag: "second" as const, first };
      });

    const overridden = registry.override("first", () => {
      calls.push("first-override");
      return { tag: "first" as const };
    });

    await using services = await overridden.resolve();

    expect(calls).toEqual(["first-override", "second"]);
    expect(services.second.first.tag).toBe("first");
  });

  it("inherits the original service's dependencies in .override", async () => {
    const registry = createRegistry()
      .service("logger", () => ({
        log: (message: string) => `log:${message}`,
      }))
      .service("db", ["logger"], ({ logger }) => ({
        query: (sql: string) => logger.log(`real:${sql}`),
      }));

    const overridden = registry.override("db", ({ logger }) => ({
      query: (sql: string) => logger.log(`override:${sql}`),
    }));

    await using services = await overridden.resolve();

    expect(services.db.query("select 1")).toBe("log:override:select 1");
  });

  it("applies the latest override when called multiple times", async () => {
    const registry = createRegistry().service("greeting", () => "original");

    const overridden = registry
      .override("greeting", () => "first")
      .override("greeting", () => "second");

    await using services = await overridden.resolve();

    expect(services.greeting).toBe("second");
  });

  it("rejects overriding an unregistered key with RegistryError", () => {
    const registry = createRegistry().service("logger", () => ({
      log: (message: string) => message,
    }));

    const error = capture(() =>
      // @ts-expect-error overriding an unregistered key is rejected at the type level too.
      registry.override("missing", () => undefined),
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({
      message: 'Service "missing" is not registered',
    });
  });

  it("runs independent factories in parallel", async () => {
    const events: string[] = [];
    let resolveSlow!: () => void;
    const slowReady = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });

    const registry = createRegistry()
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

    const resolvePromise = registry.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(["slow-start", "fast"]);

    resolveSlow();
    await using services = await resolvePromise;

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

    const registry = createRegistry()
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

    const resolvePromise = registry.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolveSlow();
    const services = await resolvePromise;

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

    const registry = createRegistry()
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

    const resolvePromise = registry.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolveSlowBuild();
    const services = await resolvePromise;

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

    const registry = createRegistry()
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

    const services = await registry.resolve();
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

    const registry = createRegistry()
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

    const services = await registry.resolve();
    const disposePromise = services[Symbol.asyncDispose]();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["child-start"]);

    releaseChild();
    await disposePromise;
    expect(events).toEqual(["child-start", "child-end", "parent"]);
  });

  it("wraps factory failure in ServiceFactoryError", async () => {
    const original = new Error("connect ECONNREFUSED");

    const registry = createRegistry().service("db", () => {
      throw original;
    });

    const error = await captureAsync(() => registry.resolve());
    assertInstance(error, ResolveError);
    expect(error).toMatchObject({
      name: "ResolveError",
      message: "Failed to resolve services: db",
      errors: [
        {
          key: "db",
          message: 'Service "db" factory failed',
          cause: original,
        },
      ],
    });
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0]).toBeInstanceOf(ServiceFactoryError);
    expect(error.errors[0]).toBeInstanceOf(GyakuError);
  });

  it("wraps dispose failure in ServiceDisposeError", async () => {
    const original = new Error("close timed out");

    const registry = createRegistry().service("db", () => ({
      [Symbol.dispose]: () => {
        throw original;
      },
    }));

    const services = await registry.resolve();
    const error = await captureAsync(() => services[Symbol.asyncDispose]());

    assertInstance(error, DisposeError);
    expect(error).toMatchObject({
      message: "Failed to dispose services: db",
      errors: [
        {
          key: "db",
          message: 'Service "db" dispose failed',
          cause: original,
        },
      ],
    });
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0]).toBeInstanceOf(ServiceDisposeError);
    expect(error.errors[0]).toBeInstanceOf(GyakuError);
  });
});
