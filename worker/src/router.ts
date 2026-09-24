import { problem } from "./http";

export type Handler<C> = (
  request: Request,
  context: C,
) => Promise<Response> | Response;

/** Exact-path router. HEAD is served by the GET handler without a body. */
export class Router<C> {
  private readonly routes = new Map<string, Map<string, Handler<C>>>();

  get(path: string, handler: Handler<C>): this {
    return this.on("GET", path, handler);
  }

  post(path: string, handler: Handler<C>): this {
    return this.on("POST", path, handler);
  }

  private on(method: string, path: string, handler: Handler<C>): this {
    const methods = this.routes.get(path) ?? new Map<string, Handler<C>>();
    methods.set(method, handler);
    this.routes.set(path, methods);
    return this;
  }

  /** Methods served at a path, or an empty list for an unknown path. */
  methods(path: string): string[] {
    const methods = [...(this.routes.get(path)?.keys() ?? [])];
    return methods.includes("GET") ? [...methods, "HEAD"] : methods;
  }

  async handle(request: Request, context: C): Promise<Response> {
    const { pathname } = new URL(request.url);
    const methods = this.routes.get(pathname);
    if (!methods) return problem(404, "not_found", "No such endpoint.");
    const handler = methods.get(
      request.method === "HEAD" ? "GET" : request.method,
    );
    if (!handler) {
      return problem(
        405,
        "method_not_allowed",
        `Use ${this.methods(pathname).join(" or ")}.`,
        {},
        {
          Allow: this.methods(pathname).join(", "),
        },
      );
    }
    const response = await handler(request, context);
    return request.method === "HEAD" ? new Response(null, response) : response;
  }
}
