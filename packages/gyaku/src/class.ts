// Adapts a class constructor into a `.service` factory, so class-based code can
// migrate without a hand-written `(deps) => new Foo(...)` wrapper.

/** Adapts a class whose constructor takes a single deps object. Fully type-safe. */
export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

/**
 * Adapts a class whose constructor takes positional arguments, spreading the
 * deps in `.service`'s declared order. Only the instance type is inferred, so
 * `deps` must list the constructor's parameters in order.
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
    // positional: spread deps values in declared order; otherwise pass deps as is.
    const args = options?.positional ? Object.values(deps) : [deps];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
    return new Ctor(...(args as never[]));
  };
}
