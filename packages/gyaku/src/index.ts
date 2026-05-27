type ServiceMap = Record<string, unknown>;

type DepsMapBase<Services extends ServiceMap> = Record<
  string,
  readonly Extract<keyof Services, string>[]
>;

type ServiceFactory = (deps: ServiceMap) => unknown;

// `then` is reserved because the built services object would otherwise be
// treated as a thenable by `await`, leading to infinite unwrapping.
type UnregisteredKey<
  Key extends string,
  Services extends ServiceMap,
> = Key extends "then" ? never : Key extends keyof Services ? never : Key;

type ServiceDefinition = {
  key: string;
  dependencies: readonly string[];
  factory: ServiceFactory;
};

type ServiceRegistry<
  Services extends ServiceMap,
  DepsMap extends DepsMapBase<Services>,
> = {
  service: {
    <const Key extends string, Result>(
      key: UnregisteredKey<Key, Services>,
      factory: () => Result,
    ): ServiceRegistry<
      Services & Record<Key, Awaited<Result>>,
      DepsMap & Record<Key, readonly []>
    >;
    <
      const Key extends string,
      const Deps extends readonly Extract<keyof Services, string>[],
      Result,
    >(
      key: UnregisteredKey<Key, Services>,
      dependencies: Deps,
      factory: (deps: Pick<Services, Deps[number]>) => Result,
    ): ServiceRegistry<
      Services & Record<Key, Awaited<Result>>,
      DepsMap & Record<Key, Deps>
    >;
  };
  value: <const Key extends string, T>(
    key: UnregisteredKey<Key, Services>,
    instance: T,
  ) => ServiceRegistry<
    Services & Record<Key, T>,
    DepsMap & Record<Key, readonly []>
  >;
  override: <const Key extends Extract<keyof Services, string>>(
    key: Key,
    factory: (
      deps: Pick<Services, DepsMap[Key][number]>,
    ) => Services[Key] | Promise<Services[Key]>,
  ) => ServiceRegistry<Services, DepsMap>;
  resolve: () => Promise<Services & AsyncDisposable>;
};

const makeRegistry = <
  Services extends ServiceMap,
  DepsMap extends DepsMapBase<Services>,
>(
  definitions: readonly ServiceDefinition[],
): ServiceRegistry<Services, DepsMap> => {
  const registry = {
    service(
      key: string,
      factoryOrDeps: ServiceFactory | readonly string[],
      maybeServiceFactory?: ServiceFactory,
    ) {
      if (key === "then") {
        throw new TypeError('Service key "then" is reserved');
      }
      if (definitions.some((d) => d.key === key)) {
        throw new TypeError(`Service "${key}" is already registered`);
      }

      let dependencies: readonly string[];
      let factory: ServiceFactory;
      if (typeof factoryOrDeps === "function") {
        dependencies = [];
        factory = factoryOrDeps;
      } else {
        if (typeof maybeServiceFactory !== "function") {
          throw new TypeError(`Service "${key}" factory is required`);
        }
        dependencies = factoryOrDeps;
        factory = maybeServiceFactory;
      }

      const registered = new Set(definitions.map((d) => d.key));
      for (const dep of dependencies) {
        if (!registered.has(dep)) {
          throw new TypeError(
            `Service "${key}" depends on unregistered service "${dep}"`,
          );
        }
      }

      return makeRegistry([...definitions, { key, dependencies, factory }]);
    },

    value(key: string, instance: unknown) {
      return registry.service(key, () => instance);
    },

    override(key: string, factory: ServiceFactory) {
      const index = definitions.findIndex((d) => d.key === key);
      if (index === -1) {
        throw new TypeError(`Service "${key}" is not registered`);
      }

      const next = [...definitions];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index was just verified to be a valid position in definitions.
      next[index] = { ...next[index]!, factory };
      return makeRegistry(next);
    },

    async resolve() {
      // Null-prototype so service keys like `__proto__` become regular own
      // properties instead of triggering the prototype setter, and so they
      // cannot collide with inherited `Object.prototype` members.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `Object.create(null)` is typed as `any` in lib.dom.
      const services: ServiceMap = Object.create(null);
      const factoryErrors: unknown[] = [];
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
            const wrapped = new Error(`Service "${key}" factory failed`, {
              cause: error,
            });
            factoryErrors.push(wrapped);
            throw wrapped;
          }
        })();

        promises.set(key, promise);
      }

      await Promise.allSettled(promises.values());

      if (factoryErrors.length > 0) {
        const cleanupErrors = await disposeAll(services, definitions);
        throwErrors(
          [...factoryErrors, ...cleanupErrors],
          "Failed to resolve services and dispose partial instances",
          { cause: factoryErrors[0] },
        );
      }

      let disposed = false;
      return Object.defineProperty(services, Symbol.asyncDispose, {
        value: async () => {
          if (disposed) return;
          disposed = true;
          const errors = await disposeAll(services, definitions);
          throwErrors(errors, "Failed to dispose services");
        },
      });
    },
  };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- The structural registry satisfies the overloaded ServiceRegistry type at runtime.
  return registry as unknown as ServiceRegistry<Services, DepsMap>;
};

export const createRegistry = (): ServiceRegistry<
  Record<never, never>,
  Record<never, readonly []>
> => makeRegistry([]);

const throwErrors = (
  errors: readonly unknown[],
  message: string,
  options?: ErrorOptions,
): void => {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message, options);
};

const isDisposable = (value: unknown): value is Record<symbol, unknown> =>
  value !== null && (typeof value === "object" || typeof value === "function");

const disposeAll = async (
  services: ServiceMap,
  definitions: readonly ServiceDefinition[],
) => {
  const errors: unknown[] = [];
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
        errors.push(
          new Error(`Service "${key}" dispose failed`, { cause: error }),
        );
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
