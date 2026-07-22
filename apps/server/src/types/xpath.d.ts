declare module 'xpath' {
  export function select(
    expression: string,
    node: Node,
    single?: boolean,
  ): Node | Node[] | string | number | boolean | null
  const xpath: {
    select: typeof select
  }
  export default xpath
}
