const POSITIONAL_FACTORY_BRAND: unique symbol = Symbol();

export type PositionalFactory<Args extends readonly unknown[], Instance> = ((
  deps: Record<string, unknown>,
) => Instance) & {
  readonly [POSITIONAL_FACTORY_BRAND]: Args;
};

export type NotPositionalFactory<T> = T & {
  readonly [POSITIONAL_FACTORY_BRAND]?: never;
};

function makeClassFactoryWithObject(
  Ctor: new (...args: never[]) => unknown,
): (deps?: Record<string, unknown>) => unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the caller's deps declaration aligns with the constructor parameter.
  return (deps) => new Ctor(deps as never);
}

function makeClassFactoryWithArgs(
  Ctor: new (...args: never[]) => unknown,
): (deps?: Record<string, unknown>) => unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
  return (deps) => new Ctor(...(Object.values(deps ?? {}) as never[]));
}

type AsClassOptions = {
  /** @deprecated Use {@link asClassArgs} instead. Will be removed in the next major version. */
  positional: true;
};

function makeClassFactory(
  Ctor: new (...args: never[]) => unknown,
  options?: AsClassOptions,
): (deps?: Record<string, unknown>) => unknown {
  return options
    ? makeClassFactoryWithArgs(Ctor)
    : makeClassFactoryWithObject(Ctor);
}

type ClassFactory<Instance> = {
  <Deps extends object>(
    Ctor: new (deps: Deps) => Instance,
  ): (deps: Deps) => Instance;
  (
    Ctor: new (...args: never[]) => Instance,
    options: AsClassOptions,
  ): (deps?: Record<string, unknown>) => Instance;
};

export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

export function asClass<Instance>(
  Ctor: new (...args: never[]) => Instance,
  options: AsClassOptions,
): (deps?: Record<string, unknown>) => Instance;

export function asClass<Instance>(): ClassFactory<Instance>;

export function asClass(
  Ctor?: new (...args: never[]) => unknown,
  options?: AsClassOptions,
): unknown {
  if (Ctor === undefined) {
    return makeClassFactory;
  }
  return makeClassFactory(Ctor, options);
}

type ClassArgsFactory<Instance> = <Args extends readonly unknown[]>(
  Ctor: new (...args: Args) => Instance,
) => PositionalFactory<Args, Instance>;

export function asClassArgs<Args extends readonly unknown[], Instance>(
  Ctor: new (...args: Args) => Instance,
): PositionalFactory<Args, Instance>;

export function asClassArgs<Instance>(): ClassArgsFactory<Instance>;

export function asClassArgs(Ctor?: new (...args: never[]) => unknown): unknown {
  if (Ctor === undefined) {
    return <Args extends readonly unknown[], I>(
      ctor: new (...args: Args) => I,
    ): PositionalFactory<Args, I> => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand exists at the type level only; the positional args are aligned by the caller's deps declaration.
      return makeClassFactoryWithArgs(ctor) as PositionalFactory<Args, I>;
    };
  }
  return makeClassFactoryWithArgs(Ctor);
}
