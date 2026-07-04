import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    AI_GATEWAY_API_KEY: v.optional(v.string()),
    AI_GATEWAY_MODEL: v.optional(v.string()),
  },
});

export default app;
