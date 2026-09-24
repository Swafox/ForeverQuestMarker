import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp();

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
