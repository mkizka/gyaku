import type { PositionalFactory } from "./class.js";

function makeFunctionFactoryWithArgs(
  fn: (...args: never[]) => unknown,
): (deps?: Record<string, unknown>) => unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the function parameters by the caller's deps declaration.
  return (deps) => fn(...(Object.values(deps ?? {}) as never[]));
}

type FunctionArgsFactory<Result> = <Args extends readonly unknown[]>(
  fn: (...args: Args) => Result | Promise<Result>,
) => PositionalFactory<Args, Result>;

export function asFactoryArgs<Args extends readonly unknown[], Result>(
  fn: (...args: Args) => Result,
): PositionalFactory<Args, Result>;

export function asFactoryArgs<Result>(): FunctionArgsFactory<Result>;

export function asFactoryArgs(fn?: (...args: never[]) => unknown): unknown {
  if (fn === undefined) {
    return <Args extends readonly unknown[], Result>(
      f: (...args: Args) => Result | Promise<Result>,
    ): PositionalFactory<Args, Result> => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand exists at the type level only; the positional args are aligned by the caller's deps declaration.
      return makeFunctionFactoryWithArgs(f) as PositionalFactory<Args, Result>;
    };
  }
  return makeFunctionFactoryWithArgs(fn);
}
