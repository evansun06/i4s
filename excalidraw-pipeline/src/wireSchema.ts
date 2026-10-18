import { strictWireSchema, type Schema } from './contracts.js';

/** Share identical wire definitions without changing the local validation contract.
 * Repeating large ID enums in repair variants otherwise exceeds the API's 1,000
 * enum-value limit. $defs/$ref are supported by strict Structured Outputs.
 */
export function modelWireSchema(schema: Schema): Record<string, unknown> {
  const wire = strictWireSchema(schema);
  const counts = new Map<string, number>();
  const children = (node: Schema): Schema[] => {
    if ('anyOf' in node) return node.anyOf;
    if (node.type === 'array') return [node.items];
    if (node.type === 'object') return Object.values(node.properties);
    return [];
  };
  const count = (node: Schema) => {
    const key = JSON.stringify(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    children(node).forEach(count);
  };
  count(wire);
  const names = new Map<string, string>();
  const definitions: Record<string, Record<string, unknown>> = {};
  const convert = (node: Schema, inline = false): Record<string, unknown> => {
    const key = JSON.stringify(node);
    if (!inline && key.length >= 80 && (counts.get(key) ?? 0) > 1) {
      let name = names.get(key);
      if (!name) {
        name = `shared${names.size}`;
        names.set(key, name);
        definitions[name] = convert(node, true);
      }
      return { $ref: `#/$defs/${name}` };
    }
    if ('anyOf' in node)
      return { anyOf: node.anyOf.map((item) => convert(item)) };
    if (node.type === 'array') return { ...node, items: convert(node.items) };
    if (node.type === 'object')
      return {
        ...node,
        properties: Object.fromEntries(
          Object.entries(node.properties).map(([name, item]) => [
            name,
            convert(item),
          ]),
        ),
      };
    return { ...node };
  };
  const output = convert(wire, true);
  if (names.size) output.$defs = definitions;
  return output;
}
