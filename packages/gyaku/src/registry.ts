import {
  DisposeError,
  RegistryError,
  ResolveError,
  ServiceDisposeError,
  ServiceFactoryError,
} from "./errors.js";

type ServiceMapBase = Record<string, unknown>;

// Collapses an intersection (e.g. `Pick<A & Record<K1, V1> & ..., K>`) into a
// single flat object type for display, so a factory's `deps` hover reads as
// `{ k1: V1 }` instead of a long `Pick<Record<...> & Record<...>, K>` chain.
//
// Applied ONLY to leaf positions like the `deps` parameter — never to the
// accumulated `ServiceMap` that flows into the next `.service()` call. Wrapping
// the accumulator re-flattens the whole growing map on every chained call, and
// a long chain (~50+ services) then trips TS2589 ("excessively deep"). Leaf use
// is evaluated once per call over only the picked keys, so it stays cheap.
type Prettify<T> = { [K in keyof T]: T[K] };

type RegisteredKey<ServiceMap extends ServiceMapBase> = Extract<
  keyof ServiceMap,
  string
>;

// Kept independent of `ServiceMap` on purpose: a `DepsMapBase<ServiceMap>` form
// would be re-checked whenever `replaceService` rewrites `ServiceMap`, and fail.
type DepsMapBase = Record<string, readonly string[]>;

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
  DepsMap extends DepsMapBase,
  // Original registration type per key. `replaceService` judges replacements
  // against this rather than the current `ServiceMap`, so a replacement is always
  // checked against the original contract — keeping dependents safe and letting
  // the same key be replaced repeatedly without each step narrowing the next.
  OriginalMap extends ServiceMapBase,
> = {
  service: {
    <const Key extends string, Result>(
      key: UnregisteredKey<Key, ServiceMap>,
      factory: () => Result,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Result>>,
      DepsMap & Record<Key, readonly []>,
      OriginalMap & Record<Key, Awaited<Result>>
    >;
    <
      const Key extends string,
      const Deps extends readonly RegisteredKey<ServiceMap>[],
      Result,
    >(
      key: UnregisteredKey<Key, ServiceMap>,
      dependencies: Deps,
      factory: (deps: Prettify<Pick<ServiceMap, Deps[number]>>) => Result,
    ): ServiceRegistry<
      ServiceMap & Record<Key, Awaited<Result>>,
      DepsMap & Record<Key, Deps>,
      OriginalMap & Record<Key, Awaited<Result>>
    >;
  };

  value: <const Key extends string, T>(
    key: UnregisteredKey<Key, ServiceMap>,
    instance: T,
  ) => ServiceRegistry<
    ServiceMap & Record<Key, T>,
    DepsMap & Record<Key, readonly []>,
    OriginalMap & Record<Key, T>
  >;

  replaceService: <
    const Key extends RegisteredKey<ServiceMap>,
    Result extends OriginalMap[Key],
  >(
    key: Key,
    factory: (
      deps: Prettify<Pick<ServiceMap, DepsMap[Key][number]>>,
    ) => Result | Promise<Result>,
  ) => ServiceRegistry<
    ReplaceValue<ServiceMap, Key, Result>,
    DepsMap,
    OriginalMap
  >;

  replaceValue: <
    const Key extends RegisteredKey<ServiceMap>,
    T extends OriginalMap[Key],
  >(
    key: Key,
    instance: T,
  ) => ServiceRegistry<ReplaceValue<ServiceMap, Key, T>, DepsMap, OriginalMap>;

  /** @deprecated Use {@link ServiceRegistry.replaceService} instead. Will be removed in the next major version. */
  override: ServiceRegistry<ServiceMap, DepsMap, OriginalMap>["replaceService"];

  resolve: () => Promise<ServiceMap & AsyncDisposable>;
};

const makeRegistry = <
  ServiceMap extends ServiceMapBase,
  DepsMap extends DepsMapBase,
  OriginalMap extends ServiceMapBase,
>(
  definitions: readonly ServiceDefinition[],
): ServiceRegistry<ServiceMap, DepsMap, OriginalMap> => {
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

    replaceService(key: string, factory: ServiceFactory) {
      const index = definitions.findIndex((d) => d.key === key);
      if (index === -1) {
        throw new RegistryError(`Service "${key}" is not registered`);
      }

      const next = [...definitions];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index was just verified to be a valid position in definitions.
      next[index] = { ...next[index]!, factory };
      return makeRegistry(next);
    },

    replaceValue(key: string, instance: unknown) {
      return registry.replaceService(key, () => instance);
    },

    override(key: string, factory: ServiceFactory) {
      return registry.replaceService(key, factory);
    },

    async resolve() {
      // Null-prototype so service keys like `__proto__` become regular own
      // properties instead of triggering the prototype setter, and so they
      // cannot collide with inherited `Object.prototype` members.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `Object.create(null)` is typed as `any` in lib.dom.
      const services: ServiceMapBase = Object.create(null);
      const factoryErrors: ServiceFactoryError[] = [];
      const promises = new Map<string, Promise<unknown>>();

      for (const { key, dependencies, factory } of definitions) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- deps are validated to be registered earlier, so the promise is set in a previous iteration.
        const depPromises = dependencies.map((d) => promises.get(d)!);

        const promise = (async () => {
          await Promise.all(depPromises);
          const deps = Object.fromEntries(
            dependencies.map((d) => [d, services[d]]),
          );
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
      }

      await Promise.allSettled(promises.values());

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
  return registry as unknown as ServiceRegistry<
    ServiceMap,
    DepsMap,
    OriginalMap
  >;
};

export const createRegistry = (): ServiceRegistry<
  Record<never, never>,
  Record<never, readonly []>,
  Record<never, never>
> => makeRegistry([]);

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
