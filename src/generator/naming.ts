/**
 * Convert a string to a valid JavaScript identifier in PascalCase.
 * Used for type names in generated code.
 */
export function toPascalCase(name: string): string {
  const camel = name.replace(/[-_.](.)/g, (_, c: string) => c.toUpperCase());
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Sanitise an arbitrary string so it is a safe JS identifier.
 * Replaces any character that is not alphanumeric or _ with _.
 * Prepends _ if the first character is a digit.
 */
export function sanitiseIdentifier(name: string): string {
  let id = name.replace(/[^a-zA-Z0-9_$]/g, "_");
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return id;
}
