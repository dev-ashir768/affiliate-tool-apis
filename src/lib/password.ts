type Argon2 = typeof import("argon2");

let argon2Module: Argon2 | null = null;

async function loadArgon2(): Promise<Argon2> {
  if (argon2Module) return argon2Module;
  argon2Module = await import("argon2");
  return argon2Module;
}

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await loadArgon2();
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  const argon2 = await loadArgon2();
  return argon2.verify(hash, password);
}
