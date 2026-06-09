// Helpers for migrating class-based DI to gyaku.
//
// gyaku factories receive their dependencies as a single object, while classes
// usually take them through their constructor. These helpers adapt a class
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
export const asClass =
  <Deps extends object, Instance>(
    Ctor: new (deps: Deps) => Instance,
  ): ((deps: Deps) => Instance) =>
  (deps) =>
    new Ctor(deps);

type Prettify<T> = { [K in keyof T]: T[K] } & {};

// Zips a tuple of dependency keys together with the constructor's parameter
// types into the dependency object the produced factory accepts. Recursing in
// lockstep keeps each key paired with the parameter at the same position.
type ZipToObject<
  Keys extends readonly PropertyKey[],
  Args extends readonly unknown[],
> = Keys extends readonly [
  infer Key extends PropertyKey,
  ...infer KeyRest extends readonly PropertyKey[],
]
  ? Args extends readonly [
      infer Arg,
      ...infer ArgRest extends readonly unknown[],
    ]
    ? { [P in Key]: Arg } & ZipToObject<KeyRest, ArgRest>
    : Record<never, never>
  : Record<never, never>;

/**
 * Adapts a class whose constructor takes positional arguments, mapping the
 * named dependencies to constructor parameters in the given order.
 *
 * `keys` must list exactly one dependency name per constructor parameter; its
 * length is checked against the constructor at compile time, and each declared
 * dependency's type is matched against the parameter at the same position.
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
 *   .service("greeter", ["logger", "db"], asClassArgs(Greeter, ["logger", "db"]));
 * ```
 */
export const asClassArgs = <
  Args extends readonly unknown[],
  const Keys extends { readonly [I in keyof Args]: PropertyKey },
  Instance,
>(
  Ctor: new (...args: Args) => Instance,
  keys: Keys,
): ((deps: Prettify<ZipToObject<Keys, Args>>) => Instance) => {
  const build = (deps: Record<PropertyKey, unknown>): Instance =>
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `keys` mirrors the constructor parameters by construction; its length is checked against `Args` at the call site.
    new Ctor(...(keys.map((key) => deps[key]) as unknown as Args));
  return build;
};
