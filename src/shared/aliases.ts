// Permite que los clientes envíen un campo con otro nombre (por ejemplo en español).
export function withAliases(aliases: Readonly<Record<string, readonly string[]>>) {
  return (raw: unknown): unknown => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
    const input = raw as Record<string, unknown>;
    const output: Record<string, unknown> = { ...input };
    for (const [canonical, names] of Object.entries(aliases)) {
      if (output[canonical] !== undefined) continue;
      for (const name of names) {
        if (input[name] !== undefined) {
          output[canonical] = input[name];
          break;
        }
      }
    }
    return output;
  };
}
