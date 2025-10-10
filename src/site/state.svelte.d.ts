export declare const routes: {
  route: string
  filename: string
}[]
export type RouteEntry = string | [string, string] | [string, string[]]
export declare function group_demo_routes(demos: string[]): RouteEntry[]
export declare const demo_routes: RouteEntry[]
