export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

/**
 * @deprecated Use {@link asClassArgs} instead. Passing `{ positional: true }`
 * is kept only for backward compatibility and will be removed in a future
 * release.
 */
export function asClass<Instance>(
  Ctor: new (...args: never[]) => Instance,
  options: { positional: true },
): (deps?: Record<string, unknown>) => Instance;

export function asClass(
  Ctor: new (...args: never[]) => unknown,
  options?: { positional?: boolean },
): (deps?: Record<string, unknown>) => unknown {
  if (options?.positional) {
    return asClassArgs(Ctor);
  }
  return (deps) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `deps` is the constructor's single dependency object as declared by the caller.
    return new Ctor(deps as never);
  };
}

/**
 * Adapts a class with a positional constructor into a factory, so classes
 * register without a `(deps) => new Foo(...)` wrapper. Resolved dependencies are
 * spread into the constructor in the order their keys appear in the registered
 * `deps` array. Only the instance type is inferred, so `deps` must list the
 * constructor's parameters in order.
 */
export function asClassArgs<Instance>(
  Ctor: new (...args: never[]) => Instance,
): (deps?: Record<string, unknown>) => Instance {
  return (deps) => {
    const args = Object.values(deps ?? {});
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
    return new Ctor(...(args as never[]));
  };
}
