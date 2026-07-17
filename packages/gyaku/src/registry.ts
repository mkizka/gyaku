import type { NotPositionalFactory, PositionalFactory } from "./class.js";
import {
  DisposeError,
  RegistryError,
  ResolveError,
  ServiceDisposeError,
  ServiceFactoryError,
} from "./errors.js";

type ServiceMapBase = Record<string, unknown>;

type RegisteredKey<ServiceMap extends ServiceMapBase> = Extract<
  keyof ServiceMap,
  string
>;

type ReplaceValue<
  ServiceMap extends ServiceMapBase,
  Key extends keyof ServiceMap,
  Result,
> = {
  [K in keyof ServiceMap]: K extends Key ? Result : ServiceMap[K];
};

type ServiceFactory = (deps: ServiceMapBase) => unknown;

// `then` is reserved because the built services object would otherwise be
// treated as a thenable by `await`, leading to infinite unwrapping.
type UnregisteredKey<
  Key extends string,
  ServiceMap extends ServiceMapBase,
> = Key extends "then" ? never : Key extends keyof ServiceMap ? never : Key;

type ServiceDefinition = {
  key: string;
  dependencies: readonly string[];
  factory: ServiceFactory;
};

type ServiceRegistry<
  ServiceMap extends ServiceMapBase,
  // Original registration type per key. `replaceService` judges replacements
  // against this rather than the current `ServiceMap`, so a replacement is always
  // checked against the original contract — keeping dependents safe and letting
  // the same key be replaced repeatedly without each step narrowing the next.
  OriginalMap extends ServiceMapBase,
