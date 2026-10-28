import { parse } from 'acorn';

// Decode the literal data emitted by SSR serializers. Site code is never run:
// only objects, arrays, primitive values and serializer parameter references
// are accepted. Calls, property access, getters and executable statements fail.
export function readStaticAssignment(script, name) {
  if (typeof script !== 'string' || script.length > 2 * 1024 * 1024) throw new Error('搜索页数据过大');
  const program = parse(script, { ecmaVersion: 'latest' });
  const assignment = program.body.find(statement => statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' && statement.expression.operator === '=' && statement.expression.left.type === 'MemberExpression' && !statement.expression.left.computed && statement.expression.left.object.name === 'window' && statement.expression.left.property.name === name)?.expression;
  if (!assignment) throw new Error('搜索页缺少可读取的结果数据');
  let remaining = 150000;
  const invalid = () => { throw new Error('搜索页数据格式暂不支持，请前往来源查看'); };
  function literal(node, bindings, depth = 0) {
    if (!node || --remaining < 0 || depth > 80) return invalid();
    if (node.type === 'Literal' && (node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value)) && !node.regex && !node.bigint) return node.value;
    if (node.type === 'Identifier' && Object.hasOwn(bindings, node.name)) return bindings[node.name];
    if (node.type === 'Identifier' && node.name === 'undefined') return undefined;
    if (node.type === 'ArrayExpression') return node.elements.map(value => value ? literal(value, bindings, depth + 1) : null);
    if (node.type === 'ObjectExpression') {
      const value = Object.create(null);
      for (const field of node.properties) {
        if (field.type !== 'Property' || field.kind !== 'init' || field.computed || field.method) return invalid();
        const key = field.key.type === 'Identifier' ? field.key.name : field.key.type === 'Literal' ? field.key.value : invalid();
        value[key] = literal(field.value, bindings, depth + 1);
      }
      return value;
    }
    if (node.type === 'UnaryExpression' && ['-', '+', '!', 'void'].includes(node.operator)) {
      const value = literal(node.argument, bindings, depth + 1);
      if (node.operator === 'void') return undefined;
      if (node.operator === '!') return !value;
      if (typeof value !== 'number') return invalid();
      return node.operator === '-' ? -value : value;
    }
    return invalid();
  }
  const expression = assignment.right;
  if (expression.type !== 'CallExpression') return literal(expression, Object.create(null));
  const fn = expression.callee;
  if (fn.type !== 'FunctionExpression' || fn.async || fn.generator || fn.body.body.length !== 1 || fn.body.body[0].type !== 'ReturnStatement' || fn.params.some(p => p.type !== 'Identifier')) return invalid();
  if (expression.arguments.length !== fn.params.length) return invalid();
  const bindings = Object.create(null);
  expression.arguments.forEach((arg, index) => { bindings[fn.params[index].name] = literal(arg, Object.create(null)); });
  return literal(fn.body.body[0].argument, bindings);
}
