export class GyakuError extends Error {
  override name = "GyakuError";
}

export class RegistryError extends GyakuError {
  override name = "RegistryError";
}

export class ServiceFactoryError extends GyakuError {
  override name = "ServiceFactoryError";
  readonly key: string;

  constructor(key: string, cause: unknown) {
    super(`Service "${key}" factory failed`, { cause });
    this.key = key;
  }
}

export class ServiceDisposeError extends GyakuError {
  override name = "ServiceDisposeError";
  readonly key: string;

  constructor(key: string, cause: unknown) {
    super(`Service "${key}" dispose failed`, { cause });
    this.key = key;
  }
}

export class ResolveError extends GyakuError {
  override name = "ResolveError";
  readonly errors: readonly (ServiceFactoryError | ServiceDisposeError)[];

  constructor(errors: readonly (ServiceFactoryError | ServiceDisposeError)[]) {
    const keys = errors.map((e) => e.key).join(", ");
    super(`Failed to resolve services: ${keys}`, { cause: errors[0] });
    this.errors = errors;
  }
}

export class DisposeError extends GyakuError {
  override name = "DisposeError";
  readonly errors: readonly ServiceDisposeError[];

  constructor(errors: readonly ServiceDisposeError[]) {
    const keys = errors.map((e) => e.key).join(", ");
    super(`Failed to dispose services: ${keys}`, { cause: errors[0] });
    this.errors = errors;
  }
}