> = {
  service: {
    // Before () => Result — ensures the PositionalFactory<[]> brand check fires first.
    <const Key extends string, Instance>(
      key: UnregisteredKey<Key, ServiceMap>,
      factory: PositionalFactory<[], Instance>,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Instance>>,
      OriginalMap & Record<Key, Awaited<Instance>>
    >;
    <const Key extends string, Result>(
      key: UnregisteredKey<Key, ServiceMap>,
      factory: () => Result,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Result>>,
      OriginalMap & Record<Key, Awaited<Result>>
    >;
    <
      const Key extends string,
      const Deps extends readonly RegisteredKey<ServiceMap>[],
      Instance,
    >(
      key: UnregisteredKey<Key, ServiceMap>,
      dependencies: Deps,
      factory: PositionalFactory<
        { [K in keyof Deps]: ServiceMap[Deps[K]] },
        Instance
      >,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Instance>>,
      OriginalMap & Record<Key, Awaited<Instance>>
    >;
    <
      const Key extends string,
      const Deps extends readonly RegisteredKey<ServiceMap>[],
      Result,
    >(
      key: UnregisteredKey<Key, ServiceMap>,
      dependencies: Deps,
      // Exclude PositionalFactory so it cannot fall through to this overload.
      factory: NotPositionalFactory<
        (deps: Pick<ServiceMap, Deps[number]>) => Result
      >,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Result>>,
      OriginalMap & Record<Key, Awaited<Result>>
    >;
  };

  value: <const Key extends string, T>(
    key: UnregisteredKey<Key, ServiceMap>,
    instance: T,
  ) => ServiceRegistry<
    ServiceMap & Record<Key, T>,
    OriginalMap & Record<Key, T>
  >;

  // A replacement may declare its own, independent dependency list — it does
  // not have to match the deps the key was originally registered with. Each
  // overload mirrors `.service`'s shape, just keyed against the *current*
  // ServiceMap (so already-registered services, including ones added after
  // the original registration, are valid deps) and bounded by `OriginalMap[Key]`
  // (so dependents relying on the original contract stay safe).
  replaceService: {
    // Before () => Result — ensures the PositionalFactory<[]> brand check fires first.
    <
      const Key extends RegisteredKey<ServiceMap>,
      Instance extends OriginalMap[Key] | Promise<OriginalMap[Key]>,
    >(
      key: Key,
      factory: PositionalFactory<[], Instance>,
    ): ServiceRegistry<
      ReplaceValue<ServiceMap, Key, Awaited<Instance>>,
      OriginalMap
    >;
    <
      const Key extends RegisteredKey<ServiceMap>,
      Result extends OriginalMap[Key],
    >(
      key: Key,
      factory: () => Result | Promise<Result>,
    ): ServiceRegistry<ReplaceValue<ServiceMap, Key, Result>, OriginalMap>;
    <
      const Key extends RegisteredKey<ServiceMap>,
      const Deps extends readonly Exclude<RegisteredKey<ServiceMap>, Key>[],
      Instance extends OriginalMap[Key] | Promise<OriginalMap[Key]>,
    >(
      key: Key,
      dependencies: Deps,
      factory: PositionalFactory<
        { [K in keyof Deps]: ServiceMap[Deps[K]] },
        Instance
      >,
    ): ServiceRegistry<
      ReplaceValue<ServiceMap, Key, Awaited<Instance>>,
      OriginalMap
    >;
    <
      const Key extends RegisteredKey<ServiceMap>,
      const Deps extends readonly Exclude<RegisteredKey<ServiceMap>, Key>[],
      Result extends OriginalMap[Key],
    >(
      key: Key,
      dependencies: Deps,
      // Exclude PositionalFactory so it cannot fall through to this overload.
      factory: NotPositionalFactory<
        (deps: Pick<ServiceMap, Deps[number]>) => Result | Promise<Result>
      >,
    ): ServiceRegistry<ReplaceValue<ServiceMap, Key, Result>, OriginalMap>;
  };

  replaceValue: <
    const Key extends RegisteredKey<ServiceMap>,
    T extends OriginalMap[Key],
  >(
    key: Key,
    instance: T,
  ) => ServiceRegistry<ReplaceValue<ServiceMap, Key, T>, OriginalMap>;

  /** @deprecated Use {@link ServiceRegistry.replaceService} instead. Will be removed in the next major version. */
  override: ServiceRegistry<ServiceMap, OriginalMap>["replaceService"];

  resolve: () => Promise<ServiceMap & AsyncDisposable>;
};

const makeRegistry = <
  ServiceMap extends ServiceMapBase,
  OriginalMap extends ServiceMapBase,
>(
  definitions: readonly ServiceDefinition[],
): ServiceRegistry<ServiceMap, OriginalMap> => {
  const registry = {
    service(
      key: string,
      factoryOrDeps: ServiceFactory | readonly string[],
      maybeServiceFactory?: ServiceFactory,
    ) {
      if (key === "then") {
        throw new RegistryError('Service key "then" is reserved');
      }
      if (definitions.some((d) => d.key === key)) {
        throw new RegistryError(`Service "${key}" is already registered`);
      }

      let dependencies: readonly string[];
      let factory: ServiceFactory;
      if (typeof factoryOrDeps === "function") {
        dependencies = [];
        factory = factoryOrDeps;
      } else {
        if (typeof maybeServiceFactory !== "function") {
          throw new RegistryError(`Service "${key}" factory is required`);
        }
        dependencies = factoryOrDeps;
        factory = maybeServiceFactory;
      }

      const registered = new Set(definitions.map((d) => d.key));
      for (const dep of dependencies) {
        if (!registered.has(dep)) {
          throw new RegistryError(
            `Service "${key}" depends on unregistered service "${dep}"`,
          );
        }
      }

      return makeRegistry([...definitions, { key, dependencies, factory }]);
    },

    value(key: string, instance: unknown) {
      return registry.service(key, () => instance);
    },

    replaceService(
      key: string,
      factoryOrDeps: ServiceFactory | readonly string[],
      maybeServiceFactory?: ServiceFactory,
    ) {
      const index = definitions.findIndex((d) => d.key === key);
      if (index === -1) {
        throw new RegistryError(`Service "${key}" is not registered`);
      }

      let dependencies: readonly string[];
      let factory: ServiceFactory;
      if (typeof factoryOrDeps === "function") {
        dependencies = [];
        factory = factoryOrDeps;
      } else {
        if (typeof maybeServiceFactory !== "function") {
          throw new RegistryError(`Service "${key}" factory is required`);
        }
        dependencies = factoryOrDeps;
        factory = maybeServiceFactory;
      }

      const registered = new Set(definitions.map((d) => d.key));
      for (const dep of dependencies) {
        if (!registered.has(dep)) {
          throw new RegistryError(
            `Service "${key}" depends on unregistered service "${dep}"`,
          );
        }
      }

      const next = [...definitions];
      next[index] = { key, dependencies, factory };

      const cycleKey = findCycle(next);
      if (cycleKey !== undefined) {
        throw new RegistryError(
          `Service "${cycleKey}" has a circular dependency`,
        );
      }

      return makeRegistry(next);
    },

    replaceValue(key: string, instance: unknown) {
      return registry.replaceService(key, () => instance);
    },

    override(
      key: string,
      factoryOrDeps: ServiceFactory | readonly string[],
      maybeServiceFactory?: ServiceFactory,
    ) {
      return registry.replaceService(key, factoryOrDeps, maybeServiceFactory);
    },

    async resolve() {
      // Null-prototype so service keys like `__proto__` become regular own
      // properties instead of triggering the prototype setter, and so they
      // cannot collide with inherited `Object.prototype` members.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `Object.create(null)` is typed as `any` in lib.dom.
      const services: ServiceMapBase = Object.create(null);
      const factoryErrors: ServiceFactoryError[] = [];
      const promises = new Map<string, Promise<unknown>>();
      const byKey = new Map(definitions.map((d) => [d.key, d]));

      // Resolved lazily and memoized by key rather than walked in registration
      // order, so a service's dependencies can point at any other registered
      // key — including one a `replaceService` call added that sits later in
      // `definitions` — regardless of array position.
      const getPromise = (key: string): Promise<unknown> => {
        const existing = promises.get(key);
        if (existing) return existing;

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `key` only ever comes from a definition's own key or from a dependency list, both of which are validated to reference a registered definition.
        const { dependencies, factory } = byKey.get(key)!;

        const promise = (async () => {
          const depEntries = await Promise.all(
            dependencies.map(async (d) => [d, await getPromise(d)] as const),
          );
          const deps = Object.fromEntries(depEntries);
          try {
            const value = await factory(deps);
            services[key] = value;
            return value;
          } catch (error) {
            const wrapped = new ServiceFactoryError(key, error);
            factoryErrors.push(wrapped);
            throw wrapped;
          }
        })();

        promises.set(key, promise);
        return promise;
      };

      await Promise.allSettled(definitions.map((d) => getPromise(d.key)));

      if (factoryErrors.length > 0) {
        const disposeErrors = await disposeAll(services, definitions);
        throw new ResolveError([...factoryErrors, ...disposeErrors]);
      }

      let disposed = false;
      return Object.defineProperty(services, Symbol.asyncDispose, {
        value: async () => {
          if (disposed) return;
          disposed = true;
          const errors = await disposeAll(services, definitions);
          if (errors.length > 0) {
            throw new DisposeError(errors);
          }
        },
      });
    },
  };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- The structural registry satisfies the overloaded ServiceRegistry type at runtime.
  return registry as unknown as ServiceRegistry<ServiceMap, OriginalMap>;
};

export const createRegistry = (): ServiceRegistry<
  Record<never, never>,
  Record<never, never>
> => makeRegistry([]);

// Only `replaceService` can introduce a cycle: `.service` can only depend on
// already-registered keys, so its graph is a DAG by construction.
const findCycle = (
  definitions: readonly ServiceDefinition[],
): string | undefined => {
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  const visit = (
    key: string,
    path: ReadonlySet<string>,
  ): string | undefined => {
    if (path.has(key)) return key;

    const nextPath = new Set(path).add(key);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `key` only ever comes from a definition's own key or from a dependency list, both of which are validated to reference a registered definition.
    for (const dep of byKey.get(key)!.dependencies) {
      const cycleKey = visit(dep, nextPath);
      if (cycleKey !== undefined) return cycleKey;
    }
    return undefined;
  };

  for (const def of definitions) {
    const cycleKey = visit(def.key, new Set());
    if (cycleKey !== undefined) return cycleKey;
  }
  return undefined;
};

const isDisposable = (value: unknown): value is Record<symbol, unknown> =>
  value !== null && (typeof value === "object" || typeof value === "function");

const disposeAll = async (
  services: ServiceMapBase,
  definitions: readonly ServiceDefinition[],
): Promise<ServiceDisposeError[]> => {
  const errors: ServiceDisposeError[] = [];
  const completed = Object.keys(services);
  const dependents = new Map<string, string[]>(
    completed.map((key) => [key, []]),
  );

  for (const def of definitions) {
    // Skip incomplete defs so the `!` below holds: a def only reaches
    // `services[key] = value` after `Promise.all(depPromises)` resolved, which
    // means every dep is itself completed and present in `dependents`.
    if (!dependents.has(def.key)) continue;
    for (const dep of def.dependencies) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see the invariant above.
      dependents.get(dep)!.push(def.key);
    }
  }

  const disposePromises = new Map<string, Promise<void>>();
  for (const key of completed.reverse()) {
    /* eslint-disable @typescript-eslint/no-non-null-assertion -- `key` came from `completed`, and every entry pushed into a dependent list is itself completed. */
    const dependentPromises = dependents
      .get(key)!
      .map((d) => disposePromises.get(d)!);
    /* eslint-enable @typescript-eslint/no-non-null-assertion */

    const promise = (async () => {
      await Promise.all(dependentPromises);
      try {
        await disposeOne(services[key]);
      } catch (error) {
        errors.push(new ServiceDisposeError(key, error));
      }
    })();

    disposePromises.set(key, promise);
  }

  await Promise.all(disposePromises.values());
  return errors;
};

const disposeOne = async (service: unknown) => {
  if (!isDisposable(service)) return;
  const handler = service[Symbol.asyncDispose] ?? service[Symbol.dispose];
  if (typeof handler === "function") {
    await handler.call(service);
  }
};
