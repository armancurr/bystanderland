import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GROQ_API_KEY: v.optional(v.string()),
    GROQ_MODEL: v.optional(v.string()),
  },
});

export default app;
