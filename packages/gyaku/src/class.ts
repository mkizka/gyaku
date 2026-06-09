// Helpers for migrating class-based DI to gyaku.
//
// gyaku factories receive their dependencies as a single object, while classes
// usually take them through their constructor. `asClass` adapts a class
// constructor into a factory so existing classes can be registered with
// `.service` without a hand-written `(deps) => new Foo(...)` wrapper.

/**
 * Adapts a class whose constructor takes a single dependency object.
 *
 * The resolved dependencies are passed straight to the constructor, so the
 * factory stays fully type-safe: missing or mistyped dependencies are caught
 * by `.service` at compile time.
 *
 * @example
 * ```ts
 * class Greeter {
 *   #logger: Logger;
 *   constructor({ logger }: { logger: Logger }) {
 *     this.#logger = logger;
 *   }
 * }
 *
 * createRegistry()
 *   .service("logger", () => new Logger())
 *   .service("greeter", ["logger"], asClass(Greeter));
 * ```
 */
export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

/**
 * Adapts a class whose constructor takes positional arguments, spreading the
 * resolved dependencies into the constructor in the order they are listed in
 * `.service`'s `deps` argument.
 *
 * Unlike the default object-argument form, the constructor parameters are NOT
 * matched against the declared dependencies at compile time — only the instance
 * type is inferred. Make sure `deps` lists exactly the constructor's
 * parameters, in order. (The values are read with `Object.values`, which
 * follows the deps object's key order; keep service keys as ordinary
 * identifiers, not integer-like strings such as `"0"`, whose ordering
 * JavaScript reshuffles.)
 *
 * @example
 * ```ts
 * class Greeter {
 *   #logger: Logger;
 *   #db: Db;
 *   constructor(logger: Logger, db: Db) {
 *     this.#logger = logger;
 *     this.#db = db;
 *   }
 * }
 *
 * createRegistry()
 *   .service("logger", () => new Logger())
 *   .service("db", ["logger"], Db.create)
 *   // deps order ["logger", "db"] maps to constructor(logger, db).
 *   .service("greeter", ["logger", "db"], asClass(Greeter, { positional: true }));
 * ```
 */
export function asClass<Instance>(
  Ctor: new (...args: never[]) => Instance,
  options: { positional: true },
): (deps: Record<string, unknown>) => Instance;

export function asClass(
  Ctor: new (...args: never[]) => unknown,
  options?: { positional?: boolean },
): (deps: Record<string, unknown>) => unknown {
  return (deps) => {
    // With `positional`, spread the deps values into the constructor in
    // `.service`'s declared order; otherwise pass the deps object as is.
    const args = options?.positional ? Object.values(deps) : [deps];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
    return new Ctor(...(args as never[]));
  };
}
